import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { prisma } from './db.js';
import { checkPassword, setSession, clearSession, requireAdmin } from './auth.js';
import { createCheckoutSession } from './bachs.js';
import { verifyBachsSignature } from './lib/signature.js';
import { parseCheckout, parseSettings } from './lib/validate.js';
import { newTicketCode, newReference } from './lib/codes.js';
import { toKobo } from './lib/money.js';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);
const requireJson = (req, res, next) => req.is('application/json') ? next() : res.status(415).json({ error: 'Content-Type must be application/json.' });
const limiter = (windowMs, max) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait and try again.' } });

const getSettings = tx => tx.eventSetting.upsert({ where: { id: 1 }, update: {}, create: config.eventDefaults });
// Sold + currently reserved (unpaid orders still within their hold window). null = inventory not configured.
async function remaining(tx, s) {
  if (s.totalTickets == null) return null;
  const r = await tx.order.aggregate({ _sum: { quantity: true }, where: { OR: [{ status: 'PAID' }, { status: 'PENDING', expiresAt: { gt: new Date() } }] } });
  return Math.max(0, s.totalTickets - (r._sum.quantity ?? 0));
}
const publicStatus = s => s === 'PAID' ? 'paid' : s === 'PENDING' ? 'pending' : 'failed';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], mediaSrc: ["'self'"],
    frameAncestors: ["'none'"], upgradeInsecureRequests: null } } }));

  // --- Bachs webhook: needs the RAW body, so it is registered before express.json() ---
  app.post('/api/webhooks/bachs', express.raw({ type: () => true, limit: '256kb' }), ah(async (req, res) => {
    if (!config.bachs.webhookSecret) return res.status(503).json({ error: 'Webhook secret not configured.' });
    if (!verifyBachsSignature({ rawBody: req.body, headers: req.headers, secret: config.bachs.webhookSecret }))
      return res.status(400).json({ error: 'Invalid signature.' });
    let evt; try { evt = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
    if (evt?.id && evt?.type) await handleEvent(evt); // throws => 5xx => Bachs retries
    res.json({ ok: true });
  }));

  app.use(express.json({ limit: '20kb' }));

  app.get('/api/event', ah(async (_req, res) => {
    const s = await getSettings(prisma), left = await remaining(prisma, s);
    res.json({ name: s.name, date: s.date, startTime: s.startTime, venue: s.venue, price: s.priceNaira,
      salesOpen: s.salesOpen && s.totalTickets > 0 && !!config.bachs.apiKey, ticketsRemaining: left, maxPerOrder: s.maxPerOrder, contactEmail: s.contactEmail });
  }));

  app.post('/api/checkout', limiter(60_000, 10), requireJson, ah(async (req, res) => {
    if (!config.bachs.apiKey) throw new HttpError(503, 'Payments are not configured yet.');
    const input = parseCheckout(req.body);
    if (input.error) throw new HttpError(400, input.error);
    const q = input.value;
    // Lock the event row so concurrent buyers cannot oversell.
    const order = await prisma.$transaction(async tx => {
      await getSettings(tx);
      await tx.$queryRaw`SELECT id FROM "EventSetting" WHERE id = 1 FOR UPDATE`;
      const s = await getSettings(tx), left = await remaining(tx, s);
      if (!s.salesOpen || !(s.totalTickets > 0)) throw new HttpError(409, 'Ticket sales are not open.');
      if (left < q.quantity) throw new HttpError(409, left === 0 ? 'Tickets are sold out.' : `Only ${left} ticket(s) left.`);
      if (s.maxPerOrder && q.quantity > s.maxPerOrder) throw new HttpError(400, `Maximum ${s.maxPerOrder} tickets per order.`);
      return tx.order.create({ data: { reference: newReference(), buyerName: q.name, buyerEmail: q.email, buyerPhone: q.phone,
        quantity: q.quantity, unitPrice: s.priceNaira, amount: s.priceNaira * q.quantity, // payable amount is ALWAYS server-computed
        expiresAt: new Date(Date.now() + config.holdMinutes * 60_000) } });
    });
    try {
      const { checkoutId, checkoutUrl } = await createCheckoutSession(order);
      await prisma.order.update({ where: { id: order.id }, data: { bachsCheckoutId: checkoutId } });
      res.json({ paymentUrl: checkoutUrl });
    } catch {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
      throw new HttpError(502, 'Could not start payment. Please try again.');
    }
  }));

  // Order lookup by unguessable reference or by the checkout id Bachs appends on return.
  app.get('/api/orders/:key', limiter(60_000, 60), ah(async (req, res) => {
    const k = req.params.key;
    const o = await prisma.order.findFirst({ where: k.startsWith('chk_') ? { bachsCheckoutId: k } : { reference: k }, include: { tickets: true } });
    if (!o) throw new HttpError(404, 'Order not found.');
    const s = await getSettings(prisma);
    res.json({ status: publicStatus(o.status), eventName: s.name, eventDate: s.date, buyerName: o.buyerName,
      tickets: o.status === 'PAID' ? o.tickets.map(t => ({ code: t.code })) : [] });
  }));

  app.get('/api/tickets/:code/qr.svg', limiter(60_000, 120), ah(async (req, res) => {
    const t = await prisma.ticket.findUnique({ where: { code: req.params.code }, include: { order: true } });
    if (!t || t.order.status !== 'PAID') throw new HttpError(404, 'Ticket not found.');
    res.type('image/svg+xml').set('Cache-Control', 'private, max-age=3600').send(await QRCode.toString(t.code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  }));

  // --- Admin ---
  app.post('/api/admin/login', limiter(15 * 60_000, 10), requireJson, (req, res) => {
    if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'Incorrect password.' });
    setSession(res); res.json({ ok: true });
  });
  app.post('/api/admin/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });
  app.get('/api/admin/settings', requireAdmin, ah(async (_req, res) => {
    const s = await getSettings(prisma); res.json({ ...s, price: s.priceNaira });
  }));
  app.put('/api/admin/settings', requireAdmin, requireJson, ah(async (req, res) => {
    const p = parseSettings(req.body);
    if (p.error) throw new HttpError(400, p.error);
    await prisma.$transaction(async tx => {
      await getSettings(tx); await tx.$queryRaw`SELECT id FROM "EventSetting" WHERE id = 1 FOR UPDATE`;
      const used = await tx.order.aggregate({ _sum: { quantity: true }, where: { OR: [{ status: 'PAID' }, { status: 'PENDING', expiresAt: { gt: new Date() } }] } });
      if (p.value.totalTickets != null && p.value.totalTickets < (used._sum.quantity ?? 0)) throw new HttpError(400, `Total cannot be below tickets already sold or reserved (${used._sum.quantity}).`);
      await tx.eventSetting.update({ where: { id: 1 }, data: p.value });
    });
    res.json({ ok: true });
  }));
  app.get('/api/admin/stats', requireAdmin, ah(async (_req, res) => {
    const s = await getSettings(prisma);
    const [paid, checkedIn] = await Promise.all([
      prisma.order.aggregate({ _sum: { quantity: true, amount: true }, where: { status: 'PAID' } }),
      prisma.ticket.count({ where: { usedAt: { not: null } } })]);
    res.json({ sold: paid._sum.quantity ?? 0, remaining: await remaining(prisma, s), checkedIn,
      revenue: new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(paid._sum.amount ?? 0) });
  }));

  // --- Gate scanner: atomic check-in, so a QR code can only ever be accepted once ---
  app.post('/api/scan', requireAdmin, requireJson, ah(async (req, res) => {
    const code = String(req.body?.code ?? '').trim().slice(0, 64);
    const hit = await prisma.ticket.updateMany({ where: { code, usedAt: null, order: { status: 'PAID' } }, data: { usedAt: new Date() } });
    if (hit.count === 1) return res.json({ status: 'valid' });
    const t = await prisma.ticket.findUnique({ where: { code }, include: { order: true } });
    if (t?.order.status === 'PAID' && t.usedAt) return res.json({ status: 'already_used', detail: `Checked in ${t.usedAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}` });
    res.json({ status: 'invalid' });
  }));

  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((err, _req, res, _next) => {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong.' });
  });
  return app;
}

// Webhooks are the ONLY way an order becomes PAID. Dedup + state change share one transaction.
async function handleEvent(evt) {
  await prisma.$transaction(async tx => {
    const fresh = await tx.webhookEvent.createMany({ data: [{ id: evt.id, type: evt.type }], skipDuplicates: true });
    if (fresh.count === 0) return; // already processed
    const d = evt.data ?? {};
    const order = d.checkout_id ? await tx.order.findUnique({ where: { bachsCheckoutId: String(d.checkout_id) } }) : null;
    if (!order) return;
    if (evt.type === 'collection.succeeded') {
      if (order.status === 'PAID') return;
      if (d.currency !== 'NGN' || !(toKobo(d.amount) >= order.amount * 100)) {
        console.warn('Underpaid/mismatched payment', order.reference, d.amount, d.currency);
        return void await tx.order.update({ where: { id: order.id }, data: { status: 'UNDERPAID', bachsChargeId: d.charge_id ?? null } });
      }
      if (order.status === 'EXPIRED') console.warn('Payment received after hold expired; fulfilling. Check inventory.', order.reference);
      await tx.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date(), bachsChargeId: d.charge_id ?? null } });
      await tx.ticket.createMany({ data: Array.from({ length: order.quantity }, () => ({ orderId: order.id, code: newTicketCode() })) });
    } else if (evt.type === 'collection.underpaid' && order.status === 'PENDING') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'UNDERPAID' } });
    } else if (evt.type === 'checkout.expired' && order.status === 'PENDING') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'EXPIRED' } });
    }
  });
}

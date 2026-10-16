import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { prisma } from './db.js';
import {
  checkPassword,
  setSession,
  clearSession,
  requireAdmin,
} from './auth.js';
import { createCheckoutSession } from './bachs.js';
import { verifyBachsSignature } from './lib/signature.js';
import { parseCheckout, parseSettings } from './lib/validate.js';
import { newTicketCode, newReference } from './lib/codes.js';
import { toKobo } from './lib/money.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { deliverTicketEmail, retryPendingEmails } from './notify.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const publicDirectory = path.resolve(currentDirectory, '../public');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ah = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const requireJson = (req, res, next) =>
  req.is('application/json')
    ? next()
    : res.status(415).json({
        error: 'Content-Type must be application/json.',
      });

const limiter = (windowMs, max) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests. Please wait and try again.',
    },
  });

const getSettings = (tx) =>
  tx.eventSetting.upsert({
    where: { id: 1 },
    update: {},
    create: config.eventDefaults,
  });

// Sold tickets + active reservations.
// null means inventory has not been configured.
async function remaining(tx, settings) {
  if (settings.totalTickets == null) {
    return null;
  }

  const result = await tx.order.aggregate({
    _sum: { quantity: true },
    where: {
      OR: [
        { status: 'PAID' },
        {
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      ],
    },
  });

  return Math.max(
    0,
    settings.totalTickets - (result._sum.quantity ?? 0),
  );
}

const publicStatus = (status) =>
  status === 'PAID'
    ? 'paid'
    : status === 'PENDING'
      ? 'pending'
      : 'failed';

export function createApp(expressFactory = express) {
  const app = expressFactory();

  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ['https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );

  // Bach.io webhook must receive the raw request body.
  // Keep this route before express.json().
  app.post(
    '/api/webhooks/bachs',
    express.raw({
      type: () => true,
      limit: '256kb',
    }),
    ah(async (req, res) => {
      if (!config.bachs.webhookSecret) {
        return res.status(503).json({
          error: 'Webhook secret not configured.',
        });
      }

      if (
        !verifyBachsSignature({
          rawBody: req.body,
          headers: req.headers,
          secret: config.bachs.webhookSecret,
        })
      ) {
        return res.status(400).json({
          error: 'Invalid signature.',
        });
      }

      let event;

      try {
        event = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({
          error: 'Invalid JSON.',
        });
      }

      const paidOrderId =
        event?.id && event?.type ? await handleEvent(event) : null;

      // Serverless hosts (Vercel) may stop work once the response is sent,
      // so the email goes out BEFORE replying. It never throws; anything
      // that fails is retried by /api/cron/send-emails.
      if (paidOrderId) {
        await deliverTicketEmail(paidOrderId);
      }

      return res.json({ ok: true });
    }),
  );

  app.use(express.json({ limit: '20kb' }));

  // Public event information.
  app.get(
    '/api/event',
    ah(async (_req, res) => {
      const settings = await getSettings(prisma);
      const ticketsRemaining = await remaining(prisma, settings);

      res.json({
        name: settings.name,
        date: settings.date,
        startTime: settings.startTime,
        venue: settings.venue,
        price: settings.priceNaira,
        salesOpen:
          settings.salesOpen &&
          settings.totalTickets > 0 &&
          !!config.bachs.apiKey,
        ticketsRemaining,
        maxPerOrder: settings.maxPerOrder,
        contactEmail: settings.contactEmail,
      });
    }),
  );

  // Create an order and start Bach.io checkout.
  app.post(
    '/api/checkout',
    limiter(60_000, 10),
    requireJson,
    ah(async (req, res) => {
      if (!config.bachs.apiKey) {
        throw new HttpError(
          503,
          'Payments are not configured yet.',
        );
      }

      const input = parseCheckout(req.body);

      if (input.error) {
        throw new HttpError(400, input.error);
      }

      const checkoutInput = input.value;

      // Lock the event row to prevent concurrent overselling.
      const order = await prisma.$transaction(async (tx) => {
        await getSettings(tx);

        await tx.$queryRaw`
          SELECT id
          FROM "EventSetting"
          WHERE id = 1
          FOR UPDATE
        `;

        const settings = await getSettings(tx);
        const ticketsRemaining = await remaining(tx, settings);

        if (!settings.salesOpen || !(settings.totalTickets > 0)) {
          throw new HttpError(
            409,
            'Ticket sales are not open.',
          );
        }

        if (ticketsRemaining < checkoutInput.quantity) {
          throw new HttpError(
            409,
            ticketsRemaining === 0
              ? 'Tickets are sold out.'
              : `Only ${ticketsRemaining} ticket(s) left.`,
          );
        }

        if (
          settings.maxPerOrder &&
          checkoutInput.quantity > settings.maxPerOrder
        ) {
          throw new HttpError(
            400,
            `Maximum ${settings.maxPerOrder} tickets per order.`,
          );
        }

        return tx.order.create({
          data: {
            reference: newReference(),
            buyerName: checkoutInput.name,
            buyerEmail: checkoutInput.email,
            buyerPhone: checkoutInput.phone,
            quantity: checkoutInput.quantity,
            unitPrice: settings.priceNaira,
            amount:
              settings.priceNaira * checkoutInput.quantity,
            expiresAt: new Date(
              Date.now() + config.holdMinutes * 60_000,
            ),
          },
        });
      });

      try {
        const { checkoutId, checkoutUrl } =
          await createCheckoutSession(order);

        await prisma.order.update({
          where: { id: order.id },
          data: { bachsCheckoutId: checkoutId },
        });

        res.json({ paymentUrl: checkoutUrl });
      } catch (error) {
        console.error('Failed to start Bach.io checkout:', error);

        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });

        throw new HttpError(
          502,
          'Could not start payment. Please try again.',
        );
      }
    }),
  );

  // Buyer self-service: email the ticket link(s) again.
  // Same reply whether or not the email has paid orders (no enumeration).
  app.post(
    '/api/orders/resend',
    limiter(15 * 60_000, 5),
    requireJson,
    ah(async (req, res) => {
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, 'Enter a valid email address.');
      }

      const orders = await prisma.order.findMany({
        where: { buyerEmail: email, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        take: 5,
        select: { id: true },
      });

      for (const order of orders) {
        await deliverTicketEmail(order.id, { force: true });
      }

      return res.json({ ok: true });
    }),
  );

  // Retries confirmation emails that failed. Vercel Cron calls this with
  // "Authorization: Bearer <CRON_SECRET>".
  app.get(
    '/api/cron/send-emails',
    ah(async (req, res) => {
      const sha = (value) => createHash('sha256').update(String(value)).digest();
      const authorised =
        config.cronSecret &&
        timingSafeEqual(
          sha(req.headers.authorization ?? ''),
          sha(`Bearer ${config.cronSecret}`),
        );

      if (!authorised) {
        return res.status(401).json({ error: 'Unauthorized.' });
      }

      await retryPendingEmails();
      return res.json({ ok: true });
    }),
  );

  // Look up an order using its reference or checkout ID.
  app.get(
    '/api/orders/:key',
    limiter(60_000, 60),
    ah(async (req, res) => {
      const key = req.params.key;

      const order = await prisma.order.findFirst({
        where: key.startsWith('chk_')
          ? { bachsCheckoutId: key }
          : { reference: key },
        include: { tickets: true },
      });

      if (!order) {
        throw new HttpError(404, 'Order not found.');
      }

      const settings = await getSettings(prisma);

      res.json({
        status: publicStatus(order.status),
        eventName: settings.name,
        eventDate: settings.date,
        buyerName: order.buyerName,
        tickets:
          order.status === 'PAID'
            ? order.tickets.map((ticket) => ({
                code: ticket.code,
              }))
            : [],
      });
    }),
  );

  // Generate an SVG QR code for a paid ticket.
  app.get(
    '/api/tickets/:code/qr.svg',
    limiter(60_000, 120),
    ah(async (req, res) => {
      const ticket = await prisma.ticket.findUnique({
        where: { code: req.params.code },
        include: { order: true },
      });

      if (!ticket || ticket.order.status !== 'PAID') {
        throw new HttpError(404, 'Ticket not found.');
      }

      const svg = await QRCode.toString(ticket.code, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
      });

      res
        .type('image/svg+xml')
        .set('Cache-Control', 'private, max-age=3600')
        .send(svg);
    }),
  );

  // Admin authentication.
  app.post(
    '/api/admin/login',
    limiter(15 * 60_000, 10),
    requireJson,
    (req, res) => {
      if (!checkPassword(req.body?.password)) {
        return res.status(401).json({
          error: 'Incorrect password.',
        });
      }

      setSession(res);
      return res.json({ ok: true });
    },
  );

  app.post('/api/admin/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  // Admin event settings.
  app.get(
    '/api/admin/settings',
    requireAdmin,
    ah(async (_req, res) => {
      const settings = await getSettings(prisma);

      res.json({
        ...settings,
        price: settings.priceNaira,
      });
    }),
  );

  app.put(
    '/api/admin/settings',
    requireAdmin,
    requireJson,
    ah(async (req, res) => {
      const parsed = parseSettings(req.body);

      if (parsed.error) {
        throw new HttpError(400, parsed.error);
      }

      await prisma.$transaction(async (tx) => {
        await getSettings(tx);

        await tx.$queryRaw`
          SELECT id
          FROM "EventSetting"
          WHERE id = 1
          FOR UPDATE
        `;

        const used = await tx.order.aggregate({
          _sum: { quantity: true },
          where: {
            OR: [
              { status: 'PAID' },
              {
                status: 'PENDING',
                expiresAt: { gt: new Date() },
              },
            ],
          },
        });

        const alreadyAllocated = used._sum.quantity ?? 0;

        if (
          parsed.value.totalTickets != null &&
          parsed.value.totalTickets < alreadyAllocated
        ) {
          throw new HttpError(
            400,
            `Total cannot be below tickets already sold or reserved (${alreadyAllocated}).`,
          );
        }

        await tx.eventSetting.update({
          where: { id: 1 },
          data: parsed.value,
        });
      });

      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/admin/stats',
    requireAdmin,
    ah(async (_req, res) => {
      const settings = await getSettings(prisma);

      const [paid, checkedIn] = await Promise.all([
        prisma.order.aggregate({
          _sum: {
            quantity: true,
            amount: true,
          },
          where: { status: 'PAID' },
        }),
        prisma.ticket.count({
          where: { usedAt: { not: null } },
        }),
      ]);

      res.json({
        sold: paid._sum.quantity ?? 0,
        remaining: await remaining(prisma, settings),
        checkedIn,
        revenue: new Intl.NumberFormat('en-NG', {
          style: 'currency',
          currency: 'NGN',
          maximumFractionDigits: 0,
        }).format(paid._sum.amount ?? 0),
      });
    }),
  );

  // Gate scanner: a paid ticket can only be checked in once.
  app.post(
    '/api/scan',
    requireAdmin,
    requireJson,
    ah(async (req, res) => {
      const code = String(req.body?.code ?? '')
        .trim()
        .slice(0, 64);

      const hit = await prisma.ticket.updateMany({
        where: {
          code,
          usedAt: null,
          order: { status: 'PAID' },
        },
        data: { usedAt: new Date() },
      });

      if (hit.count === 1) {
        return res.json({ status: 'valid' });
      }

      const ticket = await prisma.ticket.findUnique({
        where: { code },
        include: { order: true },
      });

      if (
        ticket?.order.status === 'PAID' &&
        ticket.usedAt
      ) {
        return res.json({
          status: 'already_used',
          detail: `Checked in ${ticket.usedAt.toLocaleString(
            'en-NG',
            { timeZone: 'Africa/Lagos' },
          )}`,
        });
      }

      return res.json({ status: 'invalid' });
    }),
  );

  // Serve public assets from the project's public directory.
  app.use(express.static(publicDirectory));

  // API fallback.
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'Not found.' }),
  );

  // Centralized error handler.
  app.use((err, _req, res, _next) => {
    if (!err.status) {
      console.error(err);
    }

    res.status(err.status || 500).json({
      error: err.status
        ? err.message
        : 'Something went wrong.',
    });
  });

  return app;
}


// Webhooks are the ONLY way an order becomes PAID.
// Event deduplication and the state change share one transaction.
async function handleEvent(event) {
  let fulfilledOrderId = null;

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.webhookEvent.createMany({
      data: [
        {
          id: event.id,
          type: event.type,
        },
      ],
      skipDuplicates: true,
    });

    if (fresh.count === 0) {
      return;
    }

    const data = event.data ?? {};

    const order = data.checkout_id
      ? await tx.order.findUnique({
          where: {
            bachsCheckoutId: String(data.checkout_id),
          },
        })
      : null;

    if (!order) {
      return;
    }

    if (event.type === 'collection.succeeded') {
      if (order.status === 'PAID') {
        return;
      }

      if (
        data.currency !== 'NGN' ||
        !(toKobo(data.amount) >= order.amount * 100)
      ) {
        console.warn(
          'Underpaid/mismatched payment',
          order.reference,
          data.amount,
          data.currency,
        );

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'UNDERPAID',
            bachsChargeId: data.charge_id ?? null,
          },
        });

        return;
      }

      if (order.status === 'EXPIRED') {
        console.warn(
          'Payment received after hold expired; fulfilling. Check inventory.',
          order.reference,
        );
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          bachsChargeId: data.charge_id ?? null,
        },
      });

      await tx.ticket.createMany({
        data: Array.from(
          { length: order.quantity },
          () => ({
            orderId: order.id,
            code: newTicketCode(),
          }),
        ),
      });

      fulfilledOrderId = order.id;
    } else if (
      event.type === 'collection.underpaid' &&
      order.status === 'PENDING'
    ) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'UNDERPAID' },
      });
    } else if (
      event.type === 'checkout.expired' &&
      order.status === 'PENDING'
    ) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'EXPIRED' },
      });
    }
  });
  return fulfilledOrderId;
}
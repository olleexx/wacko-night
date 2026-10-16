import nodemailer from 'nodemailer';
import { config } from './config.js';
import { prisma } from './db.js';
import { buildTicketEmail } from './lib/email.js';

const { host, port, user, pass, from } = config.smtp;
export const mailConfigured = () => !!(host && from);
const transport = mailConfigured() ? nodemailer.createTransport({ host, port, secure: port === 465, connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 6000, auth: user ? { user, pass } : undefined }) : null;

// Never throws into the payment flow; a failed send stays retryable (emailSentAt stays null).
export async function deliverTicketEmail(orderId, { force = false } = {}) {
  try {
    if (!transport) return console.warn('SMTP not configured: confirmation email not sent for', orderId);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'PAID' || (order.emailSentAt && !force)) return;
    const event = await prisma.eventSetting.findUnique({ where: { id: 1 } });
    const m = buildTicketEmail({ order, event, appUrl: config.appUrl });
    await transport.sendMail({ from, to: order.buyerEmail, ...m });
    await prisma.order.update({ where: { id: order.id }, data: { emailSentAt: new Date() } });
  } catch (e) { console.error('Ticket email failed for', orderId, e.message); }
}
export async function retryPendingEmails() {
  if (!transport) return;
  const rows = await prisma.order.findMany({ where: { status: 'PAID', emailSentAt: null, paidAt: { gt: new Date(Date.now() - 3 * 86400_000) } }, take: 20, select: { id: true } });
  for (const r of rows) await deliverTicketEmail(r.id);
}
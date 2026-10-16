import 'dotenv/config';
const need = k => { const v = process.env[k]; if (!v) throw new Error(`Missing required environment variable ${k}`); return v; };
export const config = {
  port: Number(process.env.PORT || 3000),
  appUrl: need('APP_URL').replace(/\/$/, ''),
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  isProd: process.env.NODE_ENV === 'production',
  sessionSecret: need('SESSION_SECRET'),
  adminPassword: need('ADMIN_PASSWORD'),
  cronSecret: process.env.CRON_SECRET || '',
  smtp: { host: process.env.SMTP_HOST || '', port: Number(process.env.SMTP_PORT || 587), user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.SMTP_FROM || '' },
  bachs: { apiKey: process.env.BACHS_API_KEY || '', webhookSecret: process.env.BACHS_WEBHOOK_SECRET || '' },
  // Used ONLY to create the first event record. After that the admin dashboard is the source of truth.
  eventDefaults: {
    id: 1, name: 'WACKO NIGHT', date: '2026-11-07', startTime: null,
    venue: 'Reeplay Car Park, Under, Ogbomoso, Oyo State, Nigeria',
    priceNaira: 3000, totalTickets: null, maxPerOrder: null, contactEmail: null, salesOpen: false
  },
  holdMinutes: 30 // unpaid orders reserve inventory this long
};
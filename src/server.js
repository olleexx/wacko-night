import express from 'express';
import { config } from './config.js';
import { createApp } from './application.js';
import { prisma } from './db.js';
import { retryPendingEmails, mailConfigured } from './notify.js';

const app = createApp(express);

// Export the Express app for Vercel.
export default app;

// Vercel manages its own server.
// Only start a listening server during local development.
if (process.env.VERCEL !== '1') {
  if (!config.bachs.apiKey) {
    console.warn(
      'BACHS_API_KEY not set: checkout is disabled until you add it.'
    );
  }

  if (!config.bachs.webhookSecret) {
    console.warn(
      'BACHS_WEBHOOK_SECRET not set: payments cannot be confirmed until you add it.'
    );
  }

  if (!mailConfigured()) {
    console.warn(
      'SMTP_HOST/SMTP_FROM not set: confirmation emails are disabled (buyers can still use their ticket link).'
    );
  }

  // Local/VPS only. On Vercel, /api/cron/send-emails does this job.
  setInterval(
    () => retryPendingEmails().catch(console.error),
    5 * 60_000
  ).unref();

  const server = app.listen(config.port, () => {
    console.log(`WACKO NIGHT listening on :${config.port}`);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      server.close(async () => {
        try {
          await prisma.$disconnect();
          process.exit(0);
        } catch (error) {
          console.error('Error disconnecting Prisma:', error);
          process.exit(1);
        }
      });
    });
  }
}
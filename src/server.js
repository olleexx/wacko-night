import { config } from './config.js';
import { createApp } from './app.js';
import { prisma } from './db.js';
if (!config.bachs.apiKey) console.warn('BACHS_API_KEY not set: checkout is disabled until you add it.');
if (!config.bachs.webhookSecret) console.warn('BACHS_WEBHOOK_SECRET not set: payments cannot be confirmed until you add it.');
const server = createApp().listen(config.port, () => console.log(`WACKO NIGHT listening on :${config.port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(async () => { await prisma.$disconnect(); process.exit(0); }));

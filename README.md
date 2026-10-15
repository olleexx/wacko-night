# WACKO NIGHT ticketing

Express + Prisma/PostgreSQL backend serving the vanilla HTML/CSS/JS frontend in `public/`.
Payments: **Bachs (Bach.io)** hosted checkout, confirmed only by signed webhooks.

## Install
```bash
npm install
cp .env.example .env        # then fill it in (see below)
npx prisma migrate dev --name init   # creates tables; commit the generated prisma/migrations folder
npm run dev                 # http://localhost:3000
npm test                    # unit tests (signature, money, validation, codes)
```
Requires Node 22+ and a PostgreSQL database.

## Environment variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public HTTPS URL of the site (Bachs rejects localhost success URLs, even in sandbox; use a tunnel for local payment tests) |
| `SESSION_SECRET` | Long random string (`openssl rand -hex 32`) |
| `ADMIN_PASSWORD` | Admin and gate-scanner sign-in |
| `BACHS_API_KEY` | `sk_sandbox_...` to test, `sk_live_...` for production (environment is chosen from the prefix) |
| `BACHS_WEBHOOK_SECRET` | Signing secret of your Bachs webhook endpoint |
| `TRUST_PROXY` | `1` when behind one reverse proxy (Render, Railway, Nginx) |
| `NODE_ENV` | `production` in production (secure cookies) |

## Bachs setup (docs.bachs.io)
1. Create a Bachs account and copy a **sandbox** API key into `BACHS_API_KEY`.
2. Confirm in Bachs that NGN collection (`NGN_CARD` / `NGN_BANK_TRANSFER`) is enabled for your account.
3. Developer Portal → Webhooks → **Add destination**: URL `https://YOUR_DOMAIN/api/webhooks/bachs`; subscribe to `collection.succeeded`, `collection.underpaid`, `checkout.expired` (add `collection.failed`, `checkout.completed` if you want them logged; they are ignored).
4. Copy the endpoint's **signing secret** into `BACHS_WEBHOOK_SECRET`.
5. Test the full flow in sandbox, then swap in the `sk_live_` key and create the webhook endpoint again for live.

## First-time configuration (admin dashboard `/admin.html`)
Sales stay **closed** until you set **Total tickets** and tick "sales are open". Also set start time and contact email when known. Price defaults to ₦3,000 and is always charged from the server-side value.
Gate staff sign in on `/admin.html`, then open `/scan.html` (same browser).

## Deploy
1. Provision PostgreSQL and a Node 22 host with HTTPS. 2. Set the env vars above. 3. Build step: `npm ci && npx prisma generate`. 4. Release step: `npx prisma migrate deploy`. 5. Start: `npm start`. 6. Register the live webhook URL, place a small real test order, scan its QR.

## How it works / decisions
- **Inventory**: sold + unpaid orders inside their 30-minute hold count against the total; the event row is locked during checkout so concurrent buyers can't oversell.
- **Payment**: server creates a Bachs checkout session with a raw `pricing` amount (`"3000.00"`, NGN) and a unique `reference`. A ticket is issued only on a signature-verified `collection.succeeded` whose currency is NGN and amount is at least the order amount. Redirects never grant tickets.
- **Webhooks**: HMAC-SHA256 over `{timestamp}.{raw_body}`, `X-Bachs-Signature-V2` preferred (any `v1` accepted for rotation), legacy headers as fallback, 300 s tolerance, event-id de-duplication.
- **Entry**: QR encodes a 128-bit random code; `/api/scan` marks it used with one atomic update, so a second scan returns "Already used".
- **Late payments**: if money arrives after a hold expired, tickets are still issued (the customer has paid) and a warning is logged; check inventory and refund in Bachs if needed.

## Not verified yet
No database, network, or Bachs account was available while building, so only the pure logic is tested. Before launch: run the sandbox flow end to end, confirm the Bachs response fields (`checkout_id`, `checkout_url`) and your account's NGN settings, and test with two phones scanning one ticket.

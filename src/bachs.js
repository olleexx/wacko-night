// Bachs (Bach.io) hosted checkout. Docs: https://docs.bachs.io/guides/checkout/checkout-sessions
import { config } from './config.js';
import { toDecimal } from './lib/money.js';
const base = () => config.bachs.apiKey.startsWith('sk_live_') ? 'https://api.bachs.io' : 'https://sandbox-api.bachs.io';
export async function createCheckoutSession(order) {
  const res = await fetch(`${base()}/v1/checkout-sessions`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${config.bachs.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pricing: { currency: 'NGN', amount: toDecimal(order.amount) }, // raw amount, decimal string, computed server-side
      customer: { email: order.buyerEmail, name: order.buyerName, phone_number: order.buyerPhone },
      success_url: `${config.appUrl}/ticket.html`, // Bachs appends ?checkout_id=
      cancel_url: config.appUrl,
      reference: order.reference,
      metadata: { orderReference: order.reference },
      expires_in_minutes: config.holdMinutes
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.checkout_id || !data.checkout_url) {
    console.error('Bachs checkout-session failed', res.status, JSON.stringify(data).slice(0, 500));
    throw new Error('bachs_failed');
  }
  return { checkoutId: data.checkout_id, checkoutUrl: data.checkout_url };
}

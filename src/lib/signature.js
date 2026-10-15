import { createHmac, timingSafeEqual } from 'node:crypto';
const hmac = (secret, ts, raw) => createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Bachs signs "{timestamp}.{raw_body}" with HMAC-SHA256. Prefer X-Bachs-Signature-V2
// ("t=<ts>,v1=<sig>[,v1=<sig>]"; accept ANY v1 so secret rotation works), else the legacy pair.
export function verifyBachsSignature({ rawBody, headers, secret, tolerance = 300, now = Date.now() }) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  let ts, sigs = [];
  const v2 = headers['x-bachs-signature-v2'];
  if (v2) {
    for (const p of String(v2).split(',')) {
      const i = p.indexOf('='); if (i < 0) continue;
      const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
      if (k === 't') ts = v; else if (k === 'v1') sigs.push(v);
    }
  } else { ts = headers['x-bachs-timestamp']; sigs = [headers['x-bachs-signature']].filter(Boolean); }
  const t = Number(ts);
  if (!Number.isInteger(t) || !sigs.length || Math.abs(now / 1000 - t) > tolerance) return false;
  const expected = hmac(secret, t, rawBody);
  return sigs.some(s => same(expected, String(s)));
}
export const signForTest = hmac;

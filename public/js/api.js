// Shared helpers. DEFAULTS is the ONLY place confirmed event details live in the frontend;
// they are used until GET /api/event (admin-configured event record) responds.
export const DEFAULTS = {
  name: 'WACKO NIGHT', date: '2026-11-07', startTime: null, price: 3000,
  venue: 'Reeplay Car Park, Under, Ogbomoso, Oyo State, Nigeria',
  salesOpen: false, ticketsRemaining: null, maxPerOrder: null, contactEmail: null
};
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
export async function loadEvent() {
  try { return { ...DEFAULTS, ...(await api('/api/event')), live: true }; }
  catch { return { ...DEFAULTS, live: false }; }
}
export const naira = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(n);
export const longDate = d => new Date(d + 'T12:00:00+01:00').toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const $ = (s, r = document) => r.querySelector(s);
export function show(el, text, kind = 'err') { el.hidden = !text; el.className = 'msg ' + kind; el.textContent = text || ''; }

import { loadEvent, api, naira, longDate, $, show } from './api.js';
const ev = await loadEvent();
document.title = `${ev.name} · Tickets`;
document.querySelectorAll('[data-bind]').forEach(el => {
  const k = el.dataset.bind;
  el.textContent = k === 'date' ? longDate(ev.date) : k === 'price' ? naira(ev.price) : k === 'startTime' ? (ev.startTime || 'To be announced') : ev[k];
});
// Countdown: to start time if configured, otherwise to the start of the event date (Lagos time, UTC+1)
const target = new Date(`${ev.date}T${ev.startTime || '00:00'}:00+01:00`).getTime();
const tick = () => {
  const s = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const v = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
  for (const k in v) $(`#c-${k}`).textContent = String(v[k]).padStart(2, '0');
};
tick(); setInterval(tick, 1000);
if (ev.contactEmail) { const a = $('#contact'); a.href = 'mailto:' + ev.contactEmail; a.textContent = ev.contactEmail; a.parentElement.hidden = false; }

const form = $('#buy'), msg = $('#msg'), qty = $('#quantity');
const canSell = ev.live && ev.salesOpen && (ev.ticketsRemaining === null || ev.ticketsRemaining > 0);
if (ev.ticketsRemaining !== null) qty.max = ev.ticketsRemaining;
if (ev.maxPerOrder) qty.max = Math.min(+qty.max || Infinity, ev.maxPerOrder);
const total = () => $('#total').textContent = naira(ev.price * (Number(qty.value) || 0));
qty.addEventListener('input', total); total();
if (!ev.live) show(msg, 'Ticket sales are unavailable right now. Please check back soon.', 'warn');
else if (!ev.salesOpen) show(msg, 'Ticket sales have not opened yet.', 'warn');
else if (ev.ticketsRemaining === 0) show(msg, 'Tickets are sold out.', 'warn');
$('#pay').disabled = !canSell;

form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#pay'); btn.disabled = true; show(msg, '');
  try {
    const f = new FormData(form);
    // Only buyer details + quantity are sent. The server sets the price and amount.
    const r = await api('/api/checkout', { method: 'POST', body: { name: f.get('name'), email: f.get('email'), phone: f.get('phone'), quantity: Number(f.get('quantity')) } });
    if (!r.paymentUrl) throw new Error('Payment link was not returned. Please try again.');
    show(msg, 'Redirecting to Bach.io to complete payment…', 'ok');
    location.href = r.paymentUrl;
  } catch (err) { show(msg, err.message); btn.disabled = false; }
});

import { api, $, show, setBusy } from './api.js';
const q = new URLSearchParams(location.search), ref = q.get('ref') || q.get('checkout_id'); // Bachs appends ?checkout_id= on return
const msg = $('#msg'), list = $('#tickets');
const rf = $('#resend');
if (!ref) { show(msg, 'Open the link from your confirmation email, or have it sent again below.', 'warn'); rf.hidden = false; }
else poll(0);
async function poll(n) {
  try {
    const o = await api('/api/orders/' + encodeURIComponent(ref));
    if (o.status === 'paid') {
      show(msg, 'Payment confirmed. Show these QR codes at the gate. Each one admits one person, once.', 'ok');
      list.replaceChildren(...o.tickets.map(t => {
        const d = document.createElement('div'); d.className = 'permit';
        const img = new Image(); img.alt = 'QR code for ticket ' + t.code; img.src = `/api/tickets/${encodeURIComponent(t.code)}/qr.svg`;
        const b = document.createElement('div'), h = document.createElement('h3'), c = document.createElement('code');
        h.textContent = o.eventName; c.textContent = t.code;
        const p = document.createElement('p'); p.textContent = `${o.buyerName} · ${o.eventDate}`;
        b.append(h, p, c); d.append(img, b); return d;
      }));
    } else if (o.status === 'failed') show(msg, 'Payment failed or was cancelled. Return to the homepage to try again.', 'err');
    else if (n < 30) { show(msg, 'Confirming your payment with Bach.io…', 'warn'); msg.classList.add('spin'); setTimeout(() => poll(n + 1), 4000); }
    else show(msg, 'Payment is still pending. If you were charged, your tickets will appear here once confirmed. Keep this page link.', 'warn');
  } catch (e) { show(msg, e.message); }
}
rf.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = rf.querySelector('button'); setBusy(btn, true);
  try { await api('/api/orders/resend', { method: 'POST', body: { email: rf.elements.email.value } }); show(msg, 'If that email has paid orders, we have sent the ticket link. Check your inbox and spam folder.', 'ok'); rf.reset(); }
  catch (err) { show(msg, err.message); }
  finally { setBusy(btn, false); }
});
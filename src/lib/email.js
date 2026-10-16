const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function buildTicketEmail({ order, event, appUrl }) {
  const link = `${appUrl}/ticket.html?ref=${encodeURIComponent(order.reference)}`;
  const n = order.quantity, when = event.startTime ? `${event.date}, ${event.startTime}` : event.date;
  const subject = `Your ${event.name} ticket${n > 1 ? 's' : ''}`;
  const text = `Hi ${order.buyerName},\n\nPayment received. Your ${n} ticket${n > 1 ? 's are' : ' is'} ready.\n\nOpen your QR ticket${n > 1 ? 's' : ''}: ${link}\n\n${event.name}\n${when}\n${event.venue}\n\nShow the QR code at the gate. Each code admits one person, once. Keep this email: the link is your ticket.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px"><h2>${esc(event.name)}</h2><p>Hi ${esc(order.buyerName)}, payment received. Your ${n} ticket${n > 1 ? 's are' : ' is'} ready.</p><p><a href="${esc(link)}" style="background:#ffcf1f;color:#111;padding:12px 20px;text-decoration:none;font-weight:bold;border-radius:6px;display:inline-block">Open your QR ticket${n > 1 ? 's' : ''}</a></p><p>${esc(when)}<br>${esc(event.venue)}</p><p style="color:#555">Show the QR code at the gate. Each code admits one person, once. Keep this email: the link is your ticket.</p></div>`;
  return { subject, text, html };
}
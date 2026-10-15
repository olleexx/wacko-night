const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const int = v => (typeof v === 'number' && Number.isInteger(v)) ? v : NaN;
export function parseCheckout(b) {
  const name = String(b?.name ?? '').trim(), email = String(b?.email ?? '').trim().toLowerCase();
  const phone = String(b?.phone ?? '').trim(), quantity = int(b?.quantity);
  if (name.length < 2 || name.length > 100) return { error: 'Enter your full name.' };
  if (!EMAIL.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (!/^\+?[0-9\s-]{7,20}$/.test(phone)) return { error: 'Enter a valid phone number.' };
  if (!(quantity >= 1)) return { error: 'Choose at least 1 ticket.' };
  return { value: { name, email, phone, quantity } };
}
export function parseSettings(b) {
  const s = v => (v == null || v === '') ? null : String(v).trim();
  const date = s(b?.date), startTime = s(b?.startTime), name = s(b?.name), venue = s(b?.venue), contactEmail = s(b?.contactEmail);
  const opt = v => v == null ? null : int(v);
  const priceNaira = int(b?.price), totalTickets = opt(b?.totalTickets), maxPerOrder = opt(b?.maxPerOrder);
  if (!name || name.length > 100) return { error: 'Event name is required (max 100 characters).' };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return { error: 'Enter a valid event date.' };
  if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return { error: 'Start time must be HH:MM.' };
  if (!venue || venue.length > 200) return { error: 'Venue is required (max 200 characters).' };
  if (!(priceNaira >= 1 && priceNaira <= 10_000_000)) return { error: 'Price must be a whole number of naira, at least ₦1.' };
  if (totalTickets !== null && !(totalTickets >= 0 && totalTickets <= 100_000)) return { error: 'Total tickets must be a whole number.' };
  if (maxPerOrder !== null && !(maxPerOrder >= 1)) return { error: 'Max per order must be at least 1.' };
  if (contactEmail && !EMAIL.test(contactEmail)) return { error: 'Contact email is not valid.' };
  if (typeof b?.salesOpen !== 'boolean') return { error: 'salesOpen must be true or false.' };
  if (b.salesOpen && !(totalTickets > 0)) return { error: 'Set the total ticket quantity before opening sales.' };
  return { value: { name, date, startTime, venue, priceNaira, totalTickets, maxPerOrder, contactEmail, salesOpen: b.salesOpen } };
}

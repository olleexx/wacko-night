import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
const COOKIE = 'wn_admin', TTL = 12 * 3600;
const sign = exp => createHmac('sha256', config.sessionSecret).update(String(exp)).digest('base64url');
const sha = s => createHash('sha256').update(s).digest();
export const checkPassword = p => timingSafeEqual(sha(String(p ?? '')), sha(config.adminPassword));
export function setSession(res) {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  res.cookie(COOKIE, `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge: TTL * 1000, path: '/' });
}
export const clearSession = res => res.clearCookie(COOKIE, { path: '/' });
export function requireAdmin(req, res, next) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  const [exp, sig] = (raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : '').split('.');
  const ok = exp && sig && Number(exp) > Date.now() / 1000 && sig.length === sign(exp).length && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp)));
  return ok ? next() : res.status(401).json({ error: 'Admin sign-in required.' });
}

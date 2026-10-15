import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBachsSignature, signForTest } from '../src/lib/signature.js';
import { toKobo, toDecimal } from '../src/lib/money.js';
import { parseCheckout, parseSettings } from '../src/lib/validate.js';
import { newTicketCode, newReference } from '../src/lib/codes.js';

const secret = 'whsec_test', body = Buffer.from('{"id":"evt_1","type":"collection.succeeded"}');
const now = 1_800_000_000_000, ts = now / 1000, sig = signForTest(secret, ts, body);

test('accepts valid V2 signature, including during secret rotation', () => {
  assert.ok(verifyBachsSignature({ rawBody: body, secret, now, headers: { 'x-bachs-signature-v2': `t=${ts},v1=${sig}` } }));
  assert.ok(verifyBachsSignature({ rawBody: body, secret, now, headers: { 'x-bachs-signature-v2': `t=${ts},v1=${'0'.repeat(64)},v1=${sig}` } }));
});
test('accepts valid legacy header pair', () => {
  assert.ok(verifyBachsSignature({ rawBody: body, secret, now, headers: { 'x-bachs-timestamp': String(ts), 'x-bachs-signature': sig } }));
});
test('rejects tampered body, wrong secret, stale timestamp, missing headers', () => {
  const h = { 'x-bachs-signature-v2': `t=${ts},v1=${sig}` };
  assert.equal(verifyBachsSignature({ rawBody: Buffer.from('{"id":"x"}'), secret, now, headers: h }), false);
  assert.equal(verifyBachsSignature({ rawBody: body, secret: 'other', now, headers: h }), false);
  assert.equal(verifyBachsSignature({ rawBody: body, secret, now: now + 301_000, headers: h }), false);
  assert.equal(verifyBachsSignature({ rawBody: body, secret, now, headers: {} }), false);
  assert.equal(verifyBachsSignature({ rawBody: body, secret: '', now, headers: h }), false);
});
test('money helpers use decimal strings and exact integer comparison', () => {
  assert.equal(toDecimal(3000), '3000.00');
  assert.equal(toKobo('3000.00'), 300000); assert.equal(toKobo('3000.5'), 300050); assert.equal(toKobo('3000'), 300000);
  assert.ok(Number.isNaN(toKobo('abc'))); assert.ok(Number.isNaN(toKobo('-5.00'))); assert.ok(Number.isNaN(toKobo(undefined)));
});
test('checkout validation', () => {
  const ok = { name: 'Ada Obi', email: 'ADA@Example.com', phone: '+234 801 234 5678', quantity: 2 };
  assert.equal(parseCheckout(ok).value.email, 'ada@example.com');
  assert.ok(parseCheckout({ ...ok, quantity: 0 }).error); assert.ok(parseCheckout({ ...ok, quantity: 1.5 }).error);
  assert.ok(parseCheckout({ ...ok, quantity: '2' }).error); assert.ok(parseCheckout({ ...ok, email: 'nope' }).error);
  assert.ok(parseCheckout({ ...ok, name: '' }).error);
});
test('settings validation: sales cannot open without inventory', () => {
  const s = { name: 'WACKO NIGHT', date: '2026-11-07', startTime: null, venue: 'Somewhere', price: 3000, totalTickets: null, maxPerOrder: null, contactEmail: null, salesOpen: false };
  assert.ok(parseSettings(s).value);
  assert.ok(parseSettings({ ...s, salesOpen: true }).error);
  assert.ok(parseSettings({ ...s, salesOpen: true, totalTickets: 0 }).error);
  assert.ok(parseSettings({ ...s, salesOpen: true, totalTickets: 100 }).value);
  assert.ok(parseSettings({ ...s, price: 0 }).error); assert.ok(parseSettings({ ...s, startTime: '25:00' }).error);
});
test('ticket codes are unique and unguessable length', () => {
  const codes = new Set(Array.from({ length: 1000 }, newTicketCode));
  assert.equal(codes.size, 1000); assert.ok([...codes][0].length >= 22); assert.match(newReference(), /^WN-[\w-]{12}$/);
});

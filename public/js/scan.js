import { api, $ } from './api.js';
const out = $('#result'), video = $('#cam'), recent = new Map();
const LABEL = { valid: ['Admit', 'valid'], already_used: ['Already used', 'used'], invalid: ['Invalid ticket', 'invalid'] };
async function check(code) {
  code = code.trim(); if (!code || Date.now() - (recent.get(code) || 0) < 3000) return;
  recent.set(code, Date.now());
  try {
    const r = await api('/api/scan', { method: 'POST', body: { code } });
    const [t, c] = LABEL[r.status] || LABEL.invalid;
    out.className = 'result ' + c; out.textContent = t;
    if (r.detail) { const s = document.createElement('div'); s.style.cssText = 'font:500 1rem "DM Sans",sans-serif'; s.textContent = r.detail; out.append(s); }
  } catch (e) { out.className = 'result invalid'; out.textContent = e.status === 401 ? 'Staff sign-in required' : e.message; }
}
$('#manual').addEventListener('submit', e => { e.preventDefault(); check($('#code').value); e.target.reset(); });
$('#start').addEventListener('click', async () => {
  if (!('BarcodeDetector' in window)) return alert('Camera scanning is not supported in this browser. Type the ticket code instead, or use Chrome on Android.');
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    await video.play(); video.hidden = false;
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    (async function loop() { const f = await det.detect(video).catch(() => []); if (f[0]) await check(f[0].rawValue); setTimeout(loop, 250); })();
  } catch { alert('Camera access was blocked. Allow camera permission or type the code instead.'); }
});

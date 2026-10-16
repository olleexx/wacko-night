import { api, $, setBusy } from './api.js';
const out = $('#result'), video = $('#cam'), hint = $('#hint'), startBtn = $('#start'), recent = new Map();
const LABEL = { valid: ['Admit', 'valid'], already_used: ['Already used', 'used'], invalid: ['Invalid ticket', 'invalid'] };

async function check(code) {
  code = code.trim(); if (!code || Date.now() - (recent.get(code) || 0) < 3000) return;
  recent.set(code, Date.now());
  out.className = 'result checking'; out.textContent = 'Checking…';
  try {
    const r = await api('/api/scan', { method: 'POST', body: { code } });
    const [t, c] = LABEL[r.status] || LABEL.invalid;
    out.className = 'result ' + c; out.textContent = t;
    if (r.detail) { const s = document.createElement('div'); s.style.cssText = 'font:500 1rem "DM Sans",sans-serif'; s.textContent = r.detail; out.append(s); }
  } catch (e) { out.className = 'result invalid'; out.textContent = e.status === 401 ? 'Staff sign-in required' : e.message; }
}
$('#manual').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button'), code = $('#code').value; e.target.reset();
  setBusy(btn, true); await check(code); setBusy(btn, false);
});

// Pick a decoder: the browser's native QR detector if it really supports QR (Chrome/Android),
// otherwise jsQR (works on iPhone Safari, Firefox, desktop). Returns async (video) => string | null.
async function makeDecoder() {
  try {
    if ('BarcodeDetector' in window) {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        return async v => (await det.detect(v).catch(() => []))[0]?.rawValue ?? null;
      }
    }
  } catch { /* fall through to jsQR */ }
  if (typeof window.jsQR === 'function') {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async v => {
      if (!v.videoWidth) return null;
      const w = Math.min(v.videoWidth, 640), h = Math.round(w * v.videoHeight / v.videoWidth);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      return window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
    };
  }
  return null;
}

let stream = null, running = false;
function stopCamera() {
  running = false; stream?.getTracks().forEach(t => t.stop()); stream = null;
  video.hidden = true; setBusy(startBtn, false); startBtn.textContent = 'Start camera';
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

startBtn.addEventListener('click', async () => {
  if (running) return stopCamera();
  hint.textContent = ''; setBusy(startBtn, true);
  const decode = await makeDecoder();
  if (!decode) { hint.textContent = 'Camera scanning is not available in this browser. Type the ticket code below instead.'; setBusy(startBtn, false); return; }
  try {
    // Must start from this tap: iPhone Safari only allows camera + playback after a user gesture.
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
    await video.play(); video.hidden = false; running = true; setBusy(startBtn, false); startBtn.textContent = 'Stop camera';
    (async function loop() {
      while (running) {
        const code = await decode(video).catch(() => null);
        if (code) await check(code);
        await new Promise(r => setTimeout(r, 150));
      }
    })();
  } catch (e) {
    stopCamera();
    hint.textContent = e?.name === 'NotAllowedError'
      ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again. (On iPhone: Settings > Safari > Camera.)'
      : 'Could not start the camera. Type the ticket code below instead.';
  }
});
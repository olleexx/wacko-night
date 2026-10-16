// Copies the jsQR decoder into public/ so it is served from our own origin
// (the CSP only allows scripts from 'self'). Runs automatically after `npm install`.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const src = new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url);
const dir = new URL('../public/js/vendor/', import.meta.url);

if (!existsSync(src)) {
  console.warn('jsqr is not installed: iPhone/Safari scanning fallback will be unavailable.');
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
copyFileSync(src, new URL('jsQR.js', dir));
console.log('Copied jsQR to public/js/vendor/jsQR.js');
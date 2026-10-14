// Copies the Tesseract worker, WASM cores and Danish + English language data into public/tesseract,
// so OCR is served from the app itself and keeps working offline (no CDN needed).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(new URL(import.meta.url).pathname));
const out = join(root, 'public', 'tesseract');
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [join(pkgDir('tesseract.js-core'), f), join(out, 'core', f)]),
  ...['dan', 'eng'].map((l) => [join(pkgDir(`@tesseract.js-data/${l}`), '4.0.0_best_int', `${l}.traineddata.gz`), join(out, 'lang', `${l}.traineddata.gz`)]),
];

for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
}
console.log(`OCR assets ready in public/tesseract (${files.length} files)`);

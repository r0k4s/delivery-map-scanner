import { createWorker, PSM, type Worker } from 'tesseract.js';
export { PSM };
import type { OcrLine } from './labelParser';

let workerPromise: Promise<Worker> | null = null;
let lastFailure = 0;

/** Served from public/tesseract (see scripts/copy-ocr-assets.mjs) so OCR works offline. */
const ASSETS = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href;

export class OcrUnavailableError extends Error {}
type Listener = (status: string, progress: number) => void;
const listeners = new Set<Listener>();

export function onOcrProgress(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** One shared worker, created on first use and reused for every scan (fast after the first one). */
export function getOcrWorker(): Promise<Worker> {
  // Don't hammer a broken download (e.g. first launch while offline)
  if (!workerPromise && Date.now() - lastFailure < 8000) {
    return Promise.reject(new OcrUnavailableError('Text recognition is not available yet'));
  }
  if (!workerPromise) {
    workerPromise = (async () => {
      // Danish model first so Æ Ø Å are recognised; English helps with label boilerplate.
      const worker = await createWorker(['dan', 'eng'], 1, {
        workerPath: `${ASSETS}worker.min.js`,
        corePath: `${ASSETS}core`,
        langPath: `${ASSETS}lang`,
        logger: (m) => listeners.forEach((fn) => fn(m.status, m.progress)),
        errorHandler: (e) => console.error('OCR', e),
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      return worker;
    })();
    workerPromise.catch(() => {
      workerPromise = null;
      lastFailure = Date.now();
    });
  }
  return workerPromise;
}

export interface CropRect {
  /** All values are fractions (0–1) of the source width/height. */
  x: number;
  y: number;
  w: number;
  h: number;
}

type Source = HTMLVideoElement | HTMLCanvasElement | ImageBitmap | HTMLImageElement;

function sourceSize(src: Source) {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

/**
 * Crops, scales and cleans up an image for OCR:
 * grayscale → contrast stretch (2nd–98th percentile) → mild unsharp mask.
 */
export function preprocess(src: Source, crop: CropRect = { x: 0, y: 0, w: 1, h: 1 }, rotate = 0, targetWidth = 1700) {
  const { w: sw, h: sh } = sourceSize(src);
  const cx = Math.round(crop.x * sw);
  const cy = Math.round(crop.y * sh);
  const cw = Math.max(1, Math.round(crop.w * sw));
  const ch = Math.max(1, Math.round(crop.h * sh));
  const rotated = rotate % 180 !== 0;
  const outW0 = rotated ? ch : cw;
  const scale = Math.min(2.2, targetWidth / outW0);
  const outW = Math.round((rotated ? ch : cw) * scale);
  const outH = Math.round((rotated ? cw : ch) * scale);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  const dw = cw * scale;
  const dh = ch * scale;
  ctx.drawImage(src as CanvasImageSource, cx, cy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  const img = ctx.getImageData(0, 0, outW, outH);
  const d = img.data;
  const n = outW * outH;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    gray[i] = v;
    hist[v]++;
  }
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > n * 0.02) {
      lo = i;
      break;
    }
  }
  for (let acc = 0, i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc > n * 0.02) {
      hi = i;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) gray[i] = ((gray[i] - lo) * 255) / range;

  // Unsharp mask (3x3 box blur) to crispen thermal-printed text
  const out = new Uint8ClampedArray(n);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      if (x === 0 || y === 0 || x === outW - 1 || y === outH - 1) {
        out[i] = gray[i];
        continue;
      }
      const blur =
        (gray[i - outW - 1] + gray[i - outW] + gray[i - outW + 1] + gray[i - 1] + gray[i] + gray[i + 1] + gray[i + outW - 1] + gray[i + outW] + gray[i + outW + 1]) / 9;
      out[i] = gray[i] + (gray[i] - blur) * 0.8;
    }
  }
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    d[p] = d[p + 1] = d[p + 2] = out[i];
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface OcrBoxLine extends OcrLine {
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  lines: OcrBoxLine[];
  text: string;
  confidence: number;
}

export interface RecognizeOptions {
  psm?: PSM;
  rect?: { left: number; top: number; width: number; height: number };
}

export async function recognize(canvas: HTMLCanvasElement, opts: RecognizeOptions = {}): Promise<OcrResult> {
  const worker = await getOcrWorker();
  await worker.setParameters({ tessedit_pageseg_mode: opts.psm ?? PSM.AUTO });
  const { data } = await worker.recognize(canvas, opts.rect ? { rectangle: opts.rect } : {}, { text: true, blocks: true });
  const lines: OcrBoxLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        lines.push({ text: line.text.replace(/\n/g, ' ').trim(), conf: line.confidence, bbox: line.bbox });
      }
    }
  }
  return { lines, text: data.text, confidence: data.confidence };
}

/** A small JPEG of the label for the review screen. */
export function thumbnail(canvas: HTMLCanvasElement, width = 520) {
  const s = Math.min(1, width / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s);
  c.height = Math.round(canvas.height * s);
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

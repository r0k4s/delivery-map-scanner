import type { CropRect } from './ocr';

/** Small grayscale sample of the scan frame, used to decide when to auto-capture. */
export interface FrameSample {
  gray: Uint8ClampedArray;
  w: number;
  h: number;
  sharpness: number;
}

const SAMPLE_W = 200;
let canvas: HTMLCanvasElement | null = null;

export function sampleFrame(video: HTMLVideoElement, crop: CropRect): FrameSample | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const cw = crop.w * vw;
  const ch = crop.h * vh;
  const w = SAMPLE_W;
  const h = Math.max(1, Math.round((ch / cw) * w));
  canvas ??= document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, crop.x * vw, crop.y * vh, cw, ch, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;

  // Variance of the Laplacian – a standard focus measure
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / Math.max(1, count);
  const sharpness = sumSq / Math.max(1, count) - mean * mean;
  return { gray, w, h, sharpness };
}

/** Mean absolute pixel difference (0–255) between two samples. */
export function frameDiff(a: FrameSample, b: FrameSample) {
  if (a.w !== b.w || a.h !== b.h) return 255;
  let s = 0;
  for (let i = 0; i < a.gray.length; i += 2) s += Math.abs(a.gray[i] - b.gray[i]);
  return s / (a.gray.length / 2);
}

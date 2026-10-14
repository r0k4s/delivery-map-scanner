import type { ParsedLabel } from './labelParser';
import { multiPassParse } from './multipass';
import { preprocess, recognize, thumbnail, type CropRect } from './ocr';

export interface LabelRead {
  parsed: ParsedLabel;
  thumb: string;
  ocrText: string;
}

type Source = HTMLVideoElement | HTMLCanvasElement | ImageBitmap | HTMLImageElement;

/**
 * OCR + parse a label. For uploaded photos (tryRotations) a sideways or upside-down
 * picture is retried in the other orientations and the best reading wins.
 */
export async function readLabel(src: Source, crop?: CropRect, tryRotations = false): Promise<LabelRead> {
  const angles = tryRotations ? [0, 90, 270, 180] : [0];
  let best: LabelRead | null = null;
  for (const angle of angles) {
    const canvas = preprocess(src, crop, angle);
    let ocrText = '';
    const parsed = await multiPassParse(
      async (opts) => {
        const r = await recognize(canvas, opts);
        ocrText ||= r.text;
        return r;
      },
      canvas.width,
      canvas.height,
      angle === 0 ? 3 : 2,
    );
    const read = { parsed, thumb: thumbnail(canvas), ocrText };
    if (!best || parsed.confidence > best.parsed.confidence) best = read;
    if (parsed.confidence >= 0.75) break;
  }
  return best!;
}

/** True when the reading has at least something address-like worth showing to the driver. */
export function hasAnyAddress(p: ParsedLabel) {
  return !!(p.address.street || p.address.postcode);
}

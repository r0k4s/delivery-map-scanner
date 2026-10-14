import { PSM } from 'tesseract.js';
import { extractTracking, isShipToLine, parseLabel, REVIEW_THRESHOLD, type ParsedLabel } from './labelParser';
import type { OcrBoxLine, RecognizeOptions } from './ocr';

export type Recognizer = (opts: RecognizeOptions) => Promise<{ lines: OcrBoxLine[] }>;

const good = (p: ParsedLabel) => p.confidence >= REVIEW_THRESHOLD;

/**
 * Tesseract's automatic layout analysis sometimes drops lines on busy labels (barcodes, boxes).
 * 1. Read the whole image with automatic layout.
 * 2. If the address is incomplete, re-read only the area under "SHIP TO" as one text block.
 * 3. If still incomplete, try sparse-text mode.
 * The best reading wins; a tracking number found in any pass is kept.
 */
export async function multiPassParse(rec: Recognizer, width: number, height: number, maxPasses = 3): Promise<ParsedLabel> {
  const seen: OcrBoxLine[] = [];
  const p1 = await rec({ psm: PSM.AUTO });
  seen.push(...p1.lines);
  let best = parseLabel(p1.lines);

  if (!good(best) && maxPasses >= 2) {
    const anchor = p1.lines.find((l) => isShipToLine(l.text));
    if (anchor) {
      const h = Math.max(14, anchor.bbox.y1 - anchor.bbox.y0);
      const left = Math.max(0, Math.round(anchor.bbox.x0 - h * 0.6));
      const top = Math.max(0, Math.round(anchor.bbox.y0 - h * 0.4));
      const rect = { left, top, width: width - left, height: Math.min(height - top, Math.round(h * 14)) };
      if (rect.width > 20 && rect.height > 20) {
        const p2 = await rec({ psm: PSM.SINGLE_BLOCK, rect });
        seen.push(...p2.lines);
        const cand = parseLabel(p2.lines);
        if (cand.confidence > best.confidence) best = cand;
      }
    }
  }

  if (!good(best) && maxPasses >= 3) {
    const p3 = await rec({ psm: PSM.SPARSE_TEXT });
    seen.push(...p3.lines);
    const cand = parseLabel(p3.lines);
    if (cand.confidence > best.confidence) best = cand;
  }

  if (!best.tracking || !best.trackingValid) {
    const t = extractTracking(seen.map((l) => l.text));
    if (t.tracking && (t.valid || !best.tracking)) best = { ...best, tracking: t.tracking, trackingValid: t.valid };
  }
  return best;
}

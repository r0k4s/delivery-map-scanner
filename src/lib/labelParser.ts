import { type Address, emptyAddress } from '../types';

/** One OCR text line with Tesseract's confidence (0–100). */
export interface OcrLine {
  text: string;
  conf: number;
}

export interface ParsedLabel {
  address: Address;
  tracking: string;
  trackingValid: boolean;
  foundShipTo: boolean;
  /** 0–1. Below REVIEW_THRESHOLD the driver must confirm the address. */
  confidence: number;
  issues: string[];
  /** The lines that were treated as the destination block (for debugging / review). */
  blockLines: string[];
}

export const REVIEW_THRESHOLD = 0.75;

const L = 'A-Za-zÆØÅæøåÉéÜüÖöÄä';
const LETTER = new RegExp(`[${L}]`);

// ---------------------------------------------------------------- helpers

function cleanLine(s: string) {
  return s
    // "]" and "|" are common misreads of "J"/"I" at the end of an uppercase word
    .replace(/([A-ZÆØÅ])\](?=[\s,.]|$)/g, '$1J')
    .replace(/[|«»¦_~`"“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-.,:;]+|[\s\-,:;]+$/g, '')
    .trim();
}

/** Tesseract often reads digits as look-alike letters. Only used where digits are expected. */
function fixDigits(s: string) {
  return s.replace(/[OoQD]/g, '0').replace(/[Il|i!]/g, '1').replace(/[Ss$]/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/G/g, '6');
}

function upperRatio(s: string) {
  const letters = s.match(new RegExp(`[${L}]`, 'g')) ?? [];
  if (!letters.length) return 0;
  return letters.filter((c) => c === c.toUpperCase()).length / letters.length;
}

/** "NØRREBROGADE" → "Nørrebrogade", "H.C. ANDERSENS BOULEVARD" → "H.C. Andersens Boulevard". */
export function smartCase(s: string, keepShortUpper = false) {
  if (upperRatio(s) < 0.8) return s;
  const words = s.toLowerCase().split(' ');
  return words
    .map((w, i) => {
      if (keepShortUpper && i === words.length - 1 && i > 0 && w.length <= 2) return w.toUpperCase();
      return w.replace(new RegExp(`(^|[.\\-/'])([${L}])`, 'g'), (_m, p: string, c: string) => p + c.toUpperCase());
    })
    .join(' ');
}

/** Danish floor/door, e.g. "2TH" → "2. th", "ST TV" → "st. tv", "3 4" → "3. 4". */
export function normalizeUnit(raw: string) {
  const s = raw.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const m = s.match(/^(st|kl|kld|\d{1,2})\s*\.?\s*(th|tv|mf|\d{1,4})?\s*\.?\s*$/);
  if (m) {
    const floor = m[1] === 'kld' ? 'kl' : m[1];
    return m[2] ? `${floor}. ${m[2]}` : `${floor}.`;
  }
  const side = s.match(/^(th|tv|mf)\.?$/);
  if (side) return side[1];
  return s;
}

const UNIT_LINE = /^(st|kl|kld|\d{1,2})\s*\.?\s*(th|tv|mf|\d{1,4})?\s*\.?$|^(th|tv|mf)\.?$|^\d{1,2}\.?\s*sal$/i;

// ---------------------------------------------------------------- tracking

const LETTER_VALUE = (c: string) => (/[A-Z]/.test(c) ? (c.charCodeAt(0) - 63) % 10 : Number(c));

/** UPS 1Z check digit (mod 10 over the 15 characters after "1Z"). */
export function upsCheckDigitValid(tracking: string) {
  if (!/^1Z[0-9A-Z]{16}$/.test(tracking)) return false;
  const body = tracking.slice(2, 17);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const v = LETTER_VALUE(body[i]);
    sum += i % 2 === 1 ? v * 2 : v;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(tracking[17]);
}

const LOOKALIKE: Record<string, string> = { L: '1', I: '1', O: '0', Q: '0', S: '5', B: '8', Z: '2', G: '6', '1': 'I', '0': 'O', '5': 'S', '8': 'B' };

function repairAccount(t: string): string | null {
  const pos = [...t.slice(2, 8)].map((ch, i) => (LOOKALIKE[ch] ? i + 2 : -1)).filter((i) => i >= 0);
  if (!pos.length || pos.length > 6) return null;
  for (let mask = 1; mask < 1 << pos.length; mask++) {
    const chars = [...t];
    pos.forEach((p, bit) => {
      if (mask & (1 << bit)) chars[p] = LOOKALIKE[chars[p]];
    });
    const cand = chars.join('');
    if (upsCheckDigitValid(cand)) return cand;
  }
  return null;
}

export function extractTracking(lines: string[]): { tracking: string; valid: boolean } {
  const candidates: string[] = [];
  const texts = [...lines, lines.join(' ')];
  for (const line of texts) {
    const compact = line.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const re = /(?:1Z|IZ|LZ|7Z)([0-9A-Z]{16})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(compact))) {
      const body = m[1];
      // positions 6+ (service code + package number) are always digits
      const fixed = body.slice(0, 6) + fixDigits(body.slice(6));
      candidates.push(`1Z${fixed}`);
    }
  }
  let valid = candidates.find(upsCheckDigitValid);
  if (!valid) {
    // The 6-char shipper account may contain letters, so look-alikes there are only fixed if that makes the check digit valid
    for (const c of candidates) {
      const fixed = repairAccount(c);
      if (fixed) {
        valid = fixed;
        break;
      }
    }
  }
  if (valid) return { tracking: valid, valid: true };
  const plausible = candidates.find((c) => /^1Z[0-9A-Z]{6}\d{10}$/.test(c));
  return { tracking: plausible ?? '', valid: false };
}

// ---------------------------------------------------------------- address

const SHIP_TO_COMPACT = /SH[I1L|!]P(?:PED)?T[O0Q]|DELIVERT[O0]|LEVERESTIL|MODTAGER|CONSIGNEE/;
const SHIP_TO_STRIP = /^.*?(?:S\s*H\s*[I1l|!L]\s*P(?:\s*P\s*E\s*D)?\s*T\s*[O0Q]|DELIVER\s*TO|LEVERES\s*TIL|MODTAGER|CONSIGNEE)\s*[:;.]?\s*/i;

const STOP_LINE =
  /^(UPS\b|UPS[A-Z]|TRACKING|TRACK\s*#|BILLING|BILL\b|REF\b|REF[\s.:#]|REFERENCE|DESC|SHP\b|SHP\s*[#W]|SHIPMENT|DATE\b|DWT|CN2[23]|MAXI|PKG|PACKAGE|\d+\s*(OF|AF)\s*\d+|\d+([.,]\d+)?\s*(KG|LBS?)\b|1Z|IZ\d|DELIVERY CONFIRMATION)/i;
const ROUTING_CODE = /^[A-Z]{2,3}\s?\d{3}\s?\d\s?-\s?\d{2}$/i;
const PHONE_LINE = /^(TEL|PHONE|PH|MOB|MOBIL|TLF|CVR|EMAIL|E-MAIL)\b|^\+?\d[\d\s]{7,}$/i;
const NON_STREET_PREFIX = /^(TEL|PHONE|PH|TLF|MOB|ATT|ATTN|C\/O|CO|CVR|ORDER|ORDRE|REF|ACCT|ACCOUNT|SHP|SHIPPER)\b/i;
const COUNTRY_WORDS = /\b(DENMARK|DANMARK|DANEMARK|DNK|SWEDEN|SVERIGE|NORWAY|NORGE|GERMANY|DEUTSCHLAND)\b/i;

const COUNTRY_MAP: Record<string, string> = {
  DENMARK: 'Denmark', DANMARK: 'Denmark', DANEMARK: 'Denmark', DNK: 'Denmark',
  SWEDEN: 'Sweden', SVERIGE: 'Sweden', NORWAY: 'Norway', NORGE: 'Norway',
  GERMANY: 'Germany', DEUTSCHLAND: 'Germany',
};

interface PostcodeHit {
  postcode: string;
  city: string;
  country?: string;
}

/** "DK-2200 KØBENHAVN N, DENMARK" → { 2200, KØBENHAVN N } */
export function matchPostcodeLine(line: string): PostcodeHit | null {
  let s = line.trim();
  let country: string | undefined;
  const cw = s.match(COUNTRY_WORDS);
  if (cw && cw.index !== undefined && cw.index > 0) {
    country = COUNTRY_MAP[cw[1].toUpperCase()];
    s = s.slice(0, cw.index).replace(/[\s,]+$/, '');
  }
  s = s.replace(/[\s,]+DK$/i, '');
  const m = s.match(new RegExp(`^(?:(?:DK|D\\.K\\.|DNK)\\s*[-–.]?\\s*)?([0-9OoIlSB]{4})\\s*,?\\s+([${L}][${L} .'\\-]{1,40})$`));
  if (!m) return null;
  const digits = (m[1].match(/\d/g) ?? []).length;
  if (digits < 3) return null;
  const postcode = fixDigits(m[1]);
  const city = m[2].replace(/[.\s]+$/, '').trim();
  if ((city.match(LETTER_G) ?? []).length < 2) return null;
  return { postcode, city, country };
}
const LETTER_G = new RegExp(`[${L}]`, 'g');

interface StreetHit {
  street: string;
  houseNumber: string;
  unit: string;
}

/** "Nørrebrogade 12, 2. th" → { Nørrebrogade, 12, 2. th } */
export function matchStreetLine(line: string): StreetHit | null {
  if (NON_STREET_PREFIX.test(line) || PHONE_LINE.test(line)) return null;
  const re = new RegExp(
    `^(.*?[${L}.'])\\s*,?\\s+(\\d{1,4}(?:\\s?[A-Za-z](?![${L}]))?)(?:\\s*[,.;]?\\s*(.*))?$`,
  );
  const m = line.match(re);
  if (!m) return null;
  const street = m[1].replace(/[,\s]+$/, '').trim();
  if ((street.match(LETTER_G) ?? []).length < 3) return null;
  let unitRaw = (m[3] ?? '').trim();
  // A trailing postcode+city on the same line is not part of the unit
  const pc = unitRaw.match(/\b\d{4}\s+[A-ZÆØÅa-zæøå].*$/);
  if (pc) unitRaw = unitRaw.slice(0, pc.index).trim();
  if (unitRaw && !UNIT_LINE.test(unitRaw) && unitRaw.length > 12) unitRaw = '';
  return {
    street,
    houseNumber: m[2].replace(/\s+/g, '').toUpperCase(),
    unit: normalizeUnit(unitRaw),
  };
}

/** True for a "SHIP TO" (or equivalent) heading line, tolerant of OCR errors. */
export function isShipToLine(text: string) {
  return SHIP_TO_COMPACT.test(text.toUpperCase().replace(/[^A-Z0-9|!]/g, ''));
}

function isStop(line: string) {
  return STOP_LINE.test(line) || ROUTING_CODE.test(line);
}

// ---------------------------------------------------------------- main

export function parseLabel(input: OcrLine[] | string): ParsedLabel {
  const raw: OcrLine[] =
    typeof input === 'string' ? input.split(/\r?\n/).map((text) => ({ text, conf: 90 })) : input;
  const lines = raw.map((l) => ({ text: cleanLine(l.text), conf: l.conf })).filter((l) => l.text.length > 0);
  const texts = lines.map((l) => l.text);

  const issues: string[] = [];
  const { tracking, valid: trackingValid } = extractTracking(texts);

  // 1. Locate SHIP TO
  let anchor = -1;
  let anchorRemainder = '';
  for (let i = 0; i < lines.length; i++) {
    const compact = texts[i].toUpperCase().replace(/[^A-Z0-9|!]/g, '');
    if (SHIP_TO_COMPACT.test(compact)) {
      anchor = i;
      anchorRemainder = cleanLine(texts[i].replace(SHIP_TO_STRIP, ''));
      break;
    }
    // "SHIP" and "TO:" split over two lines
    if (/^SH[I1L]P$/i.test(texts[i]) && i + 1 < lines.length && /^T[O0]\b/i.test(texts[i + 1])) {
      anchor = i + 1;
      anchorRemainder = cleanLine(texts[i + 1].replace(/^T[O0]\s*[:;.]?\s*/i, ''));
      break;
    }
  }
  // The camera frame may cut "SHIP" off and leave only "TO:" (or "IP TO:")
  let partialAnchor = false;
  if (anchor < 0) {
    for (let i = 0; i < lines.length; i++) {
      const m = texts[i].match(/^(?:[A-Z]{0,3}\s)?T[O0](?:\s*[:;]\s*(.*))?$/i);
      if (m) {
        anchor = i;
        anchorRemainder = cleanLine(m[1] ?? '');
        partialAnchor = true;
        break;
      }
    }
  }
  const foundShipTo = anchor >= 0;

  // 2. Build the candidate block
  let block: OcrLine[] = [];
  if (foundShipTo) {
    if (anchorRemainder) block.push({ text: anchorRemainder, conf: lines[anchor].conf });
    for (let i = anchor + 1; i < lines.length && block.length < 10; i++) {
      if (isStop(texts[i])) break;
      block.push(lines[i]);
    }
  } else {
    issues.push('“SHIP TO” not found – check this is the recipient, not the sender');
    // Without an anchor: the recipient is normally the LAST address before the tracking/barcode area.
    const stopAt = lines.findIndex((l, i) => i > 2 && isStop(l.text) && /TRACKING|1Z|BILLING/i.test(l.text));
    const region = stopAt > 0 ? lines.slice(0, stopAt) : lines;
    const pcIdx = region.map((l, i) => (matchPostcodeLine(l.text) ? i : -1)).filter((i) => i >= 0);
    if (pcIdx.length) {
      const target = pcIdx[pcIdx.length - 1];
      const prevPc = pcIdx.length > 1 ? pcIdx[pcIdx.length - 2] : -1;
      const start = Math.max(prevPc + 1, target - 5);
      block = region.slice(start, target + 2);
      if (pcIdx.length === 1) issues.push('Only one address found on the label');
    }
  }

  // 3. Postcode + city
  const address = emptyAddress();
  let pcLine = -1;
  let pcHit: PostcodeHit | null = null;
  for (let i = 0; i < block.length; i++) {
    const hit = matchPostcodeLine(block[i].text);
    if (hit) {
      pcLine = i;
      pcHit = hit;
      break;
    }
  }
  // Postcode can share a line with the street ("Vesterbrogade 3, 1620 København V")
  if (!pcHit) {
    for (let i = 0; i < block.length; i++) {
      const m = block[i].text.match(new RegExp(`,?\\s(\\d{4}\\s+[${L}][${L} .'\\-]+)$`));
      if (m && m.index !== undefined) {
        const hit = matchPostcodeLine(m[1]);
        if (hit) {
          pcHit = hit;
          pcLine = i;
          block[i] = { ...block[i], text: block[i].text.slice(0, m.index).trim() };
          block.splice(i + 1, 0, { text: m[1], conf: block[i].conf });
          pcLine = i + 1;
          break;
        }
      }
    }
  }

  let confScore = 1;
  const usedConf: number[] = [];

  if (pcHit) {
    address.postcode = pcHit.postcode;
    address.city = smartCase(pcHit.city, true);
    if (pcHit.country) address.country = pcHit.country;
    usedConf.push(block[pcLine].conf);
  }

  // 4. Street (search upwards from the postcode line)
  let streetLineIdx = -1;
  const searchEnd = pcLine >= 0 ? pcLine - 1 : block.length - 1;
  for (let i = searchEnd; i >= 0; i--) {
    const hit = matchStreetLine(block[i].text);
    if (hit) {
      streetLineIdx = i;
      address.street = smartCase(hit.street);
      address.houseNumber = hit.houseNumber;
      address.unit = hit.unit;
      usedConf.push(block[i].conf);
      break;
    }
  }

  // Floor/door on its own line between street and postcode
  if (streetLineIdx >= 0 && !address.unit) {
    const end = pcLine >= 0 ? pcLine : block.length;
    for (let i = streetLineIdx + 1; i < end; i++) {
      if (UNIT_LINE.test(block[i].text)) {
        address.unit = normalizeUnit(block[i].text);
        break;
      }
    }
  }

  // 5. Name / company (lines above the street)
  if (streetLineIdx > 0) {
    const nameLines = block
      .slice(0, streetLineIdx)
      .map((l) => l.text)
      .filter((t) => !PHONE_LINE.test(t) && LETTER.test(t) && !isStop(t));
    address.name = nameLines.slice(0, 2).map((t) => smartCase(t)).join(' · ');
  }

  // Country line after postcode
  if (pcLine >= 0) {
    for (let i = pcLine + 1; i < Math.min(block.length, pcLine + 3); i++) {
      const cw = block[i].text.match(COUNTRY_WORDS);
      if (cw) address.country = COUNTRY_MAP[cw[1].toUpperCase()] ?? address.country;
    }
  }

  // 6. Score
  if (!foundShipTo) confScore -= 0.35;
  else if (partialAnchor) confScore -= 0.1;
  if (!address.street) {
    confScore -= 0.5;
    issues.push('Street not recognised');
  }
  if (!address.houseNumber) confScore -= 0.3;
  if (!address.postcode) {
    confScore -= 0.5;
    issues.push('Postcode not recognised');
  } else if (address.country === 'Denmark') {
    const n = Number(address.postcode);
    if (n < 1000 || n > 9990) {
      confScore -= 0.4;
      issues.push(`Postcode ${address.postcode} is not a Danish postcode`);
    }
  }
  if (!address.city) confScore -= 0.3;
  if (usedConf.length) {
    const avg = usedConf.reduce((a, b) => a + b, 0) / usedConf.length;
    if (avg < 55) {
      confScore -= 0.4;
      issues.push('Text was hard to read');
    } else if (avg < 72) {
      confScore -= 0.25;
      issues.push('Some characters may be misread');
    }
  }

  return {
    address,
    tracking,
    trackingValid,
    foundShipTo,
    confidence: Math.max(0, Math.min(1, confScore)),
    issues,
    blockLines: block.map((l) => l.text),
  };
}

import { describe, expect, it } from 'vitest';
import { normalizeUnit, parseLabel, smartCase, upsCheckDigitValid } from './labelParser';

const TYPICAL = `
ANDERS WEBSHOP APS
+45 70 20 30 40
INDUSTRIVEJ 5
8000 AARHUS C
DENMARK
SHIP TO:
METTE HANSEN
+45 22 33 44 55
NØRREBROGADE 12, 2. TH
2200 KØBENHAVN N
DENMARK
DK 220 9-01
UPS STANDARD
TRACKING #: 1Z 999 AA1 01 2345 6784
BILLING: P/P
`;

describe('parseLabel', () => {
  it('reads the SHIP TO block and never the sender', () => {
    const r = parseLabel(TYPICAL);
    expect(r.foundShipTo).toBe(true);
    expect(r.address.street).toBe('Nørrebrogade');
    expect(r.address.houseNumber).toBe('12');
    expect(r.address.unit).toBe('2. th');
    expect(r.address.postcode).toBe('2200');
    expect(r.address.city).toBe('København N');
    expect(r.address.country).toBe('Denmark');
    expect(r.address.name).toBe('Mette Hansen');
    expect(r.tracking).toBe('1Z999AA10123456784');
    expect(r.trackingValid).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('handles name on the SHIP TO line and squashed floor/door', () => {
    const r = parseLabel(`SHIP TO: LARS JENSEN\nVESTERBROGADE 3 1TV\n1620 KØBENHAVN V\nDENMARK\nUPS EXPRESS SAVER`);
    expect(r.address).toMatchObject({ name: 'Lars Jensen', street: 'Vesterbrogade', houseNumber: '3', unit: '1. tv', postcode: '1620', city: 'København V' });
  });

  it('handles floor on its own line, house letters and DK- prefix', () => {
    const r = parseLabel(`SHIP TO:\nPETER ØSTERGAARD\nØSTERBROGADE 45A\nST. TV\nDK-2100 KØBENHAVN Ø\nDENMARK`);
    expect(r.address).toMatchObject({ street: 'Østerbrogade', houseNumber: '45A', unit: 'st. tv', postcode: '2100', city: 'København Ø' });
  });

  it('survives typical OCR confusions', () => {
    const r = parseLabel(`SH1P T0:\nANNE ÅGÅRD\nÆBLEHAVEN 7\n22O0 KØBENHAVN N\nTRACKING # IZ 999 AA1 01 2345 6784`);
    expect(r.foundShipTo).toBe(true);
    expect(r.address.street).toBe('Æblehaven');
    expect(r.address.postcode).toBe('2200');
    expect(r.tracking.startsWith('1Z999AA1')).toBe(true);
  });

  it('keeps dotted street names', () => {
    const r = parseLabel(`SHIP TO:\nTIVOLI A/S\nH.C. ANDERSENS BOULEVARD 22\n1553 KØBENHAVN V`);
    expect(r.address.street).toBe('H.C. Andersens Boulevard');
    expect(r.address.houseNumber).toBe('22');
    expect(r.address.name).toBe('Tivoli A/S');
  });

  it('skips company ATT lines and phone numbers', () => {
    const r = parseLabel(`SHIP TO:\nNORDISK DESIGN APS\nATT: LOUISE\nTEL 33 12 45 67\nGL. KONGEVEJ 10, 3. 4\n1610 KØBENHAVN V\nDENMARK\nREF 1: ORDER 5512`);
    expect(r.address).toMatchObject({ street: 'Gl. Kongevej', houseNumber: '10', unit: '3. 4', postcode: '1610' });
    expect(r.address.name).toContain('Nordisk Design Aps');
  });

  it('handles street and postcode on one line', () => {
    const r = parseLabel(`SHIP TO:\nKARIN BECH\nStrandvejen 100, 2900 Hellerup`);
    expect(r.address).toMatchObject({ street: 'Strandvejen', houseNumber: '100', postcode: '2900', city: 'Hellerup' });
  });

  it('without SHIP TO picks the second address and asks for review', () => {
    const r = parseLabel(`SENDER CO\nINDUSTRIVEJ 5\n8000 AARHUS C\nMETTE HANSEN\nNØRREBROGADE 12\n2200 KØBENHAVN N\nTRACKING #: 1Z999AA10123456784`);
    expect(r.foundShipTo).toBe(false);
    expect(r.address.street).toBe('Nørrebrogade');
    expect(r.confidence).toBeLessThan(0.75);
  });

  it('accepts a SHIP TO heading cut off by the camera frame', () => {
    const r = parseLabel(`RIVEJ 5\nARHUS C\n\\rk\nTO:\nMETTE HANSEN\n+45 22 33 44 55\nNØRREBROGADE 12, 2. TH\n2200 KØBENHAVN N\nDENMARK\nK 220 9-01`);
    expect(r.foundShipTo).toBe(true);
    expect(r.address).toMatchObject({ name: 'Mette Hansen', street: 'Nørrebrogade', postcode: '2200' });
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('flags low OCR confidence for review', () => {
    const r = parseLabel([
      { text: 'SHIP TO:', conf: 90 },
      { text: 'NØRREBROGADE 12', conf: 40 },
      { text: '2200 KØBENHAVN N', conf: 45 },
    ]);
    expect(r.confidence).toBeLessThan(0.75);
  });

  it('flags missing address', () => {
    const r = parseLabel('SHIP TO:\nsomething unreadable');
    expect(r.confidence).toBeLessThan(0.75);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('normalises Danish floors', () => {
    expect(normalizeUnit('2TH')).toBe('2. th');
    expect(normalizeUnit('ST TV')).toBe('st. tv');
    expect(normalizeUnit('kld')).toBe('kl.');
    expect(normalizeUnit('MF')).toBe('mf');
  });
  it('title-cases uppercase labels', () => {
    expect(smartCase('KØBENHAVN NV', true)).toBe('København NV');
    expect(smartCase('Århus')).toBe('Århus');
  });
  it('repairs look-alike characters in the shipper account', () => {
    expect(parseLabel('TRACKING #: 1Z 999 AAL 01 2345 6784').tracking).toBe('1Z999AA10123456784');
  });
  it('reads ] as J', () => {
    expect(parseLabel('SHIP TO:\nGL. KONGEVE] 10, 3. 4\n1610 KØBENHAVN V').address).toMatchObject({ street: 'Gl. Kongevej', houseNumber: '10', unit: '3. 4' });
  });
  it('validates UPS check digits', () => {
    expect(upsCheckDigitValid('1Z999AA10123456784')).toBe(true);
    expect(upsCheckDigitValid('1Z999AA10123456785')).toBe(false);
  });
});

export type ColorKey = 'red' | 'green' | 'blue' | 'yellow' | 'orange' | 'purple' | 'pink' | 'teal';

export const COLORS: { key: ColorKey; label: string; hex: string; ink: string }[] = [
  { key: 'red', label: 'Red', hex: '#ef4444', ink: '#fff' },
  { key: 'green', label: 'Green', hex: '#22c55e', ink: '#052e16' },
  { key: 'blue', label: 'Blue', hex: '#3b82f6', ink: '#fff' },
  { key: 'yellow', label: 'Yellow', hex: '#facc15', ink: '#422006' },
  { key: 'orange', label: 'Orange', hex: '#f97316', ink: '#fff' },
  { key: 'purple', label: 'Purple', hex: '#a855f7', ink: '#fff' },
  { key: 'pink', label: 'Pink', hex: '#ec4899', ink: '#fff' },
  { key: 'teal', label: 'Teal', hex: '#14b8a6', ink: '#042f2e' },
];

export const DELIVERED_HEX = '#9ca3af';

export function colorOf(key: ColorKey) {
  return COLORS.find((c) => c.key === key) ?? COLORS[0];
}

export type Status = 'pending' | 'delivered';

/**
 * ok      – geocoder matched the exact street address
 * approx  – geocoder only found an approximate position (needs checking)
 * manual  – driver placed the pin by hand
 * pending – not geocoded yet (offline / no API key) – retried automatically
 * failed  – geocoder found nothing
 */
export type GeoStatus = 'ok' | 'approx' | 'manual' | 'pending' | 'failed';

export interface Address {
  name: string;
  street: string;
  houseNumber: string;
  unit: string;
  postcode: string;
  city: string;
  country: string;
}

export interface Delivery extends Address {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  tracking: string;
  color: ColorKey;
  templateId: string | null;
  note: string;
  status: Status;
  deliveredAt: number | null;
  lat: number | null;
  lng: number | null;
  geoStatus: GeoStatus;
  formattedAddress: string;
}

export interface Template {
  id: string;
  label: string;
  order: number;
}

export interface Settings {
  apiKey: string;
  mapId: string;
  defaultColor: ColorKey;
  defaultTemplateId: string | null;
  autoSave: boolean;
  autoCapture: boolean;
  hideDelivered: boolean;
  grayDelivered: boolean;
}

export function emptyAddress(): Address {
  return { name: '', street: '', houseNumber: '', unit: '', postcode: '', city: '', country: 'Denmark' };
}

export function streetLine(a: Pick<Address, 'street' | 'houseNumber' | 'unit'>) {
  const base = [a.street, a.houseNumber].filter(Boolean).join(' ');
  return a.unit ? `${base}, ${a.unit}` : base;
}

export function cityLine(a: Pick<Address, 'postcode' | 'city'>) {
  return [a.postcode, a.city].filter(Boolean).join(' ');
}

export function fullAddress(a: Address) {
  return [streetLine(a), cityLine(a), a.country].filter(Boolean).join(', ');
}

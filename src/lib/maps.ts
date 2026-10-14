import { Loader } from '@googlemaps/js-api-loader';
import type { Address, GeoStatus } from '../types';

let loader: Loader | null = null;
let loaderKey = '';
let loadPromise: Promise<typeof google> | null = null;

export class MapsKeyError extends Error {}

/** Loads the Google Maps JS API once per key. Changing the key requires a page reload. */
export function loadMaps(apiKey: string): Promise<typeof google> {
  if (!apiKey) return Promise.reject(new MapsKeyError('No Google Maps API key set'));
  if (loadPromise && loaderKey === apiKey) return loadPromise;
  if (loadPromise && loaderKey !== apiKey) {
    // The JS API can only be loaded once per page
    return Promise.reject(new MapsKeyError('API key changed – reload the app to use the new key'));
  }
  loaderKey = apiKey;
  loader = new Loader({ apiKey, version: 'weekly', language: 'da', region: 'DK' });
  loadPromise = (async () => {
    await Promise.all([
      loader!.importLibrary('maps'),
      loader!.importLibrary('marker'),
      loader!.importLibrary('geocoding'),
    ]);
    return google;
  })();
  loadPromise.catch(() => {
    loadPromise = null;
  });
  // Google calls this global when the key is rejected
  (window as unknown as { gm_authFailure: () => void }).gm_authFailure = () => {
    window.dispatchEvent(new CustomEvent('maps-auth-failure'));
  };
  return loadPromise;
}

export const COPENHAGEN = { lat: 55.6761, lng: 12.5683 };

export interface GeoResult {
  status: Exclude<GeoStatus, 'manual' | 'pending'>;
  lat: number | null;
  lng: number | null;
  formatted: string;
  reason: string;
}

function geocodeQuery(a: Address) {
  // Floor/door confuses the geocoder; it's kept on the delivery but left out of the query.
  const street = [a.street, a.houseNumber].filter(Boolean).join(' ');
  return [street, [a.postcode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ');
}

const COUNTRY_CODES: Record<string, string> = { Denmark: 'DK', Sweden: 'SE', Norway: 'NO', Germany: 'DE' };

/**
 * Geocodes an address and judges how trustworthy the position is.
 * Throws if Maps can't be loaded (no key / offline) so the caller can keep the delivery as "pending".
 */
export async function geocodeAddress(apiKey: string, a: Address): Promise<GeoResult> {
  if (!navigator.onLine) throw new Error('offline');
  const g = await loadMaps(apiKey);
  const geocoder = new g.maps.Geocoder();
  const country = COUNTRY_CODES[a.country] ?? undefined;
  let results: google.maps.GeocoderResult[] = [];
  try {
    const res = await geocoder.geocode({
      address: geocodeQuery(a),
      region: 'dk',
      componentRestrictions: country ? { country } : undefined,
    });
    results = res.results;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ZERO_RESULTS') results = [];
    else throw e;
  }
  if (!results.length) {
    return { status: 'failed', lat: null, lng: null, formatted: '', reason: 'Address not found' };
  }
  const r = results[0];
  const loc = r.geometry.location;
  const comp = (type: string) => r.address_components.find((c) => c.types.includes(type))?.short_name ?? '';
  const precise =
    (r.geometry.location_type === g.maps.GeocoderLocationType.ROOFTOP ||
      r.geometry.location_type === g.maps.GeocoderLocationType.RANGE_INTERPOLATED) &&
    r.types.some((t) => ['street_address', 'premise', 'subpremise'].includes(t));
  const pcOk = !a.postcode || comp('postal_code') === a.postcode;
  const numOk = !a.houseNumber || comp('street_number').toUpperCase().replace(/\s/g, '') === a.houseNumber.toUpperCase();

  const reasons: string[] = [];
  if (!precise) reasons.push('only an approximate position was found');
  if (r.partial_match) reasons.push('the address only partly matched');
  if (!pcOk) reasons.push(`postcode on map is ${comp('postal_code') || 'unknown'}`);
  if (!numOk) reasons.push('house number not matched');

  return {
    status: reasons.length ? 'approx' : 'ok',
    lat: loc.lat(),
    lng: loc.lng(),
    formatted: r.formatted_address,
    reason: reasons.length ? capitalize(reasons.join(', ')) : 'Exact address match',
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function navigationUrl(d: { lat: number | null; lng: number | null } & Address) {
  const dest = d.lat != null && d.lng != null ? `${d.lat},${d.lng}` : geocodeQuery(d);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}

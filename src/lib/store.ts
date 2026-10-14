import { db, getSettings, uid } from './db';
import { geocodeAddress, type GeoResult } from './maps';
import type { Address, ColorKey, Delivery, GeoStatus } from '../types';

export interface NewDeliveryInput {
  address: Address;
  tracking: string;
  color: ColorKey;
  templateId: string | null;
  note: string;
  geo: { status: GeoStatus; lat: number | null; lng: number | null; formatted: string };
}

export async function addDelivery(input: NewDeliveryInput): Promise<Delivery> {
  return db.transaction('rw', db.deliveries, async () => {
    const last = await db.deliveries.orderBy('seq').last();
    const now = Date.now();
    const d: Delivery = {
      ...input.address,
      id: uid(),
      seq: (last?.seq ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
      tracking: input.tracking,
      color: input.color,
      templateId: input.templateId,
      note: input.note,
      status: 'pending',
      deliveredAt: null,
      lat: input.geo.lat,
      lng: input.geo.lng,
      geoStatus: input.geo.status,
      formattedAddress: input.geo.formatted,
    };
    await db.deliveries.add(d);
    return d;
  });
}

export async function updateDelivery(id: string, patch: Partial<Delivery>) {
  await db.deliveries.update(id, { ...patch, updatedAt: Date.now() });
}

export async function setDelivered(ids: string[], delivered: boolean) {
  const now = Date.now();
  await db.deliveries.bulkUpdate(
    ids.map((id) => ({
      key: id,
      changes: { status: delivered ? 'delivered' : 'pending', deliveredAt: delivered ? now : null, updatedAt: now },
    })),
  );
}

export async function deleteDeliveries(ids: string[]): Promise<Delivery[]> {
  const rows = (await db.deliveries.bulkGet(ids)).filter((d): d is Delivery => !!d);
  await db.deliveries.bulkDelete(ids);
  return rows;
}

export async function restoreDeliveries(rows: Delivery[]) {
  await db.deliveries.bulkPut(rows);
}

export async function clearDeliveries(onlyDelivered: boolean) {
  if (onlyDelivered) await db.deliveries.where('status').equals('delivered').delete();
  else await db.deliveries.clear();
}

export async function findByTracking(tracking: string): Promise<Delivery | undefined> {
  if (!tracking) return undefined;
  return db.deliveries.where('tracking').equals(tracking).first();
}

export function geoFromResult(r: GeoResult) {
  return { status: r.status, lat: r.lat, lng: r.lng, formatted: r.formatted } as const;
}

let retrying = false;
/** Geocodes deliveries that were saved offline or before an API key was set. */
export async function retryPendingGeocodes() {
  if (retrying || !navigator.onLine) return;
  retrying = true;
  try {
    const { apiKey } = await getSettings();
    if (!apiKey) return;
    const pending = await db.deliveries.where('geoStatus').equals('pending').toArray();
    for (const d of pending) {
      try {
        const r = await geocodeAddress(apiKey, d);
        await updateDelivery(d.id, { lat: r.lat, lng: r.lng, geoStatus: r.status, formattedAddress: r.formatted });
      } catch {
        break; // still offline / key problem – try again later
      }
    }
  } finally {
    retrying = false;
  }
}

export function toCsv(rows: Delivery[], templateLabel: (id: string | null) => string) {
  const head = ['#', 'Status', 'Name', 'Street', 'No', 'Floor/door', 'Postcode', 'City', 'Tracking', 'Color', 'Description', 'Note', 'Lat', 'Lng', 'Scanned', 'Delivered'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((d) =>
    [
      d.seq, d.status, d.name, d.street, d.houseNumber, d.unit, d.postcode, d.city, d.tracking, d.color,
      templateLabel(d.templateId), d.note, d.lat ?? '', d.lng ?? '',
      new Date(d.createdAt).toLocaleString(), d.deliveredAt ? new Date(d.deliveredAt).toLocaleString() : '',
    ].map(esc).join(','),
  );
  return '﻿' + [head.join(','), ...lines].join('\n');
}

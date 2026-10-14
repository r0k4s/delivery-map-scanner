import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Delivery, Settings, Template } from '../types';

export const DEFAULT_TEMPLATES = [
  'Private address',
  'Business address',
  'Signature required',
  'Heavy package',
  'Pickup point',
  'Special instructions',
];

class DeliveryDB extends Dexie {
  deliveries!: Table<Delivery, string>;
  templates!: Table<Template, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('delivery-map-scanner');
    this.version(1).stores({
      deliveries: 'id, seq, status, color, tracking, createdAt, geoStatus',
      templates: 'id, order',
      kv: 'key',
    });
    this.on('populate', (tx) => {
      tx.table('templates').bulkAdd(
        DEFAULT_TEMPLATES.map((label, order) => ({ id: uid(), label, order })),
      );
    });
  }
}

export const db = new DeliveryDB();

export function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '',
  mapId: (import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined) || 'DEMO_MAP_ID',
  defaultColor: 'blue',
  defaultTemplateId: null,
  autoSave: true,
  autoCapture: true,
  hideDelivered: false,
  grayDelivered: true,
};

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  const stored = (row?.value ?? {}) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  // An empty saved key falls back to the build-time key
  if (!merged.apiKey) merged.apiKey = DEFAULT_SETTINGS.apiKey;
  if (!merged.mapId) merged.mapId = DEFAULT_SETTINGS.mapId;
  return merged;
}

export async function saveSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  await db.kv.put({ key: 'settings', value: { ...current, ...patch } });
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings, []);
}

export function useTemplates(): Template[] {
  return useLiveQuery(() => db.templates.orderBy('order').toArray(), []) ?? [];
}

export function useDeliveries(): Delivery[] | undefined {
  return useLiveQuery(() => db.deliveries.orderBy('seq').toArray(), []);
}

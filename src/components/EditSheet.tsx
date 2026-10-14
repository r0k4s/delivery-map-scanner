import { useEffect, useState } from 'react';
import { geocodeAddress, MapsKeyError } from '../lib/maps';
import { colorOf, type Address, type ColorKey, type Delivery, type GeoStatus, type Template } from '../types';
import { ColorPicker, Icon, Sheet, TemplateChips } from './ui';
import { MiniMap } from './MiniMap';

export interface EditValues {
  address: Address;
  tracking: string;
  color: ColorKey;
  templateId: string | null;
  note: string;
  geo: { status: GeoStatus; lat: number | null; lng: number | null; formatted: string };
}

interface GeoState {
  status: GeoStatus | 'stale' | 'checking';
  lat: number | null;
  lng: number | null;
  formatted: string;
  reason: string;
}

interface Props {
  open: boolean;
  mode: 'edit' | 'review';
  initial: EditValues & { geoReason?: string };
  apiKey: string;
  mapId: string;
  templates: Template[];
  thumb?: string;
  issues?: string[];
  duplicateOf?: Delivery | null;
  onSave: (v: EditValues) => void | Promise<void>;
  onCancel: () => void;
  onRetake?: () => void;
  onSkip?: () => void;
}

const GEO_LABEL: Record<GeoState['status'], { text: string; cls: string }> = {
  ok: { text: 'Exact address found', cls: 'bg-emerald-100 text-emerald-800' },
  approx: { text: 'Approximate position – check the pin', cls: 'bg-amber-100 text-amber-900' },
  manual: { text: 'Pin placed by hand', cls: 'bg-sky-100 text-sky-900' },
  pending: { text: 'Will be placed on the map when online', cls: 'bg-stone-100 text-stone-700' },
  failed: { text: 'Address not found on the map', cls: 'bg-red-100 text-red-800' },
  stale: { text: 'Address changed – position will be updated on save', cls: 'bg-stone-100 text-stone-700' },
  checking: { text: 'Finding address…', cls: 'bg-stone-100 text-stone-700' },
};

export function EditSheet(props: Props) {
  const { open, mode, initial, apiKey, mapId, templates, thumb, issues, duplicateOf } = props;
  const [a, setA] = useState<Address>(initial.address);
  const [tracking, setTracking] = useState(initial.tracking);
  const [color, setColor] = useState<ColorKey>(initial.color);
  const [templateId, setTemplateId] = useState(initial.templateId);
  const [note, setNote] = useState(initial.note);
  const [geo, setGeo] = useState<GeoState>({ ...initial.geo, reason: initial.geoReason ?? '' });
  const [confirmWeak, setConfirmWeak] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showImage, setShowImage] = useState(true);

  useEffect(() => {
    if (!open) return;
    setA(initial.address);
    setTracking(initial.tracking);
    setColor(initial.color);
    setTemplateId(initial.templateId);
    setNote(initial.note);
    setGeo({ ...initial.geo, reason: initial.geoReason ?? '' });
    setConfirmWeak(false);
    setShowMap(initial.geo.status === 'approx' || initial.geo.status === 'failed');
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const setField = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setA((prev) => ({ ...prev, [k]: e.target.value }));
    if (k !== 'name' && k !== 'unit') {
      setGeo((g) => (g.status === 'stale' ? g : { ...g, status: 'stale', reason: '' }));
      setConfirmWeak(false);
    }
  };

  async function lookup(): Promise<GeoState> {
    if (!apiKey) {
      const g: GeoState = { status: 'pending', lat: null, lng: null, formatted: '', reason: 'No Google Maps key – add one in Settings' };
      setGeo(g);
      return g;
    }
    setGeo((g) => ({ ...g, status: 'checking' }));
    try {
      const r = await geocodeAddress(apiKey, a);
      const g: GeoState = { status: r.status, lat: r.lat, lng: r.lng, formatted: r.formatted, reason: r.reason };
      setGeo(g);
      if (r.status !== 'ok') setShowMap(true);
      return g;
    } catch (e) {
      const offline = !navigator.onLine || (e as Error).message === 'offline';
      const g: GeoState = {
        status: 'pending',
        lat: null,
        lng: null,
        formatted: '',
        reason: offline ? 'You are offline' : e instanceof MapsKeyError ? e.message : 'Map lookup failed',
      };
      setGeo(g);
      return g;
    }
  }

  async function save() {
    if (!a.street.trim() || !a.postcode.trim()) return;
    setSaving(true);
    let g = geo;
    if (g.status === 'stale' || g.status === 'checking') g = await lookup();
    // Never silently place a doubtful pin: ask once more
    if ((g.status === 'approx' || g.status === 'failed') && !confirmWeak) {
      setConfirmWeak(true);
      setShowMap(true);
      setSaving(false);
      return;
    }
    const status: GeoStatus = g.status === 'stale' || g.status === 'checking' ? 'pending' : g.status;
    await props.onSave({
      address: { ...a, street: a.street.trim(), houseNumber: a.houseNumber.trim().toUpperCase(), postcode: a.postcode.trim(), city: a.city.trim(), unit: a.unit.trim() },
      tracking: tracking.trim().toUpperCase().replace(/\s/g, ''),
      color,
      templateId,
      note: note.trim(),
      geo: { status, lat: g.lat, lng: g.lng, formatted: g.formatted },
    });
    setSaving(false);
  }

  const chip = GEO_LABEL[geo.status];
  const canSave = !!a.street.trim() && !!a.postcode.trim();
  const weak = geo.status === 'approx' || geo.status === 'failed';

  return (
    <Sheet open={open} onClose={props.onCancel} tall title={mode === 'review' ? 'Check address' : 'Edit delivery'}>
      <div className="space-y-5">
        {duplicateOf && (
          <div className="flex gap-3 rounded-2xl bg-amber-100 p-4 text-amber-950">
            <Icon name="alert" className="shrink-0" />
            <div>
              <div className="font-bold">Already scanned as #{duplicateOf.seq}</div>
              <div className="text-sm">
                {duplicateOf.street} {duplicateOf.houseNumber} · tracking {duplicateOf.tracking}
              </div>
            </div>
          </div>
        )}

        {mode === 'review' && issues && issues.length > 0 && (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            <div className="mb-1 font-bold">Please check before saving</div>
            <ul className="list-disc space-y-0.5 pl-5">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}

        {thumb && (
          <div>
            <button type="button" className="mb-2 text-sm font-semibold text-stone-500" onClick={() => setShowImage((s) => !s)}>
              {showImage ? 'Hide' : 'Show'} label photo
            </button>
            {showImage && <img src={thumb} alt="Scanned label" className="max-h-56 w-full rounded-2xl bg-stone-100 object-contain" />}
          </div>
        )}

        <fieldset className="space-y-3">
          <Field label="Name / company" value={a.name} onChange={setField('name')} autoComplete="off" />
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="Street" value={a.street} onChange={setField('street')} required />
            <Field label="No." value={a.houseNumber} onChange={setField('houseNumber')} />
          </div>
          <Field label="Floor / door (e.g. 2. th)" value={a.unit} onChange={setField('unit')} />
          <div className="grid grid-cols-[6.5rem_1fr] gap-3">
            <Field label="Postcode" value={a.postcode} onChange={setField('postcode')} inputMode="numeric" required />
            <Field label="City" value={a.city} onChange={setField('city')} required />
          </div>
          <Field label="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} mono />
        </fieldset>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${chip.cls}`}>{chip.text}</span>
            {geo.status !== 'checking' && (
              <button type="button" onClick={lookup} className="text-sm font-bold text-accent-dark underline underline-offset-2">
                Check address
              </button>
            )}
          </div>
          {geo.formatted && <div className="text-sm text-stone-600">Map: {geo.formatted}</div>}
          {geo.reason && geo.status !== 'ok' && <div className="text-sm text-stone-500">{geo.reason}</div>}
          {apiKey &&
            (showMap ? (
              <>
                <MiniMap
                  apiKey={apiKey}
                  mapId={mapId}
                  lat={geo.lat}
                  lng={geo.lng}
                  color={colorOf(color).hex}
                  onMove={(lat, lng) => {
                    setGeo((g) => ({ ...g, status: 'manual', lat, lng, reason: '' }));
                    setConfirmWeak(false);
                  }}
                />
                <div className="text-xs text-stone-500">Drag the pin or tap the map to set the exact spot.</div>
              </>
            ) : (
              <button type="button" onClick={() => setShowMap(true)} className="text-sm font-semibold text-stone-600 underline underline-offset-2">
                Adjust pin on map
              </button>
            ))}
        </div>

        <div>
          <Label>Marker color</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        <div>
          <Label>Description</Label>
          <TemplateChips templates={templates} value={templateId} onChange={setTemplateId} />
        </div>

        <div>
          <Label>Note</Label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. Leave at back door, code 1234"
            className="w-full rounded-2xl border-0 bg-stone-100 px-4 py-3 text-base text-ink ring-1 ring-stone-200 focus:ring-2 focus:ring-accent focus:outline-none"
          />
        </div>

        {confirmWeak && weak && (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-200">
            {geo.status === 'failed'
              ? 'The address was not found. Fix it, place the pin by hand, or save it without a map position.'
              : 'The position is only approximate. Move the pin if needed, or save anyway.'}
          </div>
        )}

        <div className="sticky bottom-0 -mx-5 flex gap-3 bg-paper px-5 pt-2 pb-1">
          {mode === 'review' && props.onRetake && (
            <button type="button" onClick={props.onRetake} className="h-14 rounded-2xl bg-stone-100 px-5 font-semibold text-stone-700">
              Retake
            </button>
          )}
          {duplicateOf && props.onSkip && (
            <button type="button" onClick={props.onSkip} className="h-14 rounded-2xl bg-stone-100 px-5 font-semibold text-stone-700">
              Skip
            </button>
          )}
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={save}
            className="h-14 flex-1 rounded-2xl bg-ink text-lg font-bold text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : confirmWeak && weak ? (geo.status === 'failed' ? 'Save without pin' : 'Save anyway') : duplicateOf ? 'Add anyway' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-sm font-bold tracking-wide text-stone-500 uppercase">{children}</div>;
}

function Field({ label, mono, ...rest }: { label: string; mono?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold tracking-wide text-stone-500 uppercase">{label}</span>
      <input
        {...rest}
        className={`h-12 w-full rounded-xl border-0 bg-stone-100 px-3.5 text-base text-ink ring-1 ring-stone-200 focus:ring-2 focus:ring-accent focus:outline-none ${mono ? 'font-mono tracking-wide' : ''}`}
      />
    </label>
  );
}

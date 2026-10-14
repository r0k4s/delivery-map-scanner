import { useEffect, useState } from 'react';
import { db, saveSettings, uid } from '../lib/db';
import { clearDeliveries, retryPendingGeocodes, toCsv } from '../lib/store';
import type { Delivery, Settings, Template } from '../types';
import { useToast } from './Toast';
import { ColorPicker, ConfirmDialog, Icon, Toggle } from './ui';

interface Props {
  settings: Settings;
  templates: Template[];
  deliveries: Delivery[];
  installPrompt: (() => void) | null;
}

export function SettingsView({ settings, templates, deliveries, installPrompt }: Props) {
  const toast = useToast();
  const [key, setKey] = useState(settings.apiKey);
  const [mapId, setMapId] = useState(settings.mapId);
  const [showKey, setShowKey] = useState(false);
  const [newTpl, setNewTpl] = useState('');
  const [confirm, setConfirm] = useState<null | 'all' | 'delivered'>(null);
  const [tplToDelete, setTplToDelete] = useState<Template | null>(null);

  useEffect(() => setKey(settings.apiKey), [settings.apiKey]);
  useEffect(() => setMapId(settings.mapId), [settings.mapId]);

  async function saveMaps() {
    const keyChanged = key.trim() !== settings.apiKey;
    await saveSettings({ apiKey: key.trim(), mapId: mapId.trim() || 'DEMO_MAP_ID' });
    if (keyChanged && (window as unknown as { google?: unknown }).google) {
      toast.show({ tone: 'info', message: 'Key saved', sub: 'Reload the app to use the new key', actions: [{ label: 'Reload', primary: true, onClick: () => location.reload() }] });
    } else {
      toast.show({ tone: 'success', message: 'Map settings saved' });
      retryPendingGeocodes();
    }
  }

  async function addTemplate() {
    const label = newTpl.trim();
    if (!label) return;
    const order = (templates.at(-1)?.order ?? -1) + 1;
    await db.templates.add({ id: uid(), label, order });
    setNewTpl('');
  }

  async function renameTemplate(t: Template, label: string) {
    const clean = label.trim();
    if (!clean || clean === t.label) return;
    await db.templates.update(t.id, { label: clean });
  }

  async function deleteTemplate(t: Template) {
    await db.transaction('rw', db.templates, db.deliveries, db.kv, async () => {
      await db.templates.delete(t.id);
      await db.deliveries.filter((d) => d.templateId === t.id).modify((d) => {
        // keep the text on deliveries that used it
        d.note = [t.label, d.note].filter(Boolean).join(' – ');
        d.templateId = null;
      });
    });
    if (settings.defaultTemplateId === t.id) await saveSettings({ defaultTemplateId: null });
    setTplToDelete(null);
  }

  async function move(t: Template, dir: -1 | 1) {
    const i = templates.findIndex((x) => x.id === t.id);
    const other = templates[i + dir];
    if (!other) return;
    await db.transaction('rw', db.templates, async () => {
      await db.templates.update(t.id, { order: other.order });
      await db.templates.update(other.id, { order: t.order });
    });
  }

  function exportCsv() {
    const csv = toCsv(deliveries, (id) => templates.find((t) => t.id === id)?.label ?? '');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deliveries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const delivered = deliveries.filter((d) => d.status === 'delivered').length;

  return (
    <div className="h-full overflow-y-auto bg-stone-100" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 110px)' }}>
      <div className="mx-auto max-w-xl space-y-4 px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 18px)' }}>
        <h1 className="px-1 text-3xl font-black text-ink">Settings</h1>

        {installPrompt && (
          <button onClick={installPrompt} className="flex w-full items-center gap-3 rounded-3xl bg-ink p-5 text-left text-white">
            <Icon name="download" />
            <div className="flex-1">
              <div className="font-bold">Install on this phone</div>
              <div className="text-sm text-white/70">Opens full screen and works offline</div>
            </div>
          </button>
        )}

        <Card title="Scanning">
          <div className="mb-2 font-semibold text-ink">Default marker color</div>
          <ColorPicker value={settings.defaultColor} onChange={(c) => saveSettings({ defaultColor: c })} />
          <div className="mt-5 mb-2 font-semibold text-ink">Default description</div>
          <select
            value={settings.defaultTemplateId ?? ''}
            onChange={(e) => saveSettings({ defaultTemplateId: e.target.value || null })}
            className="h-12 w-full rounded-xl border-0 bg-stone-100 px-3 text-base text-ink ring-1 ring-stone-200"
          >
            <option value="">None</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="mt-3 divide-y divide-stone-100">
            <Toggle label="Save clear scans automatically" hint="Only doubtful addresses ask for confirmation" checked={settings.autoSave} onChange={(v) => saveSettings({ autoSave: v })} />
            <Toggle label="Auto-capture" hint="Reads the label as soon as the camera is steady" checked={settings.autoCapture} onChange={(v) => saveSettings({ autoCapture: v })} />
          </div>
        </Card>

        <Card title="Description templates">
          <ul className="space-y-2">
            {templates.map((t, i) => (
              <li key={t.id} className="flex items-center gap-1.5">
                <input
                  defaultValue={t.label}
                  key={t.label}
                  onBlur={(e) => renameTemplate(t, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  aria-label="Template name"
                  className="h-12 min-w-0 flex-1 rounded-xl border-0 bg-stone-100 px-3 text-base text-ink ring-1 ring-stone-200 focus:ring-2 focus:ring-accent focus:outline-none"
                />
                <button onClick={() => move(t, -1)} disabled={i === 0} className="grid h-12 w-9 place-items-center text-stone-500 disabled:opacity-25" aria-label="Move up">
                  ▲
                </button>
                <button onClick={() => move(t, 1)} disabled={i === templates.length - 1} className="grid h-12 w-9 place-items-center text-stone-500 disabled:opacity-25" aria-label="Move down">
                  ▼
                </button>
                <button onClick={() => setTplToDelete(t)} className="grid h-12 w-12 place-items-center rounded-xl text-red-600" aria-label={`Delete ${t.label}`}>
                  <Icon name="trash" size={20} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addTemplate();
            }}
          >
            <input
              value={newTpl}
              onChange={(e) => setNewTpl(e.target.value)}
              placeholder="New description…"
              className="h-12 min-w-0 flex-1 rounded-xl border-0 bg-stone-100 px-3 text-base text-ink ring-1 ring-stone-200 focus:ring-2 focus:ring-accent focus:outline-none"
            />
            <button type="submit" disabled={!newTpl.trim()} className="flex h-12 items-center gap-1 rounded-xl bg-ink px-4 font-bold text-white disabled:opacity-40">
              <Icon name="plus" size={18} /> Add
            </button>
          </form>
        </Card>

        <Card title="Map">
          <div className="divide-y divide-stone-100">
            <Toggle label="Hide delivered packages" checked={settings.hideDelivered} onChange={(v) => saveSettings({ hideDelivered: v })} />
            <Toggle label="Gray out delivered markers" hint="Otherwise they keep their color with a ✓" checked={settings.grayDelivered} onChange={(v) => saveSettings({ grayDelivered: v })} />
          </div>
        </Card>

        <Card title="Google Maps">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">API key</span>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="AIza…"
                autoComplete="off"
                spellCheck={false}
                className="h-12 min-w-0 flex-1 rounded-xl border-0 bg-stone-100 px-3 font-mono text-sm text-ink ring-1 ring-stone-200 focus:ring-2 focus:ring-accent focus:outline-none"
              />
              <button type="button" onClick={() => setShowKey((s) => !s)} className="grid h-12 w-12 place-items-center rounded-xl bg-stone-100 text-stone-600" aria-label={showKey ? 'Hide key' : 'Show key'}>
                <Icon name={showKey ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </div>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-semibold text-ink">Map ID</span>
            <input
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              placeholder="DEMO_MAP_ID"
              className="h-12 w-full rounded-xl border-0 bg-stone-100 px-3 font-mono text-sm text-ink ring-1 ring-stone-200 focus:ring-2 focus:ring-accent focus:outline-none"
            />
          </label>
          <p className="mt-2 text-sm text-stone-500">
            Enable <b>Maps JavaScript API</b> and <b>Geocoding API</b> for the key, and restrict it to this app's web address. The key is stored only on this phone.
          </p>
          <button onClick={saveMaps} className="mt-3 h-12 w-full rounded-xl bg-ink font-bold text-white">
            Save map settings
          </button>
        </Card>

        <Card title="Data">
          <p className="mb-3 text-stone-600">
            {deliveries.length} deliveries stored on this phone · {delivered} delivered
          </p>
          <div className="grid gap-2">
            <button onClick={exportCsv} disabled={!deliveries.length} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-stone-100 font-semibold text-ink ring-1 ring-stone-200 disabled:opacity-40">
              <Icon name="download" size={18} /> Export as CSV
            </button>
            <button onClick={() => setConfirm('delivered')} disabled={!delivered} className="h-12 rounded-xl bg-stone-100 font-semibold text-ink ring-1 ring-stone-200 disabled:opacity-40">
              Clear delivered ({delivered})
            </button>
            <button onClick={() => setConfirm('all')} disabled={!deliveries.length} className="h-12 rounded-xl bg-red-600 font-bold text-white disabled:opacity-40">
              Clear all deliveries
            </button>
          </div>
        </Card>

        <p className="px-1 pb-4 text-center text-xs text-stone-400">Delivery Map Scanner · data stays on this device</p>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'all' ? 'Clear all deliveries?' : 'Clear delivered packages?'}
        body={confirm === 'all' ? `All ${deliveries.length} deliveries and their history will be removed from this phone. This cannot be undone.` : `${delivered} delivered packages will be removed. Pending deliveries are kept.`}
        confirmLabel={confirm === 'all' ? 'Clear all' : 'Clear delivered'}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await clearDeliveries(confirm === 'delivered');
          setConfirm(null);
          toast.show({ tone: 'info', message: 'Deliveries cleared' });
        }}
      />
      <ConfirmDialog
        open={tplToDelete !== null}
        title={`Delete “${tplToDelete?.label}”?`}
        body="Deliveries that use it keep the text as a note."
        confirmLabel="Delete"
        danger
        onCancel={() => setTplToDelete(null)}
        onConfirm={() => tplToDelete && deleteTemplate(tplToDelete)}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-paper p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-bold tracking-wider text-stone-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

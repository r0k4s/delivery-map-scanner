import { useEffect, useMemo, useState } from 'react';
import { useDeliveries, useSettings, useTemplates } from './lib/db';
import { retryPendingGeocodes, updateDelivery } from './lib/store';
import { EditSheet, type EditValues } from './components/EditSheet';
import { InfoSheet } from './components/InfoSheet';
import { ListView, type StatusFilter } from './components/ListView';
import { groupKey, MapView } from './components/MapView';
import { Scanner } from './components/Scanner';
import { SettingsView } from './components/SettingsView';
import { Icon } from './components/ui';

type Tab = 'map' | 'list' | 'settings';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export default function App() {
  const settings = useSettings();
  const templates = useTemplates();
  const deliveries = useDeliveries();
  const [tab, setTab] = useState<Tab>('map');
  const [scanning, setScanning] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<StatusFilter>('all');
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);

  // Geocode anything saved offline, whenever we're back online or the key changes
  useEffect(() => {
    if (!settings?.apiKey) return;
    retryPendingGeocodes();
    const on = () => retryPendingGeocodes();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [settings?.apiKey]);

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const list = deliveries ?? [];
  const selectedItems = useMemo(
    () => (selectedKey ? list.filter((d) => d.lat != null && groupKey(d) === selectedKey) : []),
    [list, selectedKey],
  );

  useEffect(() => {
    if (selectedKey && selectedItems.length === 0) setSelectedKey(null);
  }, [selectedKey, selectedItems.length]);

  const editing = editId ? list.find((d) => d.id === editId) : undefined;
  const editInitial = useMemo(
    () =>
      editing
        ? {
            address: { name: editing.name, street: editing.street, houseNumber: editing.houseNumber, unit: editing.unit, postcode: editing.postcode, city: editing.city, country: editing.country },
            tracking: editing.tracking,
            color: editing.color,
            templateId: editing.templateId,
            note: editing.note,
            geo: { status: editing.geoStatus, lat: editing.lat, lng: editing.lng, formatted: editing.formattedAddress },
          }
        : null,
    // Only rebuild when a different delivery is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editId, !!editing],
  );

  async function saveEdit(v: EditValues) {
    if (!editId) return;
    await updateDelivery(editId, {
      ...v.address,
      tracking: v.tracking,
      color: v.color,
      templateId: v.templateId,
      note: v.note,
      lat: v.geo.lat,
      lng: v.geo.lng,
      geoStatus: v.geo.status,
      formattedAddress: v.geo.formatted,
    });
    setEditId(null);
  }

  if (!settings) return <div className="grid h-dvh place-items-center bg-ink text-white">Loading…</div>;

  const pendingCount = list.filter((d) => d.status === 'pending').length;

  return (
    <div className="relative h-dvh overflow-hidden bg-stone-100">
      <div className={tab === 'map' ? 'h-full' : 'hidden'}>
        <MapView
          deliveries={list}
          settings={settings}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          focus={focus}
          onOpenSettings={() => setTab('settings')}
          onShowUnplaced={() => {
            setListStatus('unplaced');
            setTab('list');
          }}
        />
      </div>
      {tab === 'list' && (
        <ListView
          deliveries={list}
          templates={templates}
          grayDelivered={settings.grayDelivered}
          status={listStatus}
          onStatus={setListStatus}
          onFocus={(id) => {
            setTab('map');
            setFocus({ id, n: Date.now() });
          }}
          onEdit={setEditId}
        />
      )}
      {tab === 'settings' && <SettingsView settings={settings} templates={templates} deliveries={list} installPrompt={install ? () => install.prompt().then(() => setInstall(null)) : null} />}

      {/* Bottom navigation with the big Scan button */}
      <nav className="absolute inset-x-0 bottom-0 z-20 px-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        <div className="mx-auto flex max-w-md items-center gap-2 rounded-[28px] bg-ink p-2 shadow-2xl">
          <NavButton icon="map" label="Map" active={tab === 'map'} onClick={() => setTab('map')} />
          <NavButton icon="list" label="List" active={tab === 'list'} badge={pendingCount || undefined} onClick={() => setTab('list')} />
          <button
            onClick={() => {
              setSelectedKey(null);
              setScanning(true);
            }}
            className="flex h-16 flex-[1.6] items-center justify-center gap-2 rounded-[22px] bg-accent text-lg font-black text-ink active:scale-[0.97]"
          >
            <Icon name="scan" size={26} strokeWidth={2.4} /> Scan Label
          </button>
          <NavButton icon="settings" label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
        </div>
      </nav>

      <InfoSheet items={tab === 'map' ? selectedItems : []} templates={templates} onClose={() => setSelectedKey(null)} onEdit={setEditId} />

      {editInitial && (
        <EditSheet
          open
          mode="edit"
          initial={editInitial}
          apiKey={settings.apiKey}
          mapId={settings.mapId}
          templates={templates}
          onSave={saveEdit}
          onCancel={() => setEditId(null)}
        />
      )}

      <Scanner open={scanning} onClose={() => setScanning(false)} settings={settings} templates={templates} scannedCount={list.length} />
    </div>
  );
}

function NavButton({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] font-bold ${active ? 'bg-white/15 text-white' : 'text-white/60'}`} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} size={22} />
      {label}
      {badge !== undefined && <span className="absolute top-1.5 right-2 min-w-5 rounded-full bg-accent px-1 text-[11px] leading-5 font-black text-ink">{badge}</span>}
    </button>
  );
}

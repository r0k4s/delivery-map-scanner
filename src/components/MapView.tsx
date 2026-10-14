import { MarkerClusterer, SuperClusterAlgorithm, type Renderer } from '@googlemaps/markerclusterer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COPENHAGEN, loadMaps } from '../lib/maps';
import { colorOf, DELIVERED_HEX, type Delivery, type Settings } from '../types';
import { saveSettings } from '../lib/db';
import { Icon } from './ui';

export interface Group {
  key: string;
  lat: number;
  lng: number;
  items: Delivery[];
}

export function groupKey(d: Pick<Delivery, 'lat' | 'lng'>) {
  return `${d.lat!.toFixed(5)},${d.lng!.toFixed(5)}`;
}

/** Packages at the same spot share one marker (with a count badge) instead of hiding each other. */
export function groupDeliveries(list: Delivery[]): Group[] {
  const map = new Map<string, Group>();
  for (const d of list) {
    if (d.lat == null || d.lng == null) continue;
    const key = groupKey(d);
    const g = map.get(key);
    if (g) g.items.push(d);
    else map.set(key, { key, lat: d.lat, lng: d.lng, items: [d] });
  }
  return [...map.values()];
}

interface Props {
  deliveries: Delivery[];
  settings: Settings;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  focus: { id: string; n: number } | null;
  onOpenSettings: () => void;
  onShowUnplaced: () => void;
}

function pinContent(g: Group, settings: Settings, selected: boolean) {
  const pending = g.items.filter((d) => d.status === 'pending');
  const allDone = pending.length === 0;
  const lead = pending[0] ?? g.items[0];
  const hex = allDone && settings.grayDelivered ? DELIVERED_HEX : colorOf(lead.color).hex;
  const label = allDone ? '✓' : String(lead.seq);
  const el = document.createElement('div');
  el.className = `dm-pin${selected ? ' dm-pin-selected' : ''}${allDone ? ' dm-pin-done' : ''}`;
  el.innerHTML = `<svg viewBox="0 0 40 52" width="40" height="52" aria-hidden="true"><path d="M20 50.5S36.5 33.6 36.5 20.5a16.5 16.5 0 0 0-33 0C3.5 33.6 20 50.5 20 50.5z" fill="${hex}" stroke="#1c1917" stroke-width="2.5"/></svg><span class="dm-pin-label">${label}</span>${g.items.length > 1 ? `<span class="dm-pin-badge">${g.items.length}</span>` : ''}`;
  el.setAttribute('aria-label', `${lead.street} ${lead.houseNumber}`);
  return el;
}

const clusterRenderer: Renderer = {
  render({ count, position }) {
    const el = document.createElement('div');
    el.className = 'dm-cluster';
    el.textContent = String(count);
    return new google.maps.marker.AdvancedMarkerElement({ position, content: el, zIndex: 1000 + count });
  },
};

export function MapView({ deliveries, settings, selectedKey, onSelect, focus, onOpenSettings, onShowUnplaced }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState('');
  const clusterer = useRef<MarkerClusterer | null>(null);
  const markers = useRef(new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; sig: string }>());
  const me = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [myPos, setMyPos] = useState<google.maps.LatLngLiteral | null>(null);
  const [geoError, setGeoError] = useState('');
  const didFit = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const visible = useMemo(() => (settings.hideDelivered ? deliveries.filter((d) => d.status === 'pending') : deliveries), [deliveries, settings.hideDelivered]);
  const groups = useMemo(() => groupDeliveries(visible), [visible]);
  const unplaced = deliveries.filter((d) => d.lat == null).length;
  const pendingCount = deliveries.filter((d) => d.status === 'pending').length;

  // ---- create map
  useEffect(() => {
    if (!settings.apiKey) return;
    let cancelled = false;
    const onAuth = () => setError('Google rejected the API key. Check it in Settings.');
    window.addEventListener('maps-auth-failure', onAuth);
    loadMaps(settings.apiKey)
      .then((g) => {
        if (cancelled || !el.current) return;
        const m = new g.maps.Map(el.current, {
          center: COPENHAGEN,
          zoom: 12,
          mapId: settings.mapId,
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        });
        m.addListener('click', () => onSelectRef.current(null));
        clusterer.current = new MarkerClusterer({
          map: m,
          markers: [],
          renderer: clusterRenderer,
          algorithm: new SuperClusterAlgorithm({ radius: 56, maxZoom: 15 }),
        });
        setMap(m);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      window.removeEventListener('maps-auth-failure', onAuth);
    };
  }, [settings.apiKey, settings.mapId]);

  // ---- sync markers
  useEffect(() => {
    if (!map || !clusterer.current) return;
    const seen = new Set<string>();
    let changed = false;
    for (const g of groups) {
      seen.add(g.key);
      const selected = g.key === selectedKey;
      const sig = JSON.stringify([g.items.map((d) => [d.id, d.color, d.status, d.seq]), selected, settings.grayDelivered]);
      const existing = markers.current.get(g.key);
      if (existing && existing.sig === sig) continue;
      changed = true;
      if (existing) {
        existing.marker.content = pinContent(g, settings, selected);
        existing.marker.zIndex = selected ? 999 : g.items.some((d) => d.status === 'pending') ? 10 : 1;
        existing.sig = sig;
      } else {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          position: { lat: g.lat, lng: g.lng },
          content: pinContent(g, settings, selected),
          zIndex: selected ? 999 : 10,
          gmpClickable: true,
        });
        const key = g.key;
        marker.addListener('click', () => onSelectRef.current(key));
        markers.current.set(g.key, { marker, sig });
      }
    }
    for (const [key, { marker }] of markers.current) {
      if (!seen.has(key)) {
        marker.map = null;
        markers.current.delete(key);
        changed = true;
      }
    }
    if (changed) {
      clusterer.current.clearMarkers(true);
      clusterer.current.addMarkers([...markers.current.values()].map((m) => m.marker));
    }
    if (!didFit.current && groups.length) {
      didFit.current = true;
      fitAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, groups, selectedKey, settings.grayDelivered]);

  // ---- GPS
  useEffect(() => {
    if (!map || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGeoError('');
        setMyPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (e) => setGeoError(e.code === e.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [map]);

  useEffect(() => {
    if (!map || !myPos) return;
    if (!me.current) {
      const dot = document.createElement('div');
      dot.className = 'dm-me';
      me.current = new google.maps.marker.AdvancedMarkerElement({ map, position: myPos, content: dot, zIndex: 2000 });
    } else {
      me.current.position = myPos;
    }
  }, [map, myPos]);

  // ---- focus from list
  useEffect(() => {
    if (!map || !focus) return;
    const d = deliveries.find((x) => x.id === focus.id);
    if (!d || d.lat == null || d.lng == null) return;
    map.panTo({ lat: d.lat, lng: d.lng });
    map.setZoom(18);
    onSelectRef.current(groupKey(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus]);

  function fitAll() {
    if (!map) return;
    if (!groups.length) {
      if (myPos) map.panTo(myPos);
      return;
    }
    if (groups.length === 1) {
      map.panTo({ lat: groups[0].lat, lng: groups[0].lng });
      map.setZoom(16);
      return;
    }
    const b = new google.maps.LatLngBounds();
    groups.forEach((g) => b.extend({ lat: g.lat, lng: g.lng }));
    map.fitBounds(b, { top: 90, bottom: 140, left: 40, right: 70 });
  }

  function centerOnMe() {
    if (myPos && map) {
      map.panTo(myPos);
      if ((map.getZoom() ?? 0) < 15) map.setZoom(16);
      return;
    }
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMyPos(pos);
        map?.panTo(pos);
        map?.setZoom(16);
      },
      (e) => setGeoError(e.code === e.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  if (!settings.apiKey || error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-stone-200 p-8 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-ink shadow">
          <Icon name="map" size={30} />
        </div>
        <div className="max-w-xs">
          <div className="text-lg font-bold text-ink">{error ? 'Map could not load' : 'Add your Google Maps key'}</div>
          <p className="mt-1 text-stone-600">{error || 'The map needs a Google Maps API key. Scanning still works – deliveries are placed on the map once a key is set.'}</p>
        </div>
        <button onClick={onOpenSettings} className="h-12 rounded-2xl bg-ink px-6 font-bold text-white">
          Open Settings
        </button>
        {deliveries.length > 0 && <div className="text-sm text-stone-500">{deliveries.length} deliveries saved</div>}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="absolute inset-0 bg-stone-200" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start gap-2 p-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="pointer-events-auto rounded-full bg-paper/95 px-4 py-2 text-sm font-bold text-ink shadow-md backdrop-blur">
          {pendingCount} to deliver
          <span className="font-semibold text-stone-500"> · {deliveries.length - pendingCount} done</span>
        </div>
        {unplaced > 0 && (
          <button onClick={onShowUnplaced} className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-amber-950 shadow-md">
            <Icon name="alert" size={16} /> {unplaced} not on map
          </button>
        )}
        {geoError && <div className="pointer-events-auto rounded-full bg-paper/95 px-3 py-2 text-xs font-semibold text-stone-600 shadow">{geoError}</div>}
      </div>

      <div className="absolute right-3 flex flex-col gap-2.5" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 112px)' }}>
        <MapButton icon={settings.hideDelivered ? 'eyeOff' : 'eye'} label={settings.hideDelivered ? 'Show delivered' : 'Hide delivered'} active={settings.hideDelivered} onClick={() => saveSettings({ hideDelivered: !settings.hideDelivered })} />
        <MapButton icon="fit" label="Show all deliveries" onClick={fitAll} />
        <MapButton icon="locate" label="Center on my location" onClick={centerOnMe} />
      </div>
    </div>
  );
}

function MapButton({ icon, label, onClick, active }: { icon: string; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`grid h-14 w-14 place-items-center rounded-2xl shadow-lg active:scale-95 ${active ? 'bg-ink text-white' : 'bg-paper text-ink'}`}>
      <Icon name={icon} size={24} />
    </button>
  );
}

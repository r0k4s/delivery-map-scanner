import { useEffect, useRef, useState } from 'react';
import { COPENHAGEN, loadMaps } from '../lib/maps';

/** Small map with a draggable pin, used to check or hand-place a delivery position. */
export function MiniMap({ apiKey, mapId, lat, lng, color, onMove }: { apiKey: string; mapId: string; lat: number | null; lng: number | null; color: string; onMove: (lat: number, lng: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const pinRef = useRef<google.maps.marker.PinElement | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadMaps(apiKey)
      .then((g) => {
        if (cancelled || !el.current) return;
        const center = lat != null && lng != null ? { lat, lng } : COPENHAGEN;
        const map = new g.maps.Map(el.current, {
          center,
          zoom: lat != null ? 17 : 12,
          mapId,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        });
        const pin = new g.maps.marker.PinElement({ background: color, borderColor: '#1c1917', glyphColor: '#fff', scale: 1.2 });
        const marker = new g.maps.marker.AdvancedMarkerElement({ map, position: center, gmpDraggable: true, content: pin.element });
        marker.addListener('dragend', () => {
          const p = marker.position as google.maps.LatLngLiteral | google.maps.LatLng | null;
          if (!p) return;
          const ll = p instanceof g.maps.LatLng ? p.toJSON() : (p as google.maps.LatLngLiteral);
          onMoveRef.current(ll.lat, ll.lng);
        });
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          marker.position = e.latLng;
          onMoveRef.current(e.latLng.lat(), e.latLng.lng());
        });
        mapRef.current = map;
        markerRef.current = marker;
        pinRef.current = pin;
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      if (markerRef.current) markerRef.current.map = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, mapId]);

  useEffect(() => {
    if (lat == null || lng == null || !markerRef.current || !mapRef.current) return;
    markerRef.current.position = { lat, lng };
    mapRef.current.panTo({ lat, lng });
    if ((mapRef.current.getZoom() ?? 0) < 16) mapRef.current.setZoom(17);
  }, [lat, lng]);

  useEffect(() => {
    if (pinRef.current) pinRef.current.background = color;
  }, [color]);

  if (error) return <div className="rounded-2xl bg-stone-100 p-4 text-sm text-stone-500">Map unavailable: {error}</div>;
  return <div ref={el} className="h-52 w-full overflow-hidden rounded-2xl bg-stone-200" />;
}

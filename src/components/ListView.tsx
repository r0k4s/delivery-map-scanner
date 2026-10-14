import { useMemo, useState } from 'react';
import { navigationUrl } from '../lib/maps';
import { cityLine, colorOf, COLORS, DELIVERED_HEX, streetLine, type ColorKey, type Delivery, type Template } from '../types';
import { describe, useDeliveryActions } from './DeliveryActions';
import { Icon } from './ui';

export type StatusFilter = 'all' | 'pending' | 'delivered' | 'unplaced';
type Sort = 'seq' | 'address' | 'status';

interface Props {
  deliveries: Delivery[];
  templates: Template[];
  grayDelivered: boolean;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  onFocus: (id: string) => void;
  onEdit: (id: string) => void;
}

const addrKey = (d: Delivery) => `${d.street}|${d.houseNumber}|${d.unit}|${d.postcode}`.toLowerCase();

export function ListView({ deliveries, templates, grayDelivered, status, onStatus, onFocus, onEdit }: Props) {
  const [q, setQ] = useState('');
  const [colors, setColors] = useState<ColorKey[]>([]);
  const [sort, setSort] = useState<Sort>('seq');
  const [openId, setOpenId] = useState<string | null>(null);
  const { deliver, remove } = useDeliveryActions();

  const sameAddress = useMemo(() => {
    const m = new Map<string, number>();
    deliveries.forEach((d) => m.set(addrKey(d), (m.get(addrKey(d)) ?? 0) + 1));
    return m;
  }, [deliveries]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = deliveries.filter((d) => {
      if (status === 'pending' && d.status !== 'pending') return false;
      if (status === 'delivered' && d.status !== 'delivered') return false;
      if (status === 'unplaced' && d.lat != null) return false;
      if (colors.length && !colors.includes(d.color)) return false;
      if (!needle) return true;
      const hay = [d.street, d.houseNumber, d.unit, d.postcode, d.city, d.name, d.tracking, describe(d, templates), `#${d.seq}`].join(' ').toLowerCase();
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
    r = [...r];
    if (sort === 'address') r.sort((a, b) => a.street.localeCompare(b.street, 'da') || parseInt(a.houseNumber) - parseInt(b.houseNumber) || a.seq - b.seq);
    else if (sort === 'status') r.sort((a, b) => (a.status === b.status ? a.seq - b.seq : a.status === 'pending' ? -1 : 1));
    else r.sort((a, b) => a.seq - b.seq);
    return r;
  }, [deliveries, templates, q, status, colors, sort]);

  const unplacedCount = deliveries.filter((d) => d.lat == null).length;
  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: `All ${deliveries.length}` },
    { key: 'pending', label: `Pending ${deliveries.filter((d) => d.status === 'pending').length}` },
    { key: 'delivered', label: `Done ${deliveries.filter((d) => d.status === 'delivered').length}` },
    ...(unplacedCount ? [{ key: 'unplaced' as const, label: `Not on map ${unplacedCount}` }] : []),
  ];

  return (
    <div className="flex h-full flex-col bg-stone-100">
      <div className="space-y-3 bg-paper px-4 pb-3 shadow-sm" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)' }}>
        <div className="relative">
          <Icon name="search" className="absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Street, postcode, description, tracking…"
            className="h-12 w-full rounded-2xl border-0 bg-stone-100 pr-4 pl-11 text-base text-ink ring-1 ring-stone-200 focus:ring-2 focus:ring-accent focus:outline-none"
          />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
          {statusTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onStatus(t.key)}
              className={`h-10 shrink-0 rounded-full px-4 text-sm font-bold whitespace-nowrap ${status === t.key ? (t.key === 'unplaced' ? 'bg-amber-400 text-amber-950' : 'bg-ink text-white') : 'bg-stone-100 text-stone-600'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1.5 overflow-x-auto no-scrollbar">
            {COLORS.map((c) => {
              const on = colors.includes(c.key);
              return (
                <button
                  key={c.key}
                  aria-label={`Filter ${c.label}`}
                  aria-pressed={on}
                  onClick={() => setColors((prev) => (on ? prev.filter((k) => k !== c.key) : [...prev, c.key]))}
                  className={`h-9 w-9 shrink-0 rounded-full transition ${on ? 'ring-[3px] ring-ink ring-offset-2' : colors.length ? 'opacity-35' : ''}`}
                  style={{ background: c.hex }}
                />
              );
            })}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-10 rounded-xl border-0 bg-stone-100 px-3 text-sm font-semibold text-ink ring-1 ring-stone-200"
            aria-label="Sort"
          >
            <option value="seq">Scan order</option>
            <option value="address">Address</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 110px)' }}>
        {rows.length === 0 && (
          <div className="mt-16 text-center text-stone-500">
            <Icon name="package" size={40} className="mx-auto mb-3 text-stone-400" />
            {deliveries.length ? 'No deliveries match.' : 'No deliveries yet. Tap Scan to add the first label.'}
          </div>
        )}
        <ul className="space-y-2">
          {rows.map((d) => {
            const hex = d.status === 'delivered' && grayDelivered ? DELIVERED_HEX : colorOf(d.color).hex;
            const desc = describe(d, templates);
            const same = sameAddress.get(addrKey(d)) ?? 1;
            const expanded = openId === d.id;
            return (
              <li key={d.id} className={`overflow-hidden rounded-2xl bg-paper shadow-sm ${d.status === 'delivered' ? 'opacity-75' : ''}`}>
                <div className="flex items-stretch">
                  <span className="w-2 shrink-0" style={{ background: hex }} />
                  <button className="min-w-0 flex-1 py-3 pr-2 pl-3 text-left" onClick={() => (d.lat == null ? onEdit(d.id) : onFocus(d.id))}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-stone-400 tabular-nums">#{d.seq}</span>
                      <span className={`truncate text-[17px] font-bold text-ink ${d.status === 'delivered' ? 'line-through decoration-stone-400' : ''}`}>{streetLine(d)}</span>
                    </div>
                    <div className="truncate text-stone-600">{cityLine(d)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${d.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                        {d.status === 'delivered' ? 'Delivered' : 'Pending'}
                      </span>
                      {same > 1 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-900">{same} pkgs here</span>}
                      {d.lat == null && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-950">Not on map – tap to fix</span>}
                      {d.geoStatus === 'approx' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Approx. pin</span>}
                      {desc && <span className="truncate text-sm text-stone-500">{desc}</span>}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1 pr-2">
                    <button
                      onClick={() => deliver([d], d.status === 'pending')}
                      aria-label={d.status === 'pending' ? 'Mark delivered' : 'Mark pending'}
                      className={`grid h-12 w-12 place-items-center rounded-xl ${d.status === 'pending' ? 'bg-emerald-600 text-white' : 'bg-stone-200 text-stone-600'}`}
                    >
                      <Icon name={d.status === 'pending' ? 'check' : 'undo'} strokeWidth={3} />
                    </button>
                    <button onClick={() => setOpenId(expanded ? null : d.id)} aria-label="More actions" aria-expanded={expanded} className="grid h-12 w-10 place-items-center rounded-xl text-stone-500">
                      <Icon name="more" strokeWidth={3} />
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="grid grid-cols-3 gap-2 border-t border-stone-100 p-2 pl-4">
                    <a href={navigationUrl(d)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-sky-600 text-sm font-bold text-white">
                      <Icon name="nav" size={18} /> Navigate
                    </a>
                    <button onClick={() => onEdit(d.id)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-stone-100 text-sm font-bold text-ink">
                      <Icon name="edit" size={18} /> Edit
                    </button>
                    <button
                      onClick={() => {
                        setOpenId(null);
                        remove([d]);
                      }}
                      className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-50 text-sm font-bold text-red-700"
                    >
                      <Icon name="trash" size={18} /> Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

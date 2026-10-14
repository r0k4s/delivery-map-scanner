import { navigationUrl } from '../lib/maps';
import { cityLine, colorOf, streetLine, type Delivery, type Template } from '../types';
import { describe, useDeliveryActions } from './DeliveryActions';
import { ColorDot, Icon, Sheet } from './ui';

interface Props {
  items: Delivery[];
  templates: Template[];
  onClose: () => void;
  onEdit: (id: string) => void;
}

export function InfoSheet({ items, templates, onClose, onEdit }: Props) {
  const { deliver, remove } = useDeliveryActions();
  const open = items.length > 0;
  const pending = items.filter((d) => d.status === 'pending');
  const first = items[0];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={items.length > 1 ? `${items.length} packages at this address` : first ? `#${first.seq}` : ''}
    >
      {first && (
        <div className="space-y-4">
          <div>
            <div className="text-2xl leading-tight font-black text-ink">{streetLine(first)}</div>
            <div className="text-lg text-stone-600">{cityLine(first)}</div>
            {first.geoStatus === 'approx' && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
                <Icon name="alert" size={15} /> Approximate position
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <a
              href={navigationUrl(first)}
              target="_blank"
              rel="noreferrer"
              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-sky-600 text-lg font-bold text-white active:bg-sky-700"
            >
              <Icon name="nav" /> Navigate
            </a>
            {items.length > 1 && pending.length > 1 ? (
              <button onClick={() => deliver(pending).then(onClose)} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-bold text-white active:bg-emerald-700">
                <Icon name="check" strokeWidth={3} /> Deliver all
              </button>
            ) : items.length === 1 ? (
              first.status === 'pending' ? (
                <button onClick={() => deliver([first]).then(onClose)} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-bold text-white active:bg-emerald-700">
                  <Icon name="check" strokeWidth={3} /> Mark delivered
                </button>
              ) : (
                <button onClick={() => deliver([first], false)} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-stone-200 text-lg font-bold text-stone-800">
                  <Icon name="undo" /> Mark pending
                </button>
              )
            ) : (
              <div />
            )}
          </div>

          <div className="space-y-3">
            {items.map((d) => (
              <PackageCard key={d.id} d={d} templates={templates} multi={items.length > 1} onEdit={() => onEdit(d.id)} onDelete={() => remove([d]).then(() => items.length === 1 && onClose())} onToggle={() => deliver([d], d.status === 'pending')} />
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function PackageCard({ d, templates, multi, onEdit, onDelete, onToggle }: { d: Delivery; templates: Template[]; multi: boolean; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
  const c = colorOf(d.color);
  const desc = describe(d, templates);
  return (
    <div className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-[15px]">
        {multi && (
          <>
            <dt className="text-stone-500">Package</dt>
            <dd className="font-bold text-ink">#{d.seq}</dd>
          </>
        )}
        {d.name && (
          <>
            <dt className="text-stone-500">Recipient</dt>
            <dd className="font-semibold text-ink">{d.name}</dd>
          </>
        )}
        <dt className="text-stone-500">Status</dt>
        <dd>
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${d.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
            {d.status === 'delivered' ? `Delivered ${d.deliveredAt ? new Date(d.deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}` : 'Pending'}
          </span>
        </dd>
        <dt className="text-stone-500">Color</dt>
        <dd className="flex items-center gap-2 font-semibold text-ink">
          <ColorDot hex={c.hex} size={16} /> {c.label}
        </dd>
        <dt className="text-stone-500">Description</dt>
        <dd className="text-ink">{desc || <span className="text-stone-400">None</span>}</dd>
        {d.tracking && (
          <>
            <dt className="text-stone-500">Tracking</dt>
            <dd className="font-mono text-sm break-all text-ink">{d.tracking}</dd>
          </>
        )}
      </dl>
      <div className="mt-4 flex gap-2">
        {multi && (
          <button onClick={onToggle} className={`h-12 flex-1 rounded-xl font-bold ${d.status === 'pending' ? 'bg-emerald-600 text-white' : 'bg-stone-200 text-stone-800'}`}>
            {d.status === 'pending' ? 'Delivered' : 'Pending'}
          </button>
        )}
        <button onClick={onEdit} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-white font-semibold text-ink ring-1 ring-stone-300">
          <Icon name="edit" size={18} /> Edit
        </button>
        <button onClick={onDelete} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-white font-semibold text-red-700 ring-1 ring-stone-300">
          <Icon name="trash" size={18} /> Delete
        </button>
      </div>
    </div>
  );
}

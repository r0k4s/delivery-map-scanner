import { useEffect, type ReactNode } from 'react';
import { COLORS, type ColorKey, type Template } from '../types';

const PATHS: Record<string, ReactNode> = {
  scan: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 8h7M7 12h10M7 16h5" />
    </>
  ),
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  nav: <path d="m3 11 19-9-9 19-2-8-8-2z" />,
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  fit: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  alert: <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  more: <path d="M12 6h.01M12 12h.01M12 18h.01" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  auto: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M21 3v6h-6" />
    </>
  ),
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  package: <path d="M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" />,
};

export function Icon({ name, size = 22, className = '', strokeWidth = 2 }: { name: keyof typeof PATHS | string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Sheet({ open, onClose, children, title, tall = false }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; tall?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade" onClick={onClose} />
      <div
        className={`relative bg-paper rounded-t-3xl shadow-2xl animate-up flex flex-col ${tall ? 'max-h-[94dvh]' : 'max-h-[85dvh]'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-2 px-5 pt-3 pb-2">
          <div className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-stone-300" />
          <div className="flex-1 pt-2 text-lg font-bold text-ink">{title}</div>
          <button onClick={onClose} className="mt-2 grid h-10 w-10 place-items-center rounded-full bg-stone-100 text-stone-600 active:bg-stone-200" aria-label="Close">
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function ColorPicker({ value, onChange, size = 'lg', nowrap = false }: { value: ColorKey; onChange: (c: ColorKey) => void; size?: 'lg' | 'sm'; nowrap?: boolean }) {
  const dim = size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <div className={`flex gap-2.5 ${nowrap ? 'w-max' : 'flex-wrap'}`} role="radiogroup" aria-label="Marker color">
      {COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          role="radio"
          aria-checked={value === c.key}
          aria-label={c.label}
          title={c.label}
          onClick={() => onChange(c.key)}
          className={`${dim} grid shrink-0 place-items-center rounded-full transition-transform active:scale-90 ${value === c.key ? 'ring-[3px] ring-ink ring-offset-2 ring-offset-paper' : ''}`}
          style={{ background: c.hex, color: c.ink }}
        >
          {value === c.key && <Icon name="check" size={size === 'lg' ? 22 : 16} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

export function TemplateChips({ templates, value, onChange, dark = false, nowrap = false }: { templates: Template[]; value: string | null; onChange: (id: string | null) => void; dark?: boolean; nowrap?: boolean }) {
  const base = dark ? 'bg-white/10 text-white' : 'bg-stone-100 text-stone-700';
  const active = dark ? 'bg-white text-ink' : 'bg-ink text-white';
  return (
    <div className={`flex gap-2 ${nowrap ? 'w-max' : 'flex-wrap'}`}>
      {templates.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(value === t.id ? null : t.id)}
          className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors ${value === t.id ? active : base}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-4 py-2">
      <div className="flex-1">
        <div className="font-semibold text-ink">{label}</div>
        {hint && <div className="text-sm text-stone-500">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-stone-300'}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`} />
      </button>
    </label>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel, extra }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; extra?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/50 animate-fade" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-3xl bg-paper p-6 shadow-2xl animate-pop" role="alertdialog" aria-modal="true">
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        <div className="mt-2 text-stone-600">{body}</div>
        {extra}
        <div className="mt-6 flex gap-3">
          <button onClick={onCancel} className="h-12 flex-1 rounded-2xl bg-stone-100 font-semibold text-stone-700">
            Cancel
          </button>
          <button onClick={onConfirm} className={`h-12 flex-1 rounded-2xl font-bold text-white ${danger ? 'bg-red-600' : 'bg-ink'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ColorDot({ hex, size = 14 }: { hex: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: hex }} />;
}

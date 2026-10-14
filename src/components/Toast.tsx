import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ToastOptions {
  message: ReactNode;
  sub?: ReactNode;
  tone?: 'success' | 'info' | 'warn' | 'error';
  actions?: ToastAction[];
  /** Extra content (e.g. quick color buttons). Interacting with it keeps the toast open. */
  body?: ReactNode;
  duration?: number;
  /** 'top' is used inside the scanner so the toast doesn't cover the shutter or the scan frame. */
  position?: 'top' | 'bottom';
}

interface ToastCtx {
  show: (t: ToastOptions) => void;
  dismiss: () => void;
}

const Ctx = createContext<ToastCtx>({ show: () => {}, dismiss: () => {} });

export function useToast() {
  return useContext(Ctx);
}

const TONE = {
  success: 'bg-emerald-600',
  info: 'bg-stone-700',
  warn: 'bg-amber-500',
  error: 'bg-red-600',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { key: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const arm = useCallback(
    (duration: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(dismiss, duration);
    },
    [dismiss],
  );

  const show = useCallback(
    (t: ToastOptions) => {
      setToast({ ...t, key: Date.now() });
      arm(t.duration ?? 5000);
    },
    [arm],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <Ctx.Provider value={{ show, dismiss }}>
      {children}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3"
          style={toast.position === 'top' ? { top: 'calc(env(safe-area-inset-top) + 68px)' } : { bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}
        >
          <div
            key={toast.key}
            className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl bg-ink text-white shadow-2xl animate-up"
            onPointerDown={() => arm((toast.duration ?? 5000) + 3000)}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3 p-4">
              <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${TONE[toast.tone ?? 'info']}`} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-snug">{toast.message}</div>
                {toast.sub && <div className="mt-0.5 text-sm text-white/70">{toast.sub}</div>}
              </div>
              {toast.actions?.map((a) => (
                <button
                  key={a.label}
                  onClick={() => {
                    a.onClick();
                    dismiss();
                  }}
                  className={`-my-1 min-h-10 shrink-0 rounded-xl px-3 text-sm font-bold ${a.primary ? 'bg-accent text-ink' : 'text-accent'}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {toast.body && <div className="border-t border-white/10 px-4 py-3">{toast.body}</div>}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

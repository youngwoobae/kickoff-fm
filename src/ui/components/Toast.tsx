import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  action?: { label: string; run: () => void };
}
interface ToastApi {
  show(text: string, kind?: ToastKind, action?: ToastItem['action']): void;
}

const ToastCtx = createContext<ToastApi>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>(
    (text, kind = 'info', action) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-2), { id, text, kind, action }]);
      setTimeout(() => dismiss(id), action ? 5000 : kind === 'error' ? 4500 : 2600);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

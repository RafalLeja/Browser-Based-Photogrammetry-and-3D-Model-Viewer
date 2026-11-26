// Small shared building blocks: toasts, dialogs, empty and error states, data loading hooks.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icon';

// ---------- Toasts ----------

interface Toast {
  id: number;
  text: string;
  icon: IconName;
}

const ToastContext = createContext<(text: string, icon?: IconName) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((text: string, icon: IconName = 'check') => {
    const id = ++next.current;
    setToasts((list) => [...list, { id, text, icon }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <Icon name={toast.icon} />
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Dialog ----------

/** A native <dialog>: focus is trapped and Escape closes it, with no extra code. */
export function Dialog({ open, onClose, children, label, wide }: { open: boolean; onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog-wide' : 'dialog'}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // A click on the backdrop closes it.
      }}
    >
      {open ? <div className="dialog-body">{children}</div> : null}
    </dialog>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} label={props.title}>
      <h2>{props.title}</h2>
      <p className="muted">{props.body}</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className={`btn ${props.danger ? 'btn-danger' : ''}`} onClick={props.onConfirm} disabled={props.busy}>
          {props.confirm}
        </button>
      </div>
    </Dialog>
  );
}

// ---------- States ----------

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="alert"
      title="Something went wrong"
      action={
        onRetry ? (
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            <Icon name="refresh" /> Try again
          </button>
        ) : undefined
      }
    >
      {error.message}
    </EmptyState>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const icon: IconName = kind === 'info' ? 'info' : 'alert';
  return (
    <div className={`notice notice-${kind}`} role={kind === 'danger' ? 'alert' : undefined}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

// ---------- Hooks ----------

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
  setData: (update: T | ((current: T | undefined) => T)) => void;
}

/** Runs `load` when `deps` change; a newer run discards the result of an older one. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(undefined);
    load().then(
      (value) => {
        if (!current) return;
        setData(value);
        setLoading(false);
      },
      (err: unknown) => {
        if (!current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists the inputs of `load`
  }, [...deps, nonce]);

  return {
    data,
    error,
    loading,
    reload: useCallback(() => setNonce((n) => n + 1), []),
    setData: setData as AsyncState<T>['setData'],
  };
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Vitrine` : 'Vitrine: photos in, 3D out';
  }, [title]);
}

let revealObserver: IntersectionObserver | null = null;

/**
 * Fades elements with the `reveal` class in as they scroll into view. One observer serves the
 * whole app; each render only adds the elements that appeared since. Content is never hidden without JS.
 */
export function useReveal(): void {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    revealObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = 'shown';
          revealObserver?.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    for (const element of document.querySelectorAll<HTMLElement>('.reveal:not([data-reveal])')) {
      if (element.getBoundingClientRect().top < innerHeight) {
        element.dataset.reveal = 'none'; // Already on screen: leave it alone.
        continue;
      }
      element.dataset.reveal = 'pending';
      revealObserver.observe(element);
    }
  });
}

export function useInterval(callback: () => void, ms: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

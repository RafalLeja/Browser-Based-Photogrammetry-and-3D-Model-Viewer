// React wrapper around the viewer: creates it once, loads the model when the URL changes,
// and shows loading progress and errors over the canvas.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createViewer } from '../index';
import type { EnvironmentOptions, ModelInfo, Vec3, Viewer } from '../index';
import { isAbortError } from '../loading';
import { formatBytes } from '../lib/format';
import { Icon } from './icon';

interface Props {
  url: string | null;
  format?: 'gltf' | 'ply';
  up?: Vec3 | null;
  trueScale?: boolean;
  label: string;
  environment?: EnvironmentOptions;
  autoRotate?: boolean;
  /** For a model inside a longer page: plain scrolling moves the page, Ctrl/⌘ + scroll zooms. */
  cooperative?: boolean;
  onViewer?: (viewer: Viewer | null) => void;
  onLoaded?: (info: ModelInfo) => void;
  children?: ReactNode;
}

type StageState =
  | { kind: 'starting' }
  | { kind: 'loading'; loaded: number; total: number | null }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function ModelStage({ url, format, up, trueScale, label, environment, autoRotate, cooperative, onViewer, onLoaded, children }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [state, setState] = useState<StageState>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  // Kept in refs so changing callbacks never recreate the viewer.
  const callbacks = useRef({ onViewer, onLoaded });
  callbacks.current = { onViewer, onLoaded };
  const initial = useRef({ environment, label, cooperative });
  const [zoomHint, setZoomHint] = useState(false);
  const hintTimer = useRef(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let created: Viewer | null = null;
    createViewer(element, {
      environment: initial.current.environment ?? { preset: 'studio' },
      decoderPath: `${import.meta.env.BASE_URL}decoders/`,
      label: initial.current.label,
      cooperativeGestures: initial.current.cooperative,
      forceWebGL: new URLSearchParams(location.search).has('webgl'),
    }).then(
      (instance) => {
        // React StrictMode mounts twice in development: the first viewer is thrown away.
        if (disposed) {
          instance.dispose();
          return;
        }
        created = instance;
        setViewer(instance);
        callbacks.current.onViewer?.(instance);
      },
      (error: unknown) => {
        if (disposed) return;
        const reason = error instanceof Error ? error.message : String(error);
        setState({ kind: 'error', message: `This browser cannot show 3D graphics (${reason}). Try a current Chrome, Edge, Firefox or Safari.` });
      },
    );
    return () => {
      disposed = true;
      created?.dispose();
      callbacks.current.onViewer?.(null);
    };
  }, []);

  // Compared by value: a new array with the same numbers must not reload the model.
  const upKey = up ? up.join(',') : '';
  useEffect(() => {
    if (!viewer || !url) return;
    const upVector = upKey ? (upKey.split(',').map(Number) as Vec3) : undefined;
    setState({ kind: 'loading', loaded: 0, total: null });
    const offProgress = viewer.on('progress', ({ loaded, total }) => setState({ kind: 'loading', loaded, total }));
    viewer.load(url, { format, up: upVector, trueScale }).then(
      (info) => {
        setState({ kind: 'ready' });
        callbacks.current.onLoaded?.(info);
      },
      (error: unknown) => {
        if (isAbortError(error)) return; // Replaced by a newer load.
        setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
    return offProgress;
  }, [viewer, url, format, upKey, trueScale, attempt]);

  useEffect(() => {
    viewer?.setAutoRotate(Boolean(autoRotate));
  }, [viewer, autoRotate]);

  // A plain scroll over a cooperative stage moves the page; this says how to zoom instead.
  useEffect(() => {
    const element = host.current;
    if (!cooperative || !element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      setZoomHint(true);
      clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setZoomHint(false), 1400);
    };
    element.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      element.removeEventListener('wheel', onWheel);
      clearTimeout(hintTimer.current);
    };
  }, [cooperative]);

  const percent = state.kind === 'loading' && state.total ? Math.round((state.loaded / state.total) * 100) : null;

  return (
    <>
      <div ref={host} className="stage-canvas" />
      {state.kind === 'starting' || state.kind === 'loading' ? (
        <div className="stage-loading" role="status" aria-live="polite">
          <div
            className="ring"
            data-indeterminate={percent === null || undefined}
            style={{ ['--p' as string]: percent ?? 0 }}
          />
          <span>
            {state.kind === 'starting'
              ? 'Starting the 3D view…'
              : percent !== null
                ? `Loading model · ${percent}%`
                : `Loading model${state.loaded ? ` · ${formatBytes(state.loaded)}` : '…'}`}
          </span>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="stage-loading" role="alert">
          <Icon name="alert" className="brand-mark" />
          <p className="stage-error">{state.message}</p>
          {viewer ? (
            <button type="button" className="btn btn-sm btn-ghost glass" onClick={() => setAttempt((n) => n + 1)}>
              <Icon name="refresh" /> Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {cooperative ? (
        <div className="zoom-hint glass glass-pill" data-shown={zoomHint || undefined} aria-hidden="true">
          {IS_MAC ? '⌘' : 'Ctrl'} + scroll to zoom
        </div>
      ) : null}
      {children}
    </>
  );
}

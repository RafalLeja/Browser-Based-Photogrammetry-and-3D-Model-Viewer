// The object page: the 3D stage with its tool dock, and a side panel with the object's details,
// notes, measurements, lighting and inspection tools. It talks to the viewer only through its
// public API.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Annotation, type SharedViewState } from '../api';
import { useAuth } from '../auth';
import type { EnvironmentOptions, Measurement, ModelInfo, Pin, RenderMode, SectionAxis, Tool, Viewer } from '../index';
import { Icon, type IconName } from '../components/icon';
import { ModelStage } from '../components/model-stage';
import { ConfirmDialog, Dialog, EmptyState, ErrorState, useAsync, useDocumentTitle, useInterval, useToast } from '../components/ui';
import { escapeHtml, formatCount } from '../lib/format';
import { DEFAULT_LIGHT, lightDirection, sharedLight, type LightState } from '../lib/light';
import { citation } from '../lib/museum';
import {
  EditObjectDialog,
  InspectPanel,
  LightPanel,
  MeasurePanel,
  NotesPanel,
  OverviewPanel,
  RENDER_MODES,
  type DraftPin,
  type ExportFormat,
  type NoteFilter,
} from './object-panels';

const STUDIO_HDR = `${import.meta.env.BASE_URL}hdr/studio_small_09_1k.hdr`;
const TOUR_STEP_MS = 4500;
const SWEEP_MS = 9000;
type Tab = 'overview' | 'notes' | 'measure' | 'light' | 'inspect';

export function environmentOptions(light: LightState): EnvironmentOptions {
  if (light.environment === 'studio') return { hdrUrl: STUDIO_HDR, showBackground: light.background };
  return { preset: light.environment, showBackground: false };
}

export function applyLight(viewer: Viewer, light: LightState, previous: LightState | null): void {
  if (!previous || previous.environment !== light.environment || previous.background !== light.background) {
    viewer.setEnvironment(environmentOptions(light)).catch(() => undefined); // Failures surface as viewer errors.
  }
  viewer.setLighting({
    exposure: light.exposure,
    keyLight: { intensity: light.intensity, direction: lightDirection(light.azimuth, light.elevation) },
    groundShadow: { opacity: light.shadow },
  });
}

export function toPin(annotation: Annotation): Pin {
  return {
    id: String(annotation.id),
    position: annotation.position,
    normal: annotation.normal,
    title: annotation.title,
    text: annotation.text,
    kind: annotation.category,
  };
}

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function DockButton(props: { icon: IconName; label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; shortcut?: string }) {
  const title = props.shortcut ? `${props.label} (${props.shortcut})` : props.label;
  return (
    <button
      type="button"
      className="dock-btn"
      aria-label={props.label}
      title={title}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

const SHORTCUTS: [string, string][] = [
  ['M', 'Measure a distance'],
  ['N', 'Add a note (curators)'],
  ['S', 'Section plane on or off'],
  ['D', 'Overall dimensions on or off'],
  ['1 – 4', 'Colour, clay, wireframe, normals'],
  ['R', 'Reset the view'],
  ['F', 'Full screen'],
  ['Arrow keys', 'Pan, with the 3D view focused'],
  ['Shift + arrows', 'Turn the model'],
  ['Esc', 'Stop the current tool'],
  ['?', 'This list'],
];

export function ViewerPage() {
  const { id } = useParams();
  const objectId = Number(id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const curator = Boolean(user);

  const object = useAsync(() => api.object(objectId), [objectId, user?.id]);
  const annotations = useAsync(() => api.annotations(objectId), [objectId]);
  useDocumentTitle(object.data?.title ?? 'Object');

  const stageRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [tool, setToolState] = useState<Tool>('orbit');
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('all');
  const [light, setLight] = useState<LightState>(DEFAULT_LIGHT);
  const [sweeping, setSweeping] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>('standard');
  const [dimensions, setDimensions] = useState(false);
  const [section, setSection] = useState({ enabled: false, axis: 'y' as SectionAxis, position: 0.5, flip: false });
  const [dialog, setDialog] = useState<'share' | 'cite' | 'edit' | 'shortcuts' | null>(null);
  const [shareLink, setShareLink] = useState<{ url: string; embed: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'object' } | { kind: 'note'; id: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  // The stage starts with the default environment, so only a change needs a new one.
  const appliedLight = useRef<LightState | null>(DEFAULT_LIGHT);
  const coverAttempted = useRef(false);

  const pins = useMemo(() => {
    const list = (annotations.data ?? []).filter((a) => noteFilter === 'all' || a.category === noteFilter).map(toPin);
    if (draft) list.push({ id: 'draft', position: draft.position, normal: draft.normal, title: 'New note' });
    return list;
  }, [annotations.data, draft, noteFilter]);

  // ----- viewer wiring -----

  useEffect(() => {
    if (!viewer) return;
    const offs = [
      viewer.on('measurements-change', ({ measurements: list }) => setMeasurements(list)),
      viewer.on('tool-change', ({ tool: next }) => setToolState(next)),
      viewer.on('pin-click', ({ id: pinId }) => {
        if (pinId === 'draft') return;
        setActivePin(pinId);
        setTab('notes');
        viewer.focusPin(pinId);
      }),
      viewer.on('pin-place', ({ position, normal }) => {
        setDraft({ position, normal });
        setTab('notes');
        viewer.setTool('orbit');
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [viewer]);

  useEffect(() => {
    if (viewer && info) viewer.setPins(pins);
  }, [viewer, info, pins]);

  useEffect(() => {
    if (!viewer) return;
    applyLight(viewer, light, appliedLight.current);
    appliedLight.current = light;
  }, [viewer, light]);

  useEffect(() => {
    if (viewer && info) viewer.setSection(section);
  }, [viewer, info, section]);

  useEffect(() => {
    viewer?.setActivePin(activePin);
  }, [viewer, activePin]);

  useEffect(() => {
    if (viewer && info) viewer.setRenderMode(renderMode);
  }, [viewer, info, renderMode]);

  useEffect(() => {
    if (viewer && info) viewer.setDimensions(dimensions);
  }, [viewer, info, dimensions]);

  // A visitor opening a published object counts as a visit (the server ignores curators and repeats).
  const ready = object.data?.status === 'ready';
  useEffect(() => {
    if (ready) api.visit(objectId).catch(() => undefined);
  }, [ready, objectId]);

  // A shared link (?view=…) restores the camera and lighting once the model is in place.
  const viewId = params.get('view');
  useEffect(() => {
    if (!viewer || !info || !viewId) return;
    let current = true;
    api.view(viewId).then(
      ({ state }) => {
        if (!current) return;
        viewer.setView({ position: state.position, target: state.target }, { animate: false });
        setLight((l) => sharedLight(state, l));
      },
      () => toast('That shared view no longer exists.', 'alert'),
    );
    return () => {
      current = false;
    };
  }, [viewer, info, viewId, toast]);

  // The first time a curator opens an object without a cover, the opening view becomes its cover.
  const hasCover = Boolean(object.data?.thumbnail_url);
  const setObjectData = object.setData;
  useEffect(() => {
    if (!viewer || !info || !curator || hasCover || coverAttempted.current) return;
    const timer = setTimeout(() => {
      coverAttempted.current = true;
      viewer
        .screenshot({ maxSize: 1200, fit: 'subject' })
        .then((image) => api.setThumbnail(objectId, image))
        .then((updated) => setObjectData(updated))
        .catch(() => undefined); // A missing cover is cosmetic; the curator can set one by hand.
    }, 1200);
    return () => clearTimeout(timer);
  }, [viewer, info, curator, hasCover, objectId, setObjectData]);

  // Raking light sweep: the light circles the object once, like a conservator moving a lamp.
  useEffect(() => {
    if (!sweeping) return;
    const start = performance.now();
    const from = light.azimuth;
    if (prefersReducedMotion()) {
      let step = 0;
      const timer = setInterval(() => {
        step++;
        setLight((l) => ({ ...l, azimuth: (from + step * 45) % 360 }));
        if (step >= 8) setSweeping(false);
      }, 900);
      return () => clearInterval(timer);
    }
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / SWEEP_MS);
      setLight((l) => ({ ...l, azimuth: Math.round(from + t * 360) % 360 }));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setSweeping(false);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts from the azimuth at the moment the sweep begins
  }, [sweeping]);

  const setTool = useCallback(
    (next: Tool) => {
      viewer?.setTool(next);
      setToolState(next);
      if (next === 'measure') setTab('measure');
      if (next === 'annotate') setTab('notes');
    },
    [viewer],
  );

  // ----- guided tour -----

  const noteCount = annotations.data?.length ?? 0;
  useInterval(
    () => {
      if (tourIndex === null || !annotations.data || !viewer) return;
      const next = tourIndex + 1;
      if (next >= annotations.data.length) {
        setTourIndex(null);
        return;
      }
      setTourIndex(next);
    },
    tourIndex === null ? null : TOUR_STEP_MS,
  );
  useEffect(() => {
    if (tourIndex === null || !annotations.data || !viewer) return;
    const pinId = String(annotations.data[tourIndex].id);
    setNoteFilter('all');
    setActivePin(pinId);
    viewer.focusPin(pinId);
  }, [tourIndex, annotations.data, viewer]);

  // ----- keyboard shortcuts -----

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, [contenteditable], dialog')) return;
      const key = event.key.toLowerCase();
      if (key === 'm') setTool(tool === 'measure' ? 'orbit' : 'measure');
      else if (key === 'n' && curator) setTool(tool === 'annotate' ? 'orbit' : 'annotate');
      else if (key === 'r') viewer?.resetView();
      else if (key === 'f') toggleFullscreen();
      else if (key === 's') setSection((s) => ({ ...s, enabled: !s.enabled }));
      else if (key === 'd') setDimensions((on) => !on);
      else if (key === '?') setDialog('shortcuts');
      else if (['1', '2', '3', '4'].includes(key)) setRenderMode(RENDER_MODES[Number(key) - 1].mode);
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.();
  }

  // ----- actions -----

  function save(blob: Blob, extension: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(object.data?.title ?? 'model').replace(/[^\w-]+/g, '-').toLowerCase()}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function saveImage() {
    if (!viewer) return;
    save(await viewer.screenshot({ type: 'image/png' }), 'png');
  }

  async function exportModel(format: ExportFormat) {
    if (!viewer || !object.data) return;
    setExporting(format);
    try {
      // 3D printers read STL coordinates as millimetres; a true-to-scale model is in metres.
      const scale = format === 'stl' && object.data.dimensions_mm ? 1000 : 1;
      save(await viewer.exportModel(format, { scale }), format);
    } catch (err) {
      toast(err instanceof Error ? err.message.replace('[viewer] ', '') : 'Export failed', 'alert');
    } finally {
      setExporting(null);
    }
  }

  async function setCover() {
    if (!viewer) return;
    try {
      const updated = await api.setThumbnail(objectId, await viewer.screenshot({ maxSize: 1200, fit: 'subject' }));
      object.setData(updated);
      toast('Cover image updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not set the cover', 'alert');
    }
  }

  async function openShare() {
    if (!viewer) return;
    setDialog('share');
    setShareLink(null);
    const state: SharedViewState = {
      ...viewer.getView(),
      environment: light.environment,
      exposure: light.exposure,
      light_intensity: light.intensity,
      light_direction: lightDirection(light.azimuth, light.elevation),
      background: light.background,
    };
    try {
      const view = await api.createView(objectId, state);
      const origin = location.origin;
      setShareLink({
        url: `${origin}/objects/${objectId}?view=${view.id}`,
        embed: `<iframe src="${origin}/embed/${objectId}?view=${view.id}" title="${escapeHtml(object.data?.title ?? '3D model')}" width="800" height="600" style="border:0;border-radius:12px" allow="fullscreen" loading="lazy"></iframe>`,
      });
    } catch (err) {
      setDialog(null);
      toast(err instanceof Error ? err.message : 'Could not create the link', 'alert');
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast('Copy is blocked here; select the text instead.', 'alert');
    }
  }

  async function deleteConfirmed() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'object') {
        await api.deleteObject(objectId);
        toast('Object deleted');
        navigate('/collection');
      } else {
        await api.deleteAnnotation(confirm.id);
        annotations.setData((list) => (list ?? []).filter((a) => a.id !== confirm.id));
        if (activePin === String(confirm.id)) setActivePin(null);
        toast('Note deleted');
      }
      setConfirm(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'alert');
    } finally {
      setBusy(false);
    }
  }

  // ----- render -----

  if (object.error) {
    return (
      <div className="page container">
        {(object.error as { status?: number }).status === 404 ? (
          <EmptyState icon="search" title="Object not found" action={<Link to="/collection" className="btn">Back to the collection</Link>}>
            It may have been removed, or it is not published yet.
          </EmptyState>
        ) : (
          <ErrorState error={object.error} onRetry={object.reload} />
        )}
      </div>
    );
  }

  const data = object.data;
  const trueScale = Boolean(data?.dimensions_mm);
  const hint =
    tool === 'measure' ? 'Click two points on the model · Esc to stop' : tool === 'annotate' ? 'Click the surface to place a note · Esc to stop' : null;
  const cite = data ? citation(data, `${location.origin}/objects/${data.id}`) : null;

  return (
    <div className="object-layout">
      <section className="stage" ref={stageRef} aria-label="3D view">
        {data && data.model_url ? (
          <ModelStage
            url={data.model_url}
            format={data.model_format}
            up={data.up}
            trueScale={trueScale}
            label={data.alt_text ? `3D view of ${data.title}: ${data.alt_text}` : `3D view of ${data.title}`}
            environment={environmentOptions(DEFAULT_LIGHT)}
            autoRotate={autoRotate}
            onViewer={setViewer}
            onLoaded={setInfo}
          />
        ) : data ? (
          <div className="stage-loading">
            <p>This object has no model yet.</p>
            {data.job_id ? (
              <Link to={`/jobs/${data.job_id}`} className="btn btn-sm">
                View reconstruction
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="stage-loading">
            <div className="ring" data-indeterminate />
          </div>
        )}

        <div className="stage-top">
          <Link to="/collection" className="glass glass-pill">
            <Icon name="chevronLeft" /> Collection
          </Link>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {data?.is_demo ? <span className="glass glass-pill">Demo reconstruction</span> : null}
            {viewer && info ? (
              <span className="glass glass-pill stage-chip" title="Graphics backend and triangle count">
                <Icon name="chip" /> {viewer.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'} · {formatCount(info.triangles)} △
              </span>
            ) : null}
            {data?.model_url ? (
              <>
                <Link to={`/compare?a=${objectId}`} className="glass glass-pill" title="Compare with another object">
                  <Icon name="columns" /> <span className="pill-label">Compare</span>
                </Link>
                <Link to={`/kiosk?ids=${objectId}`} className="glass glass-pill" title="Present full screen, for a gallery screen or a lecture">
                  <Icon name="monitor" /> <span className="pill-label">Present</span>
                </Link>
              </>
            ) : null}
          </div>
        </div>

        {hint ? (
          <div className="glass glass-pill stage-hint" role="status">
            {hint}
          </div>
        ) : null}

        {section.enabled ? (
          <div className="glass section-panel" role="group" aria-label="Section plane">
            <div className="row row-between">
              <strong>Section</strong>
              <div className="segmented" role="group" aria-label="Axis">
                {(['x', 'y', 'z'] as SectionAxis[]).map((axis) => (
                  <button key={axis} type="button" aria-pressed={section.axis === axis} onClick={() => setSection((s) => ({ ...s, axis }))}>
                    {axis.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <label className="visually-hidden" htmlFor="section-position">
              Cut position
            </label>
            <input
              id="section-position"
              className="range"
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={section.position}
              onChange={(event) => setSection((s) => ({ ...s, position: Number(event.target.value) }))}
            />
            <label className="switch" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={section.flip} onChange={(event) => setSection((s) => ({ ...s, flip: event.target.checked }))} />
              Keep the other side
            </label>
          </div>
        ) : null}

        <div className="glass dock" role="toolbar" aria-label="Viewer tools">
          <DockButton icon="orbit" label="Orbit" pressed={tool === 'orbit'} onClick={() => setTool('orbit')} disabled={!info} />
          <DockButton icon="ruler" label="Measure" shortcut="M" pressed={tool === 'measure'} onClick={() => setTool(tool === 'measure' ? 'orbit' : 'measure')} disabled={!info} />
          {curator ? (
            <DockButton icon="pin" label="Add note" shortcut="N" pressed={tool === 'annotate'} onClick={() => setTool(tool === 'annotate' ? 'orbit' : 'annotate')} disabled={!info} />
          ) : null}
          <DockButton icon="section" label="Section" shortcut="S" pressed={section.enabled} onClick={() => setSection((s) => ({ ...s, enabled: !s.enabled }))} disabled={!info} />
          <DockButton icon="box" label="Dimensions" shortcut="D" pressed={dimensions} onClick={() => setDimensions((on) => !on)} disabled={!info} />
          <span className="dock-divider" />
          <DockButton icon="reset" label="Reset view" shortcut="R" onClick={() => viewer?.resetView()} disabled={!info} />
          <DockButton icon="plus" label="Zoom in" onClick={() => viewer?.zoom(0.8)} disabled={!info} />
          <DockButton icon="minus" label="Zoom out" onClick={() => viewer?.zoom(1.25)} disabled={!info} />
          <DockButton icon={autoRotate ? 'pause' : 'play'} label={autoRotate ? 'Stop turning' : 'Turn slowly'} pressed={autoRotate} onClick={() => setAutoRotate((v) => !v)} disabled={!info} />
          <span className="dock-divider" />
          <DockButton icon="camera" label="Save image" onClick={() => void saveImage()} disabled={!info} />
          <DockButton icon="share" label="Share this view" onClick={() => void openShare()} disabled={!info} />
          <DockButton icon="maximize" label="Full screen" shortcut="F" onClick={toggleFullscreen} />
          <DockButton icon="keyboard" label="Keyboard shortcuts" shortcut="?" onClick={() => setDialog('shortcuts')} />
        </div>
      </section>

      <aside className="panel" aria-label="Object details">
        <div className="panel-head">
          {data ? (
            <>
              {data.record.accession_number ? <p className="eyebrow panel-eyebrow">{data.record.accession_number}</p> : null}
              <h1 className="panel-title">{data.title}</h1>
            </>
          ) : (
            <div className="skeleton" style={{ height: 32, width: '70%' }} />
          )}
        </div>
        <div className="tabs" role="tablist" aria-label="Panels">
          {(
            [
              ['overview', 'Overview', null],
              ['notes', 'Notes', noteCount],
              ['measure', 'Measure', measurements.length || null],
              ['light', 'Light', null],
              ['inspect', 'Inspect', null],
            ] as [Tab, string, number | null][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`tab-${key}`}
              className="tab"
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              onClick={() => setTab(key)}
            >
              {label}
              {count ? <span className="count">{count}</span> : null}
            </button>
          ))}
        </div>
        <div className="panel-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {!data ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : tab === 'overview' ? (
            <OverviewPanel
              object={data}
              info={info}
              curator={curator}
              exporting={exporting}
              onEdit={() => setDialog('edit')}
              onCover={() => void setCover()}
              onDelete={() => setConfirm({ kind: 'object' })}
              onCite={() => setDialog('cite')}
              onExport={(format) => void exportModel(format)}
            />
          ) : tab === 'notes' ? (
            <NotesPanel
              annotations={annotations.data ?? []}
              activeId={activePin}
              curator={curator}
              placing={tool === 'annotate'}
              draft={draft}
              touring={tourIndex !== null}
              filter={noteFilter}
              onFilter={setNoteFilter}
              onSelect={(pinId) => {
                setTourIndex(null);
                setActivePin(pinId);
                viewer?.focusPin(pinId);
              }}
              onStartPlacing={() => setTool('annotate')}
              onSaveDraft={async (note) => {
                if (!draft) return;
                const created = await api.createAnnotation(objectId, { ...draft, ...note });
                annotations.setData((list) => [...(list ?? []), created]);
                setDraft(null);
                setNoteFilter((filter) => (filter === 'all' || filter === created.category ? filter : 'all'));
                setActivePin(String(created.id));
                toast('Note added');
              }}
              onCancelDraft={() => setDraft(null)}
              onUpdate={async (noteId, note) => {
                const updated = await api.updateAnnotation(noteId, note);
                annotations.setData((list) => (list ?? []).map((a) => (a.id === noteId ? updated : a)));
              }}
              onDelete={(noteId) => setConfirm({ kind: 'note', id: noteId })}
              onTour={() => setTourIndex((index) => (index === null ? 0 : null))}
              onReport={() => navigate(`/objects/${objectId}/report`)}
            />
          ) : tab === 'measure' ? (
            <MeasurePanel
              measurements={measurements}
              active={tool === 'measure'}
              trueScale={trueScale}
              onStart={() => setTool(tool === 'measure' ? 'orbit' : 'measure')}
              onUndo={() => viewer?.undoMeasurement()}
              onClear={() => viewer?.clearMeasurements()}
            />
          ) : tab === 'light' ? (
            <LightPanel
              light={light}
              autoRotate={autoRotate}
              sweeping={sweeping}
              onChange={(next) => {
                setSweeping(false);
                setLight(next);
              }}
              onAutoRotate={setAutoRotate}
              onSweep={() => setSweeping((on) => !on)}
            />
          ) : (
            <InspectPanel
              object={data}
              info={info}
              backend={viewer?.backend ?? null}
              renderMode={renderMode}
              dimensions={dimensions}
              trueScale={trueScale}
              onRenderMode={setRenderMode}
              onDimensions={setDimensions}
            />
          )}
        </div>
      </aside>

      <Dialog open={dialog === 'share'} onClose={() => setDialog(null)} label="Share this view">
        <h2>Share this view</h2>
        <p className="muted">The link opens the model with this camera angle and lighting.</p>
        {shareLink ? (
          <>
            <div className="field">
              <span className="label">Link</span>
              <div className="code-box">
                <code>{shareLink.url}</code>
                <button type="button" className="btn btn-sm" onClick={() => void copy(shareLink.url, 'Link')}>
                  <Icon name="copy" /> Copy
                </button>
              </div>
            </div>
            <div className="field">
              <span className="label">Embed on a website</span>
              <div className="code-box">
                <code>{shareLink.embed}</code>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy(shareLink.embed, 'Embed code')}>
                  <Icon name="copy" /> Copy
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="spinner" aria-label="Creating link" />
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
            Done
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'cite'} onClose={() => setDialog(null)} label="Cite this object">
        <h2>Cite this object</h2>
        <p className="muted">For papers, theses and teaching material. The link always opens this object.</p>
        {cite ? (
          <>
            <div className="field">
              <span className="label">Reference</span>
              <div className="code-box">
                <code>{cite.text}</code>
                <button type="button" className="btn btn-sm" onClick={() => void copy(cite.text, 'Reference')}>
                  <Icon name="copy" /> Copy
                </button>
              </div>
            </div>
            <div className="field">
              <span className="label">BibTeX</span>
              <div className="code-box">
                <code style={{ whiteSpace: 'pre-wrap' }}>{cite.bibtex}</code>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy(cite.bibtex, 'BibTeX')}>
                  <Icon name="copy" /> Copy
                </button>
              </div>
            </div>
          </>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
            Done
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>
            Done
          </button>
        </div>
      </Dialog>

      {data && dialog === 'edit' ? (
        // Mounted only while open: it starts from the current details, and a background update
        // (such as the automatic cover) cannot reset what the curator is typing.
        <EditObjectDialog
          object={data}
          open
          onClose={() => setDialog(null)}
          onSave={async (patch) => {
            object.setData(await api.updateObject(objectId, patch));
            toast('Details saved');
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'object' ? 'Delete this object?' : 'Delete this note?'}
        body={
          confirm?.kind === 'object'
            ? 'The object, its photos, model, notes and shared links are removed for everyone. This cannot be undone.'
            : 'The note is removed for everyone. This cannot be undone.'
        }
        confirm="Delete"
        danger
        busy={busy}
        onConfirm={() => void deleteConfirmed()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

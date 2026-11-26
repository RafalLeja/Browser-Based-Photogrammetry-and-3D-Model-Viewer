// The side panels of the object page. Each one receives plain data and callbacks; the page owns
// the viewer and the API calls.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Annotation, CollectionObject, EnvironmentName } from '../api';
import { formatLength } from '../index';
import type { Measurement, ModelInfo, RendererBackend } from '../index';
import { Icon } from '../components/icon';
import { Notice } from '../components/ui';
import { formatBytes, formatCount, formatDimensions, formatRelative } from '../lib/format';

// ---------- Overview ----------

export function OverviewPanel(props: {
  object: CollectionObject;
  info: ModelInfo | null;
  backend: RendererBackend | null;
  curator: boolean;
  onSave: (patch: { title: string; description: string; tags: string[] }) => Promise<void>;
  onCover: () => void;
  onDelete: () => void;
}) {
  const { object, info, curator } = props;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await props.onSave({
        title: String(data.get('title') ?? ''),
        description: String(data.get('description') ?? ''),
        tags: String(data.get('tags') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form className="group" onSubmit={submit}>
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input id="edit-title" name="title" className="input" defaultValue={object.title} required maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="edit-description">Description</label>
          <textarea id="edit-description" name="description" className="textarea" defaultValue={object.description} maxLength={4000} rows={6} />
        </div>
        <div className="field">
          <label htmlFor="edit-tags">Tags</label>
          <input id="edit-tags" name="tags" className="input" defaultValue={object.tags.join(', ')} />
          <span className="hint">Separate tags with commas.</span>
        </div>
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <div className="row">
          <button type="submit" className="btn btn-sm" disabled={busy}>
            Save changes
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const size = info ? info.size : null;
  return (
    <>
      {object.is_demo ? (
        <Notice kind="warning">
          <strong>Demo reconstruction.</strong> This server has no CUDA GPU, so the demo pipeline published a sample scan instead of a model built from the uploaded photos.
        </Notice>
      ) : null}
      {object.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{object.description}</p> : <p className="muted">No description yet.</p>}
      {object.tags.length ? (
        <div className="chips">
          {object.tags.map((tag) => (
            <Link key={tag} to={`/collection?tag=${encodeURIComponent(tag)}`} className="tag">
              {tag}
            </Link>
          ))}
        </div>
      ) : null}
      <dl className="facts">
        <div className="fact">
          <dt>Real size</dt>
          <dd>{formatDimensions(object.dimensions_mm)}</dd>
        </div>
        <div className="fact">
          <dt>Triangles</dt>
          <dd>{formatCount(info?.triangles ?? object.triangles)}</dd>
        </div>
        <div className="fact">
          <dt>File size</dt>
          <dd>{formatBytes(object.file_size)}</dd>
        </div>
        <div className="fact">
          <dt>Format</dt>
          <dd>{object.model_format === 'ply' ? 'PLY (raw)' : 'glTF binary'}</dd>
        </div>
        <div className="fact">
          <dt>Bounding box</dt>
          <dd>{size ? size.map((v) => v.toFixed(2)).join(' × ') : '–'}</dd>
        </div>
        <div className="fact">
          <dt>Renderer</dt>
          <dd>{props.backend === 'webgpu' ? 'WebGPU' : props.backend === 'webgl2' ? 'WebGL 2' : '–'}</dd>
        </div>
        <div className="fact">
          <dt>Added</dt>
          <dd>{formatRelative(object.created_at)}</dd>
        </div>
        <div className="fact">
          <dt>Notes</dt>
          <dd>{object.annotation_count}</dd>
        </div>
      </dl>
      {curator ? (
        <div className="group">
          <h3 className="group-title">Curator</h3>
          <div className="row">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
              <Icon name="pencil" /> Edit details
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={props.onCover}>
              <Icon name="image" /> Use view as cover
            </button>
            {object.job_id ? (
              <Link to={`/jobs/${object.job_id}`} className="btn btn-sm btn-ghost">
                <Icon name="layers" /> Reconstruction job
              </Link>
            ) : null}
            <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={props.onDelete}>
              <Icon name="trash" /> Delete
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------- Notes ----------

export interface DraftPin {
  position: [number, number, number];
  normal: [number, number, number];
}

export function NotesPanel(props: {
  annotations: Annotation[];
  activeId: string | null;
  curator: boolean;
  placing: boolean;
  draft: DraftPin | null;
  touring: boolean;
  onSelect: (id: string) => void;
  onStartPlacing: () => void;
  onSaveDraft: (title: string, text: string) => Promise<void>;
  onCancelDraft: () => void;
  onUpdate: (id: number, title: string, text: string) => Promise<void>;
  onDelete: (id: number) => void;
  onTour: () => void;
}) {
  const { annotations, activeId, curator, draft } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!activeId) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  async function run(event: FormEvent<HTMLFormElement>, action: (title: string, text: string) => Promise<void>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await action(String(data.get('title') ?? ''), String(data.get('text') ?? ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row row-between">
        <p className="muted" style={{ fontSize: 14 }}>
          {annotations.length ? `${annotations.length} ${annotations.length === 1 ? 'note' : 'notes'} on this object` : 'No notes yet.'}
        </p>
        <div className="row">
          {annotations.length > 1 ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={props.onTour}>
              <Icon name={props.touring ? 'pause' : 'play'} /> {props.touring ? 'Stop tour' : 'Tour'}
            </button>
          ) : null}
          {curator && !draft ? (
            <button type="button" className="btn btn-sm" onClick={props.onStartPlacing} aria-pressed={props.placing}>
              <Icon name="plus" /> Add note
            </button>
          ) : null}
        </div>
      </div>

      {props.placing && !draft ? <Notice>Click the model where the note belongs. Press Escape to stop.</Notice> : null}

      {draft ? (
        <form className="card-panel" style={{ padding: 20, gap: 14 }} onSubmit={(event) => run(event, props.onSaveDraft)}>
          <strong>New note</strong>
          <div className="field">
            <label htmlFor="note-title">Title</label>
            <input id="note-title" name="title" className="input" required maxLength={80} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="note-text">Note</label>
            <textarea id="note-text" name="text" className="textarea" maxLength={2000} rows={4} />
          </div>
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <div className="row">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              Save note
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={props.onCancelDraft}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <ol className="list" ref={listRef}>
        {annotations.map((annotation, index) => {
          const id = String(annotation.id);
          if (editingId === annotation.id) {
            return (
              <li key={id} className="list-item" style={{ display: 'block' }}>
                <form
                  className="group"
                  onSubmit={(event) =>
                    run(event, async (title, text) => {
                      await props.onUpdate(annotation.id, title, text);
                      setEditingId(null);
                    })
                  }
                >
                  <input name="title" className="input" defaultValue={annotation.title} required maxLength={80} aria-label="Title" />
                  <textarea name="text" className="textarea" defaultValue={annotation.text} maxLength={2000} rows={3} aria-label="Note" />
                  {error ? <Notice kind="danger">{error}</Notice> : null}
                  <div className="row">
                    <button type="submit" className="btn btn-sm" disabled={busy}>
                      Save
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            );
          }
          return (
            <li key={id} className="list-item" data-id={id} data-active={activeId === id || undefined}>
              <span className="num">{index + 1}</span>
              <button type="button" className="list-main" onClick={() => props.onSelect(id)}>
                <h4>{annotation.title}</h4>
                {annotation.text ? <p>{annotation.text}</p> : null}
                <span className="muted" style={{ fontSize: 12 }}>
                  {annotation.author ?? 'Curator'} · {formatRelative(annotation.created_at)}
                </span>
              </button>
              {curator ? (
                <div className="row" style={{ gap: 0 }}>
                  <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Edit note ${index + 1}`} onClick={() => setEditingId(annotation.id)}>
                    <Icon name="pencil" />
                  </button>
                  <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Delete note ${index + 1}`} onClick={() => props.onDelete(annotation.id)}>
                    <Icon name="trash" />
                  </button>
                </div>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ---------- Measure ----------

export function MeasurePanel(props: {
  measurements: Measurement[];
  active: boolean;
  trueScale: boolean;
  onStart: () => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  const { measurements, trueScale } = props;
  const latest = measurements.at(-1);
  return (
    <>
      <div className="row row-between">
        <button type="button" className="btn btn-sm" onClick={props.onStart} aria-pressed={props.active}>
          <Icon name="ruler" /> {props.active ? 'Measuring…' : 'Start measuring'}
        </button>
        <div className="row">
          <button type="button" className="btn btn-sm btn-ghost" onClick={props.onUndo} disabled={!measurements.length && !props.active}>
            <Icon name="undo" /> Undo
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={props.onClear} disabled={!measurements.length}>
            Clear
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        Click two points on the surface. Each pair adds a distance; Escape stops the ruler.
      </p>
      {!trueScale ? (
        <Notice>
          This scan has no real size yet, so distances are in model units. Give the real height when you upload photos to measure in millimetres.
        </Notice>
      ) : null}
      <div aria-live="polite" className="visually-hidden">
        {latest ? `Measured ${formatLength(latest.distance, trueScale)}` : ''}
      </div>
      <ol className="list">
        {measurements.map((m, index) => (
          <li key={m.id} className="list-item" style={{ alignItems: 'center' }}>
            <span className="num">{index + 1}</span>
            <span className="measure-value">{formatLength(m.distance, trueScale)}</span>
            <span />
          </li>
        ))}
      </ol>
    </>
  );
}

// ---------- Light ----------

export interface LightState {
  environment: EnvironmentName;
  exposure: number;
  intensity: number;
  azimuth: number;
  shadow: number;
  background: boolean;
}

export const DEFAULT_LIGHT: LightState = { environment: 'studio', exposure: 1, intensity: 1, azimuth: 45, shadow: 0.5, background: false };

const ENVIRONMENTS: { value: EnvironmentName; label: string }[] = [
  { value: 'studio', label: 'Studio' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'room', label: 'Room' },
  { value: 'none', label: 'Key only' },
];

function Slider(props: { id: string; label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="slider-row">
      <div className="row row-between">
        <label htmlFor={props.id}>{props.label}</label>
        <output htmlFor={props.id}>{props.format(props.value)}</output>
      </div>
      <input
        id={props.id}
        className="range"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function LightPanel(props: {
  light: LightState;
  autoRotate: boolean;
  onChange: (light: LightState) => void;
  onAutoRotate: (on: boolean) => void;
}) {
  const { light } = props;
  const set = (patch: Partial<LightState>) => props.onChange({ ...light, ...patch });
  return (
    <>
      <div className="group">
        <h3 className="group-title">Environment</h3>
        <div className="segmented" role="group" aria-label="Environment">
          {ENVIRONMENTS.map((env) => (
            <button key={env.value} type="button" aria-pressed={light.environment === env.value} onClick={() => set({ environment: env.value })}>
              {env.label}
            </button>
          ))}
        </div>
        {light.environment === 'studio' ? (
          <label className="switch">
            <input type="checkbox" checked={light.background} onChange={(event) => set({ background: event.target.checked })} />
            Show studio backdrop
          </label>
        ) : null}
      </div>
      <div className="group">
        <h3 className="group-title">Exposure and light</h3>
        <Slider id="exposure" label="Exposure" value={light.exposure} min={0.2} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(exposure) => set({ exposure })} />
        <Slider id="intensity" label="Key light" value={light.intensity} min={0} max={5} step={0.1} format={(v) => v.toFixed(1)} onChange={(intensity) => set({ intensity })} />
        <Slider id="azimuth" label="Key light direction" value={light.azimuth} min={0} max={359} step={1} format={(v) => `${v}°`} onChange={(azimuth) => set({ azimuth })} />
        <Slider id="shadow" label="Ground shadow" value={light.shadow} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(shadow) => set({ shadow })} />
      </div>
      <div className="group">
        <label className="switch">
          <input type="checkbox" checked={props.autoRotate} onChange={(event) => props.onAutoRotate(event.target.checked)} />
          Turn slowly
        </label>
        <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => props.onChange(DEFAULT_LIGHT)}>
          <Icon name="reset" /> Reset lighting
        </button>
      </div>
    </>
  );
}

/** Light coming from `azimuth` degrees around the model, 40 degrees above the horizon. */
export function lightDirection(azimuth: number): [number, number, number] {
  const a = (azimuth * Math.PI) / 180;
  const elevation = (40 * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(elevation), Math.sin(elevation), Math.sin(a) * Math.cos(elevation)];
}

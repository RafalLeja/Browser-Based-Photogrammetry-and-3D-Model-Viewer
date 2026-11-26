// The side panels of the object page. Each one receives plain data and callbacks; the page owns
// the viewer and the API calls.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Annotation, CollectionObject, EnvironmentName, LicenseKey, NoteCategory, NoteFields, ObjectPatch, Severity } from '../api';
import { formatLength } from '../index';
import type { Measurement, ModelInfo, RenderMode, RendererBackend } from '../index';
import { Icon, type IconName } from '../components/icon';
import { Dialog, Notice } from '../components/ui';
import { formatBytes, formatCount, formatDimensions, formatRelative } from '../lib/format';
import { DEFAULT_LIGHT, RAKING_LIGHT, type LightState } from '../lib/light';
import { LICENSES, NOTE_CATEGORIES, RECORD_FIELDS, SEVERITIES, categoryLabel, severityLabel } from '../lib/museum';

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="group">
      <div className="row row-between">
        <h3 className="group-title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------- Overview ----------

export type ExportFormat = 'stl' | 'obj';

export function OverviewPanel(props: {
  object: CollectionObject;
  info: ModelInfo | null;
  curator: boolean;
  exporting: ExportFormat | null;
  onEdit: () => void;
  onCover: () => void;
  onDelete: () => void;
  onCite: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  const { object, info, curator } = props;
  const record = RECORD_FIELDS.filter((field) => object.record[field.key]);
  const license = object.license ? LICENSES[object.license] : null;
  const canDownload = object.downloadable || curator;

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

      {record.length || curator ? (
        <Section
          title="Object record"
          action={
            curator ? (
              <button type="button" className="link-button" onClick={props.onEdit}>
                {record.length ? 'Edit' : 'Add'}
              </button>
            ) : undefined
          }
        >
          {record.length ? (
            <dl className="record">
              {record.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{object.record[field.key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted small">No museum record yet: accession number, maker, date, material and credit line.</p>
          )}
        </Section>
      ) : null}

      <Section title="Rights and reuse">
        <div className="rights">
          {license ? (
            license.url ? (
              <a className="license" href={license.url} target="_blank" rel="noopener noreferrer license">
                <Icon name="badge" /> {license.label}
              </a>
            ) : (
              <span className="license">
                <Icon name="lock" /> {license.label}
              </span>
            )
          ) : (
            <span className="muted small">Rights not stated yet{curator ? ': choose a licence in Edit details.' : '.'}</span>
          )}
          <div className="row">
            <button type="button" className="btn btn-sm btn-ghost" onClick={props.onCite}>
              <Icon name="quote" /> Cite
            </button>
            {canDownload && object.model_url ? (
              <>
                <a className="btn btn-sm btn-ghost" href={`/api/v1/objects/${object.id}/download`} download>
                  <Icon name="download" /> {object.model_format === 'ply' ? 'PLY' : 'GLB'}
                </a>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => props.onExport('stl')} disabled={!info || props.exporting !== null}>
                  <Icon name="cube" /> {props.exporting === 'stl' ? 'Preparing…' : 'STL for 3D printing'}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => props.onExport('obj')} disabled={!info || props.exporting !== null}>
                  {props.exporting === 'obj' ? 'Preparing…' : 'OBJ'}
                </button>
              </>
            ) : null}
          </div>
          {canDownload && !object.downloadable ? <p className="muted small">Only curators see downloads until the object has an open licence.</p> : null}
        </div>
      </Section>

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
          <dt>Added</dt>
          <dd>{formatRelative(object.created_at)}</dd>
        </div>
        <div className="fact">
          <dt>{curator ? 'Visits' : 'Notes'}</dt>
          <dd>{curator ? formatCount(object.visits) : object.annotation_count}</dd>
        </div>
      </dl>

      {curator ? (
        <Section title="Curator">
          {!object.alt_text ? (
            <Notice>
              Add a text description so screen-reader users know what the model shows.{' '}
              <button type="button" className="link-button" onClick={props.onEdit}>
                Add one
              </button>
            </Notice>
          ) : null}
          <div className="row">
            <button type="button" className="btn btn-sm btn-ghost" onClick={props.onEdit}>
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
        </Section>
      ) : null}
    </>
  );
}

/** Edits the title, the museum record, the licence and the text description in one dialog. */
export function EditObjectDialog(props: { object: CollectionObject; open: boolean; onClose: () => void; onSave: (patch: ObjectPatch) => Promise<void> }) {
  const { object } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const license = text('license') as LicenseKey | '';
    setBusy(true);
    setError('');
    try {
      await props.onSave({
        title: text('title'),
        description: text('description'),
        tags: text('tags')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        record: Object.fromEntries(RECORD_FIELDS.map((field) => [field.key, text(`record-${field.key}`)])),
        license: license || null,
        alt_text: text('alt_text') || null,
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} label="Edit details" wide>
      <form className="edit-form" onSubmit={submit}>
        <h2>Edit details</h2>
        <fieldset>
          <legend>Basics</legend>
          <div className="field">
            <label htmlFor="edit-title">Title</label>
            <input id="edit-title" name="title" className="input" defaultValue={object.title} required maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="edit-description">Description</label>
            <textarea id="edit-description" name="description" className="textarea" defaultValue={object.description} maxLength={4000} rows={4} />
          </div>
          <div className="field">
            <label htmlFor="edit-tags">Tags</label>
            <input id="edit-tags" name="tags" className="input" defaultValue={object.tags.join(', ')} />
            <span className="hint">Separate tags with commas.</span>
          </div>
        </fieldset>
        <fieldset>
          <legend>Museum record</legend>
          <div className="field-grid">
            {RECORD_FIELDS.map((field) => (
              <div key={field.key} className={`field ${field.multiline ? 'field-wide' : ''}`}>
                <label htmlFor={`record-${field.key}`}>{field.label}</label>
                {field.multiline ? (
                  <textarea id={`record-${field.key}`} name={`record-${field.key}`} className="textarea" rows={3} maxLength={2000} defaultValue={object.record[field.key] ?? ''} />
                ) : (
                  <input id={`record-${field.key}`} name={`record-${field.key}`} className="input" maxLength={300} defaultValue={object.record[field.key] ?? ''} />
                )}
                {field.hint ? <span className="hint">{field.hint}</span> : null}
              </div>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Rights and access</legend>
          <div className="field">
            <label htmlFor="edit-license">Licence</label>
            <select id="edit-license" name="license" className="select" defaultValue={object.license ?? ''}>
              <option value="">Not stated</option>
              {(Object.keys(LICENSES) as LicenseKey[]).map((key) => (
                <option key={key} value={key}>
                  {LICENSES[key].label}
                </option>
              ))}
            </select>
            <span className="hint">With an open licence, visitors can download the model as GLB, STL or OBJ.</span>
          </div>
          <div className="field">
            <label htmlFor="edit-alt">Text description</label>
            <textarea id="edit-alt" name="alt_text" className="textarea" rows={2} maxLength={1000} defaultValue={object.alt_text ?? ''} />
            <span className="hint">One or two sentences on what the model shows, read out to screen-reader users.</span>
          </div>
        </fieldset>
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            Save changes
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Notes ----------

export interface DraftPin {
  position: [number, number, number];
  normal: [number, number, number];
}

export type NoteFilter = NoteCategory | 'all';

function NoteFieldset({ note, idPrefix }: { note?: Pick<Annotation, 'title' | 'text' | 'category' | 'severity'>; idPrefix: string }) {
  const [category, setCategory] = useState<NoteCategory>(note?.category ?? 'note');
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-title`}>Title</label>
        <input id={`${idPrefix}-title`} name="title" className="input" defaultValue={note?.title} required maxLength={80} autoFocus />
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`${idPrefix}-category`}>Category</label>
          <select id={`${idPrefix}-category`} name="category" className="select" value={category} onChange={(event) => setCategory(event.target.value as NoteCategory)}>
            {NOTE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {category === 'damage' ? (
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor={`${idPrefix}-severity`}>Severity</label>
            <select id={`${idPrefix}-severity`} name="severity" className="select" defaultValue={note?.severity ?? 'slight'}>
              {SEVERITIES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-text`}>Note</label>
        <textarea id={`${idPrefix}-text`} name="text" className="textarea" defaultValue={note?.text} maxLength={2000} rows={3} />
      </div>
    </>
  );
}

function readNote(form: HTMLFormElement): NoteFields {
  const data = new FormData(form);
  const category = String(data.get('category') ?? 'note') as NoteCategory;
  return {
    title: String(data.get('title') ?? ''),
    text: String(data.get('text') ?? ''),
    category,
    severity: category === 'damage' ? (String(data.get('severity') ?? 'slight') as Severity) : null,
  };
}

export function NotesPanel(props: {
  annotations: Annotation[];
  activeId: string | null;
  curator: boolean;
  placing: boolean;
  draft: DraftPin | null;
  touring: boolean;
  filter: NoteFilter;
  onFilter: (filter: NoteFilter) => void;
  onSelect: (id: string) => void;
  onStartPlacing: () => void;
  onSaveDraft: (note: NoteFields) => Promise<void>;
  onCancelDraft: () => void;
  onUpdate: (id: number, note: NoteFields) => Promise<void>;
  onDelete: (id: number) => void;
  onTour: () => void;
  onReport: () => void;
}) {
  const { annotations, activeId, curator, draft, filter } = props;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const counts = new Map<NoteCategory, number>();
  for (const note of annotations) counts.set(note.category, (counts.get(note.category) ?? 0) + 1);
  const shown = filter === 'all' ? annotations : annotations.filter((note) => note.category === filter);

  useEffect(() => {
    if (!activeId) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  async function run(event: FormEvent<HTMLFormElement>, action: (note: NoteFields) => Promise<void>) {
    event.preventDefault();
    const note = readNote(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await action(note);
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

      {counts.size > 1 ? (
        <div className="chips" role="group" aria-label="Show notes of one category">
          <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => props.onFilter('all')}>
            All <span className="count">{annotations.length}</span>
          </button>
          {NOTE_CATEGORIES.filter((c) => counts.has(c.key)).map((c) => (
            <button key={c.key} type="button" className="chip" aria-pressed={filter === c.key} onClick={() => props.onFilter(filter === c.key ? 'all' : c.key)}>
              <span className="kind-dot" data-kind={c.key} /> {c.plural} <span className="count">{counts.get(c.key)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {props.placing && !draft ? <Notice>Click the model where the note belongs. Press Escape to stop.</Notice> : null}

      {draft ? (
        <form className="card-panel" style={{ padding: 20, gap: 14 }} onSubmit={(event) => run(event, props.onSaveDraft)}>
          <strong>New note</strong>
          <NoteFieldset idPrefix="note" />
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
        {shown.map((annotation) => {
          const id = String(annotation.id);
          const number = annotations.indexOf(annotation) + 1;
          if (editingId === annotation.id) {
            return (
              <li key={id} className="list-item" style={{ display: 'block' }}>
                <form
                  className="group"
                  onSubmit={(event) =>
                    run(event, async (note) => {
                      await props.onUpdate(annotation.id, note);
                      setEditingId(null);
                    })
                  }
                >
                  <NoteFieldset idPrefix={`edit-note-${id}`} note={annotation} />
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
              <span className="num" data-kind={annotation.category}>
                {number}
              </span>
              <button type="button" className="list-main" onClick={() => props.onSelect(id)}>
                <span className="note-kind" data-kind={annotation.category}>
                  {categoryLabel(annotation.category)}
                  {annotation.severity ? ` · ${severityLabel(annotation.severity)}` : ''}
                </span>
                <h4>{annotation.title}</h4>
                {annotation.text ? <p>{annotation.text}</p> : null}
                <span className="muted" style={{ fontSize: 12 }}>
                  {annotation.author ?? 'Curator'} · {formatRelative(annotation.created_at)}
                </span>
              </button>
              {curator ? (
                <div className="row" style={{ gap: 0 }}>
                  <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Edit note ${number}`} onClick={() => setEditingId(annotation.id)}>
                    <Icon name="pencil" />
                  </button>
                  <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Delete note ${number}`} onClick={() => props.onDelete(annotation.id)}>
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

      {annotations.length ? (
        <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={props.onReport}>
          <Icon name="file" /> Condition report
        </button>
      ) : null}
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
  sweeping: boolean;
  onChange: (light: LightState) => void;
  onAutoRotate: (on: boolean) => void;
  onSweep: () => void;
}) {
  const { light } = props;
  const set = (patch: Partial<LightState>) => props.onChange({ ...light, ...patch });
  const raking = light.environment === 'none' && light.elevation <= 15;
  return (
    <>
      <div className="presets" role="group" aria-label="Lighting presets">
        <button type="button" className="preset" aria-pressed={!raking && light.environment === 'studio'} onClick={() => props.onChange({ ...DEFAULT_LIGHT, azimuth: light.azimuth })}>
          <Icon name="sun" />
          <strong>Studio</strong>
          <span>Soft, even light</span>
        </button>
        <button type="button" className="preset" aria-pressed={raking} onClick={() => props.onChange({ ...light, ...RAKING_LIGHT })}>
          <Icon name="raking" />
          <strong>Raking light</strong>
          <span>Low and from one side: reveals relief, tool marks and cracks</span>
        </button>
      </div>
      {raking ? (
        <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={props.onSweep} aria-pressed={props.sweeping}>
          <Icon name={props.sweeping ? 'pause' : 'refresh'} /> {props.sweeping ? 'Stop sweep' : 'Sweep the light around'}
        </button>
      ) : null}
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
        <Slider id="elevation" label="Key light height" value={light.elevation} min={2} max={88} step={1} format={(v) => `${v}°`} onChange={(elevation) => set({ elevation })} />
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

// ---------- Inspect ----------

export const RENDER_MODES: { mode: RenderMode; label: string; icon: IconName; hint: string }[] = [
  { mode: 'standard', label: 'Colour', icon: 'image', hint: 'The photographed colours and materials' },
  { mode: 'clay', label: 'Clay', icon: 'sphere', hint: 'Matte grey: the shape alone, without colour' },
  { mode: 'wireframe', label: 'Wireframe', icon: 'grid', hint: 'The triangles of the mesh' },
  { mode: 'normals', label: 'Normals', icon: 'compass', hint: 'Coloured by the direction each surface faces' },
];

export function InspectPanel(props: {
  object: CollectionObject;
  info: ModelInfo | null;
  backend: RendererBackend | null;
  renderMode: RenderMode;
  dimensions: boolean;
  trueScale: boolean;
  onRenderMode: (mode: RenderMode) => void;
  onDimensions: (on: boolean) => void;
}) {
  const { info } = props;
  const stats = info?.stats;
  const points = Boolean(stats && stats.meshes === 0 && stats.points > 0);
  return (
    <>
      <Section title="Surface">
        <div className="mode-grid" role="group" aria-label="Render mode">
          {RENDER_MODES.map((item, index) => (
            <button
              key={item.mode}
              type="button"
              className="mode"
              aria-pressed={props.renderMode === item.mode}
              onClick={() => props.onRenderMode(item.mode)}
              disabled={!info || points}
              title={`${item.hint} (${index + 1})`}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </div>
        <p className="muted small">{points ? 'A point cloud is always drawn with its own colours.' : RENDER_MODES.find((m) => m.mode === props.renderMode)?.hint}</p>
        <label className="switch">
          <input type="checkbox" checked={props.dimensions} onChange={(event) => props.onDimensions(event.target.checked)} disabled={!info} />
          Show overall dimensions
        </label>
      </Section>
      <Section title="Model">
        <dl className="facts">
          <div className="fact">
            <dt>Triangles</dt>
            <dd>{formatCount(info?.triangles)}</dd>
          </div>
          <div className="fact">
            <dt>Vertices</dt>
            <dd>{formatCount(stats?.vertices)}</dd>
          </div>
          <div className="fact">
            <dt>Meshes</dt>
            <dd>{stats ? stats.meshes + stats.points : '–'}</dd>
          </div>
          <div className="fact">
            <dt>Materials</dt>
            <dd>{stats?.materials ?? '–'}</dd>
          </div>
          <div className="fact">
            <dt>Textures</dt>
            <dd>{stats ? (stats.textures ? `${stats.textures} · up to ${stats.maxTextureSize} px` : 'None') : '–'}</dd>
          </div>
          <div className="fact">
            <dt>Colour</dt>
            <dd>{stats ? (stats.vertexColors ? 'Per vertex' : stats.textures ? 'Textures' : 'Material') : '–'}</dd>
          </div>
          <div className="fact">
            <dt>Bounding box</dt>
            <dd>{info ? info.size.map((v) => formatLength(v, props.trueScale)).join(' × ') : '–'}</dd>
          </div>
          <div className="fact">
            <dt>Renderer</dt>
            <dd>{props.backend === 'webgpu' ? 'WebGPU' : props.backend === 'webgl2' ? 'WebGL 2' : '–'}</dd>
          </div>
        </dl>
        <p className="muted small">
          File: {formatBytes(props.object.file_size)}, {props.object.model_format === 'ply' ? 'PLY' : 'glTF binary'}.
        </p>
      </Section>
    </>
  );
}

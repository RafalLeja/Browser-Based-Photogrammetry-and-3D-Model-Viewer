// A printable condition report: the object record, four overall views and a close-up of every
// note, rendered by an off-screen viewer. Print it, or save it as a PDF from the print dialog.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Annotation, type CollectionObject } from '../api';
import { useAuth } from '../auth';
import { createViewer, type Vec3 } from '../index';
import { Icon } from '../components/icon';
import { EmptyState, ErrorState, useAsync, useDocumentTitle } from '../components/ui';
import { formatDimensions } from '../lib/format';
import { LICENSES, RECORD_FIELDS, categoryLabel, reportOrder, severityLabel } from '../lib/museum';

const IMAGE_SIZE = { width: 1200, height: 900 };
/** A light studio grey: reads like a catalogue photograph and saves ink when printed. */
const BACKDROP = '#e9e9ec';
/** glTF models face +Z, so these are the conventional four sides, seen a little from above. */
const SIDES: { label: string; direction: Vec3 }[] = [
  { label: 'Front', direction: [0, 0.27, 1] },
  { label: 'Right', direction: [1, 0.27, 0] },
  { label: 'Back', direction: [0, 0.27, -1] },
  { label: 'Left', direction: [-1, 0.27, 0] },
];

interface Images {
  sides: string[];
  notes: Map<number, string>;
}

function useReportImages(object: CollectionObject | undefined, notes: Annotation[] | undefined) {
  const host = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<Images | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = host.current;
    if (!element || !object?.model_url || !notes) return;
    let cancelled = false;
    const urls: string[] = [];
    let dispose = () => {};
    const shot = async (take: () => Promise<Blob>) => {
      const url = URL.createObjectURL(await take());
      urls.push(url);
      return url;
    };
    (async () => {
      const viewer = await createViewer(element, {
        environment: { hdrUrl: `${import.meta.env.BASE_URL}hdr/studio_small_09_1k.hdr` },
        decoderPath: `${import.meta.env.BASE_URL}decoders/`,
      });
      dispose = () => viewer.dispose();
      if (cancelled) return;
      await viewer.load(object.model_url!, { format: object.model_format, up: object.up ?? undefined, trueScale: Boolean(object.dimensions_mm) });
      viewer.setPins(notes.map((n) => ({ id: String(n.id), position: n.position, normal: n.normal, title: n.title })));
      const total = SIDES.length + notes.length;
      const sides: string[] = [];
      for (const side of SIDES) {
        viewer.viewFrom(side.direction, { animate: false });
        sides.push(await shot(() => viewer.screenshot({ type: 'image/jpeg', quality: 0.86, fit: 'subject', background: BACKDROP })));
        if (cancelled) return;
        setProgress({ done: sides.length, total });
      }
      const closeUps = new Map<number, string>();
      for (const note of notes) {
        viewer.focusPin(String(note.id), { animate: false });
        closeUps.set(note.id, await shot(() => viewer.screenshot({ type: 'image/jpeg', quality: 0.86, maxSize: 900, background: BACKDROP })));
        if (cancelled) return;
        setProgress({ done: sides.length + closeUps.size, total });
      }
      setImages({ sides, notes: closeUps });
      viewer.dispose();
      dispose = () => {};
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      dispose();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [object, notes]);

  return { host, images, progress, error };
}

export function ConditionReport() {
  const { id } = useParams();
  const objectId = Number(id);
  const { user } = useAuth();
  const object = useAsync(() => api.object(objectId), [objectId, user?.id]);
  const notes = useAsync(() => api.annotations(objectId), [objectId]);
  const { host, images, progress, error } = useReportImages(object.data, notes.data);
  useDocumentTitle(object.data ? `Condition report · ${object.data.title}` : 'Condition report');

  if (object.error || notes.error) {
    const failure = (object.error ?? notes.error)!;
    return (
      <div className="page container">
        {(failure as { status?: number }).status === 404 ? (
          <EmptyState icon="search" title="Object not found" action={<Link to="/collection" className="btn">Back to the collection</Link>} />
        ) : (
          <ErrorState error={failure} onRetry={object.reload} />
        )}
      </div>
    );
  }

  const data = object.data;
  const ordered = reportOrder(notes.data ?? []);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const damage = ordered.filter((n) => n.category === 'damage');
  const record = data ? RECORD_FIELDS.filter((f) => data.record[f.key]) : [];

  return (
    <div className="report">
      <div className="report-bar no-print">
        <Link to={`/objects/${objectId}`} className="link-arrow">
          <Icon name="chevronLeft" /> Back to the object
        </Link>
        <div className="row">
          {progress && !images ? (
            <span className="muted small" role="status">
              Rendering views · {progress.done} of {progress.total}
            </span>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => window.print()} disabled={!images}>
            <Icon name="printer" /> Print or save as PDF
          </button>
        </div>
      </div>

      {/* The off-screen viewer that renders the report's images. */}
      <div ref={host} className="report-renderer" style={IMAGE_SIZE} aria-hidden="true" />

      <article className="report-sheet">
        <header className="report-head">
          <div>
            <p className="eyebrow">Condition report</p>
            <h1>{data?.title ?? ' '}</h1>
            <p className="muted">
              {[data?.record.accession_number, data?.record.maker, data?.record.date].filter(Boolean).join(' · ') || 'No museum record yet'}
            </p>
          </div>
          <dl className="report-meta">
            <div>
              <dt>Date</dt>
              <dd>{today}</dd>
            </div>
            <div>
              <dt>Prepared by</dt>
              <dd>{user?.display_name ?? '—'}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>
                {ordered.length}
                {damage.length ? ` · ${damage.length} damage` : ''}
              </dd>
            </div>
          </dl>
        </header>

        {error ? <p className="notice notice-danger">The views could not be rendered: {error}</p> : null}

        <section className="report-section">
          <h2>Object</h2>
          <dl className="record">
            {record.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{data?.record[field.key]}</dd>
              </div>
            ))}
            <div>
              <dt>Dimensions</dt>
              <dd>{formatDimensions(data?.dimensions_mm)}</dd>
            </div>
            <div>
              <dt>Rights</dt>
              <dd>{data?.license ? LICENSES[data.license].label : 'Not stated'}</dd>
            </div>
            {data?.description ? (
              <div>
                <dt>Description</dt>
                <dd>{data.description}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="report-section">
          <h2>Overall views</h2>
          <div className="report-sides">
            {SIDES.map((side, index) => (
              <figure key={side.label}>
                {images ? <img src={images.sides[index]} alt={`${data?.title ?? 'Object'}, ${side.label.toLowerCase()} view`} /> : <div className="skeleton report-image" />}
                <figcaption>{side.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="report-section">
          <h2>Observations</h2>
          {ordered.length === 0 ? <p className="muted">No notes have been recorded on this object.</p> : null}
          <ol className="report-notes">
            {ordered.map((note) => {
              const number = (notes.data ?? []).indexOf(note) + 1;
              return (
                <li key={note.id} className="report-note">
                  <figure>
                    {images?.notes.get(note.id) ? (
                      <img src={images.notes.get(note.id)} alt={`Close-up of note ${number}: ${note.title}`} />
                    ) : (
                      <div className="skeleton report-image" />
                    )}
                    <span className="report-marker" data-kind={note.category}>
                      {number}
                    </span>
                  </figure>
                  <div>
                    <p className="note-kind" data-kind={note.category}>
                      {categoryLabel(note.category)}
                      {note.severity ? ` · ${severityLabel(note.severity)}` : ''}
                    </p>
                    <h3>
                      {number}. {note.title}
                    </h3>
                    {note.text ? <p>{note.text}</p> : null}
                    <p className="muted small">
                      {note.author ?? 'Curator'} · {new Date(note.created_at).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <footer className="report-foot muted small">
          Generated by Vitrine from the 3D model and the notes recorded on it. Views are renders of the model, not photographs.
        </footer>
      </article>
    </div>
  );
}

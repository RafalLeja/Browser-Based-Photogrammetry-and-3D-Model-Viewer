// New scan: pick or drop photos (or a zip), check them in the browser, upload with progress,
// then follow the reconstruction on the job page.
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, uploadPhotos } from '../api';
import { Icon } from '../components/icon';
import { Notice, useAsync, useDocumentTitle } from '../components/ui';
import { formatBytes } from '../lib/format';
import { DEFAULT_LIMITS, coverageLevel, isZip, readyToUpload, selectPhotos } from '../lib/photos';

const PREVIEW_LIMIT = 48;

const COVERAGE: Record<number, { label: string; color: string }> = {
  0: { label: 'Not enough photos yet', color: 'var(--danger)' },
  1: { label: 'Workable: 20 or more photos give a fuller model', color: 'var(--warning)' },
  2: { label: 'Good coverage', color: 'var(--success)' },
  3: { label: 'Great coverage', color: 'var(--success)' },
};

function Preview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (isZip(file)) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <div className="thumb">
      {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <div className="thumb-file">{file.name}</div>}
      <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove}>
        <Icon name="x" />
      </button>
    </div>
  );
}

export function Upload() {
  useDocumentTitle('New scan');
  const navigate = useNavigate();
  const pipeline = useAsync(() => api.pipeline(), []);
  const limits = pipeline.data?.limits ?? DEFAULT_LIMITS;
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const selection = useMemo(() => selectPhotos([], files, limits), [files, limits]);
  const ready = readyToUpload(selection, limits);
  const level = coverageLevel(selection.photoCount + (selection.zipCount ? 30 : 0));

  useEffect(() => () => abortRef.current?.(), []); // Leaving the page cancels an upload in flight.

  function add(incoming: File[]) {
    const next = selectPhotos(files, incoming, limits);
    setFiles(next.accepted);
    setRejected(next.rejected.map(({ file, reason }) => ({ name: file.name, reason })));
    setError('');
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    add([...event.dataTransfer.files]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready.ok) return;
    const data = new FormData(event.currentTarget);
    const height = Number(data.get('height'));
    setError('');
    setProgress(0);
    const upload = uploadPhotos(
      {
        title: String(data.get('title') ?? ''),
        description: String(data.get('description') ?? ''),
        tags: String(data.get('tags') ?? ''),
        realHeightMm: height > 0 ? height : undefined,
      },
      files,
      setProgress,
    );
    abortRef.current = upload.abort;
    try {
      const result = await upload.promise;
      abortRef.current = null;
      navigate(`/jobs/${result.job.id}`);
    } catch (err) {
      abortRef.current = null;
      setProgress(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const uploading = progress !== null;

  return (
    <div className="page">
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">New scan</p>
          <h1 className="page-title">Turn photos into a model.</h1>
          <p className="page-lede">
            Add 30 to 80 sharp, overlapping photos taken all around the object. New to this? Read the <Link to="/guide">capture guide</Link> first.
          </p>
        </header>

        <form className="create-layout" onSubmit={submit}>
          <div>
            <div
              className="dropzone"
              data-dragging={dragging || undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="dropzone-icon">
                <Icon name="upload" />
              </span>
              <h2>Drop photos here</h2>
              <p className="muted">JPEG or PNG photos, or a zip of them · up to {limits.max_photo_mb} MB per photo</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  Choose photos
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => folderInput.current?.click()} disabled={uploading}>
                  <Icon name="folder" /> Choose a folder
                </button>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/jpeg,image/png,.zip,application/zip"
                hidden
                onChange={(event) => {
                  add([...(event.target.files ?? [])]);
                  event.target.value = '';
                }}
              />
              <input
                ref={folderInput}
                type="file"
                hidden
                // Chromium, Firefox and Safari all support picking a whole folder this way.
                {...{ webkitdirectory: '' }}
                onChange={(event) => {
                  add([...(event.target.files ?? [])]);
                  event.target.value = '';
                }}
              />
            </div>

            {rejected.length ? (
              <div style={{ marginTop: 16 }}>
                <Notice kind="warning">
                  <strong>
                    {rejected.length} {rejected.length === 1 ? 'file was' : 'files were'} skipped
                  </strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {rejected.slice(0, 5).map((r) => (
                      <li key={r.name}>
                        {r.name}: {r.reason}
                      </li>
                    ))}
                    {rejected.length > 5 ? <li>and {rejected.length - 5} more</li> : null}
                  </ul>
                </Notice>
              </div>
            ) : null}

            {files.length ? (
              <>
                <div className="row row-between" style={{ marginTop: 24 }}>
                  <strong>
                    {selection.photoCount} {selection.photoCount === 1 ? 'photo' : 'photos'}
                    {selection.zipCount ? ` + ${selection.zipCount} zip` : ''} · {formatBytes(selection.totalBytes)}
                  </strong>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFiles([])} disabled={uploading}>
                    Remove all
                  </button>
                </div>
                <div className="thumbs">
                  {files.slice(0, PREVIEW_LIMIT).map((file) => (
                    <Preview key={`${file.name}:${file.size}`} file={file} onRemove={() => setFiles((list) => list.filter((f) => f !== file))} />
                  ))}
                </div>
                {files.length > PREVIEW_LIMIT ? <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>and {files.length - PREVIEW_LIMIT} more</p> : null}
              </>
            ) : null}
          </div>

          <div className="card-panel">
            <div className="field">
              <label htmlFor="title">Object name</label>
              <input id="title" name="title" className="input" required maxLength={120} placeholder="e.g. Bronze figurine" disabled={uploading} />
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <textarea id="description" name="description" className="textarea" maxLength={4000} rows={3} placeholder="What it is, where it comes from" disabled={uploading} />
            </div>
            <div className="field">
              <label htmlFor="tags">Tags</label>
              <input id="tags" name="tags" className="input" placeholder="sculpture, bronze" disabled={uploading} />
              <span className="hint">Separate tags with commas.</span>
            </div>
            <div className="field">
              <label htmlFor="height">Real height in millimetres</label>
              <input id="height" name="height" className="input" type="number" min={1} max={100000} step="any" inputMode="decimal" placeholder="Optional" disabled={uploading} />
              <span className="hint">Makes the model true to scale, so the ruler shows real millimetres.</span>
            </div>

            <div className="quality" aria-live="polite">
              <div className="row row-between">
                <span className="label">Coverage</span>
                <span className="muted">{COVERAGE[level].label}</span>
              </div>
              <div className="quality-bar" data-level={level} style={{ ['--quality-color' as string]: COVERAGE[level].color }}>
                <span />
                <span />
                <span />
              </div>
            </div>

            {pipeline.data?.mode === 'demo' ? (
              <Notice kind="warning">
                <strong>Demo mode.</strong> {pipeline.data.reason[0].toUpperCase() + pipeline.data.reason.slice(1)}. Your photos are stored, and a sample scan is published so you can try the whole flow.
              </Notice>
            ) : null}
            {error ? <Notice kind="danger">{error}</Notice> : null}

            {uploading ? (
              <div className="group">
                <div className="row row-between" style={{ fontSize: 14 }}>
                  <span>Uploading…</span>
                  <span className="muted">{Math.round((progress ?? 0) * 100)}%</span>
                </div>
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
                  <span style={{ width: `${(progress ?? 0) * 100}%` }} />
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => abortRef.current?.()}>
                  Cancel upload
                </button>
              </div>
            ) : (
              <button type="submit" className="btn btn-block" disabled={!ready.ok}>
                Start reconstruction
              </button>
            )}
            {!ready.ok && !uploading ? <p className="hint muted" style={{ fontSize: 13, textAlign: 'center' }}>{ready.reason}</p> : null}
          </div>
        </form>
      </div>
    </div>
  );
}

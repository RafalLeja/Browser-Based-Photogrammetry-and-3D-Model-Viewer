// Reconstruction jobs: the list, and one job followed stage by stage while it runs.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Job, type JobStatus } from '../api';
import { Icon } from '../components/icon';
import { EmptyState, ErrorState, Notice, useAsync, useDocumentTitle, useInterval, useToast } from '../components/ui';
import { formatDuration, formatRelative } from '../lib/format';
import { stageStates } from '../lib/jobs';

const POLL_MS = 1500;

const STATUS: Record<JobStatus, { label: string; badge: string }> = {
  queued: { label: 'Queued', badge: 'badge-neutral' },
  running: { label: 'Running', badge: '' },
  done: { label: 'Done', badge: 'badge-success' },
  failed: { label: 'Failed', badge: 'badge-danger' },
  cancelled: { label: 'Cancelled', badge: 'badge-warning' },
};

const active = (job: Job) => job.status === 'queued' || job.status === 'running';

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${STATUS[status].badge}`}>{STATUS[status].label}</span>;
}

export function JobPage() {
  const { id } = useParams();
  const jobId = Number(id);
  const toast = useToast();
  const job = useAsync(() => api.job(jobId), [jobId]);
  const pipeline = useAsync(() => api.pipeline(), []);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(job.data ? `Job ${job.data.id}` : 'Job');

  // Poll while the job can still change; stop once it is final.
  useInterval(
    () => {
      api.job(jobId).then(job.setData, () => undefined);
    },
    job.data && active(job.data) ? POLL_MS : null,
  );

  async function act(action: 'cancel' | 'retry') {
    setBusy(true);
    try {
      job.setData(await (action === 'cancel' ? api.cancelJob(jobId) : api.retryJob(jobId)));
      toast(action === 'cancel' ? 'Cancelling…' : 'Queued again');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'alert');
    } finally {
      setBusy(false);
    }
  }

  if (job.error) {
    return (
      <div className="page container">
        <ErrorState error={job.error} onRetry={job.reload} />
      </div>
    );
  }
  const data = job.data;
  const stages = pipeline.data?.stages ?? [];
  const states = data ? stageStates(data, stages) : [];
  const elapsed =
    data?.started_at && (data.finished_at || active(data))
      ? ((data.finished_at ? Date.parse(data.finished_at) : Date.now()) - Date.parse(data.started_at)) / 1000
      : null;

  return (
    <div className="page">
      <div className="container">
        <Link to="/jobs" className="link-arrow" style={{ fontSize: 14 }}>
          <Icon name="chevronLeft" /> All jobs
        </Link>
        <div className="job-head" style={{ marginTop: 16 }}>
          <div className="page-head" style={{ margin: 0 }}>
            <p className="eyebrow">Reconstruction {data ? `#${data.id}` : ''}</p>
            <h1 className="page-title">{data?.object_title ?? ' '}</h1>
          </div>
          {data ? (
            <div className="row">
              {active(data) ? (
                <button type="button" className="btn btn-ghost" onClick={() => void act('cancel')} disabled={busy}>
                  Cancel
                </button>
              ) : null}
              {data.status === 'failed' || data.status === 'cancelled' ? (
                <button type="button" className="btn btn-ghost" onClick={() => void act('retry')} disabled={busy}>
                  <Icon name="refresh" /> Retry
                </button>
              ) : null}
              {data.status === 'done' ? (
                <Link to={`/objects/${data.object_id}`} className="btn">
                  Open model <Icon name="chevronRight" />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        {!data ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : (
          <div className="job-layout">
            <div className="group" style={{ gap: 28 }}>
              <div className="group">
                <div className="row row-between">
                  <StatusBadge status={data.status} />
                  <span className="muted" style={{ fontSize: 14 }}>
                    {data.progress}%{elapsed !== null ? ` · ${formatDuration(elapsed)}` : ''}
                  </span>
                </div>
                <div className="progress" role="progressbar" aria-label="Reconstruction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.progress}>
                  <span style={{ width: `${data.progress}%` }} />
                </div>
              </div>

              {data.pipeline === 'demo' ? (
                <Notice kind="warning">
                  <strong>Demo pipeline.</strong> No CUDA GPU was available, so these stages are simulated and a sample scan is published. Run the API on a machine with an NVIDIA GPU to reconstruct your own photos.
                </Notice>
              ) : null}
              {data.error ? <Notice kind="danger">{data.error}</Notice> : null}

              <ol className="timeline" aria-label="Stages">
                {stages.map((stage, index) => (
                  <li key={stage.key} data-state={states[index]}>
                    <span className="dot">
                      {states[index] === 'done' ? <Icon name="check" /> : states[index] === 'active' ? <span className="spinner" /> : states[index] === 'failed' ? <Icon name="x" /> : null}
                    </span>
                    <div>
                      <h3>{stage.label}</h3>
                      <p>{stage.description}</p>
                    </div>
                    <span className="time">{formatDuration(data.stage_times[stage.key])}</span>
                  </li>
                ))}
              </ol>

              <details>
                <summary>Pipeline log</summary>
                <pre className="log">{data.log || 'No output yet.'}</pre>
              </details>
            </div>

            <aside className="card-panel" aria-label="Job details">
              <dl className="facts" style={{ gridTemplateColumns: '1fr' }}>
                <div className="fact">
                  <dt>Photos</dt>
                  <dd>{data.photo_count}</dd>
                </div>
                <div className="fact">
                  <dt>Pipeline</dt>
                  <dd>{data.pipeline === 'colmap' ? 'COLMAP (CUDA)' : data.pipeline === 'demo' ? 'Demo' : 'Waiting for a worker'}</dd>
                </div>
                <div className="fact">
                  <dt>Submitted</dt>
                  <dd>{formatRelative(data.created_at)}</dd>
                </div>
                <div className="fact">
                  <dt>Attempts</dt>
                  <dd>{data.attempts}</dd>
                </div>
              </dl>
              <p className="muted" style={{ fontSize: 13 }}>
                You can leave this page; the reconstruction keeps running on the server.
              </p>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

const FILTERS: { value: 'all' | 'active' | 'done' | 'failed'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

export function JobsPage() {
  useDocumentTitle('Jobs');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  const jobs = useAsync(() => api.jobs(filter), [filter]);
  useInterval(
    () => {
      api.jobs(filter).then(jobs.setData, () => undefined);
    },
    jobs.data?.some(active) ? POLL_MS * 2 : null,
  );

  return (
    <div className="page">
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">Reconstruction</p>
          <h1 className="page-title">Jobs</h1>
        </header>
        <div className="row row-between" style={{ marginBottom: 24 }}>
          <div className="segmented" role="group" aria-label="Filter jobs">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          <Link to="/create" className="btn btn-sm">
            <Icon name="plus" /> New scan
          </Link>
        </div>
        {jobs.error ? (
          <ErrorState error={jobs.error} onRetry={jobs.reload} />
        ) : !jobs.data ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : jobs.data.length === 0 ? (
          <EmptyState icon="layers" title="No jobs here" action={<Link to="/create" className="btn">Start a scan</Link>}>
            Uploaded photo sets show up here while they are reconstructed.
          </EmptyState>
        ) : (
          <div className="job-rows">
            {jobs.data.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="job-row">
                <div>
                  <h3>{job.object_title}</h3>
                  <span className="muted" style={{ fontSize: 13 }}>
                    #{job.id} · {job.photo_count} photos · {formatRelative(job.created_at)}
                  </span>
                </div>
                <div className="progress" aria-label={`${job.progress}%`}>
                  <span style={{ width: `${job.progress}%` }} />
                </div>
                <StatusBadge status={job.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

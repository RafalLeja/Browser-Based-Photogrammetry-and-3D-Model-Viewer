// The curator dashboard: the collection, the reconstruction work behind it and how visitors use
// it. Charts are plain SVG and HTML with a hover layer and a table view, in validated colours.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type NoteCategory, type Stats } from '../api';
import { Icon } from '../components/icon';
import { ErrorState, useAsync, useDocumentTitle, useInterval } from '../components/ui';
import { formatBytes, formatCount, formatDuration, formatRelative, niceTicks } from '../lib/format';
import { NOTE_CATEGORIES } from '../lib/museum';
import { StatusBadge } from './jobs';

const STAGE_LABELS: Record<string, string> = {
  upload: 'Photos received',
  features: 'Finding features',
  matching: 'Matching photos',
  sparse: 'Placing cameras',
  dense: 'Measuring depth',
  mesh: 'Building the surface',
  optimize: 'Cleaning up',
  publish: 'Publishing',
};

function Tile({ label, value, detail, icon }: { label: string; value: string; detail?: ReactNode; icon: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">
        <Icon name={icon} /> {label}
      </span>
      <strong className="stat-value">{value}</strong>
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </div>
  );
}

function Card({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="viz-card">
      <header className="viz-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="muted small">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** The element's width in CSS pixels, so a chart draws at its real size and its text stays 11 px. */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Finished reconstructions per day: stacked columns, done below and failed on top. */
function JobsChart({ days }: { days: Stats['jobs_by_day'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [plotRef, width] = useWidth(720);
  const height = 200;
  const pad = { left: 32, right: 8, top: 12, bottom: 26 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(...days.map((d) => d.done + d.failed), 0));
  const top = ticks.at(-1) || 1;
  const slot = plotW / days.length;
  const barW = Math.min(24, slot * 0.62);
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const total = days.reduce((sum, d) => sum + d.done + d.failed, 0);
  const hovered = hover === null ? null : days[hover];

  /** A column segment with a 4 px rounded data end on top when it is the top of the stack. */
  const segment = (x: number, y0: number, y1: number, rounded: boolean) => {
    const h = y0 - y1;
    if (h <= 0) return '';
    const r = rounded ? Math.min(4, h, barW / 2) : 0;
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z`;
  };

  return (
    <div className="viz">
      <div className="viz-legend">
        <span>
          <i className="swatch" style={{ background: 'var(--viz-done)' }} /> Done
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--viz-failed)' }} /> <Icon name="x" /> Failed
        </span>
      </div>
      {total === 0 ? <p className="muted small viz-empty">No reconstructions finished in the last 30 days.</p> : null}
      <div className="viz-plot" ref={plotRef} onPointerLeave={() => setHover(null)}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Reconstructions finished per day over the last 30 days: ${total} in total.`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'viz-baseline' : 'viz-gridline'} />
              <text x={pad.left - 8} y={y(tick)} className="viz-tick" textAnchor="end" dominantBaseline="middle">
                {tick}
              </text>
            </g>
          ))}
          {days.map((day, i) => {
            const x = pad.left + i * slot + (slot - barW) / 2;
            const doneTop = y(day.done);
            // A 2 px surface gap separates the failed segment from the done segment below it.
            const failedBase = day.done > 0 ? doneTop - 2 : y(0);
            const failedTop = failedBase - (day.failed / top) * plotH;
            return (
              <g key={day.date} data-hover={hover === i || undefined}>
                <path d={segment(x, y(0), doneTop, day.failed === 0)} fill="var(--viz-done)" />
                {day.failed > 0 ? <path d={segment(x, failedBase, failedTop, true)} fill="var(--viz-failed)" /> : null}
                {i % 5 === 4 || i === days.length - 1 ? (
                  <text x={x + barW / 2} y={height - 8} className="viz-tick" textAnchor="middle">
                    {label(day.date)}
                  </text>
                ) : null}
                <rect
                  x={pad.left + i * slot}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  className="viz-hit"
                  tabIndex={0}
                  aria-label={`${label(day.date)}: ${day.done} done, ${day.failed} failed`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {hovered && hover !== null ? (
          <div className="viz-tooltip" style={{ left: `${((pad.left + (hover + 0.5) * slot) / width) * 100}%` }} role="status">
            <span className="muted">{label(hovered.date)}</span>
            <span>
              <i className="key" style={{ background: 'var(--viz-done)' }} /> <strong>{hovered.done}</strong> done
            </span>
            <span>
              <i className="key" style={{ background: 'var(--viz-failed)' }} /> <strong>{hovered.failed}</strong> failed
            </span>
          </div>
        ) : null}
      </div>
      <details className="viz-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Done</th>
              <th scope="col">Failed</th>
            </tr>
          </thead>
          <tbody>
            {days
              .filter((d) => d.done + d.failed > 0)
              .map((d) => (
                <tr key={d.date}>
                  <td>{label(d.date)}</td>
                  <td>{d.done}</td>
                  <td>{d.failed}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Rows of name, bar and figure: one hue, every value printed at its bar. */
function MeterList({ rows, format }: { rows: { key: string; label: ReactNode; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="meter-list">
      {rows.map((row) => (
        <li key={row.key} title={`${typeof row.label === 'string' ? row.label : row.key}: ${format(row.value)}`}>
          <span className="meter-name">{row.label}</span>
          <span className="meter-track">
            <span className="meter-bar" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="meter-value">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  useDocumentTitle('Dashboard');
  const stats = useAsync(() => api.stats(), []);
  // Live while something is reconstructing.
  useInterval(() => {
    api.stats().then(stats.setData, () => undefined);
  }, stats.data?.jobs.active ? 4000 : null);

  if (stats.error) {
    return (
      <div className="page container">
        <ErrorState error={stats.error} onRetry={stats.reload} />
      </div>
    );
  }
  const data = stats.data;
  const storage = data
    ? [
        { key: 'models', label: 'Models', value: data.storage_bytes.models, color: 'var(--viz-1)' },
        { key: 'uploads', label: 'Uploaded photos', value: data.storage_bytes.uploads, color: 'var(--viz-2)' },
        { key: 'thumbnails', label: 'Covers', value: data.storage_bytes.thumbnails, color: 'var(--viz-3)' },
      ]
    : [];
  const successRate = data && data.jobs.done + data.jobs.failed > 0 ? Math.round((data.jobs.done / (data.jobs.done + data.jobs.failed)) * 100) : null;
  const notesByCategory = NOTE_CATEGORIES.map((c) => ({ key: c.key, label: c.plural, value: data?.notes_by_category[c.key as NoteCategory] ?? 0 })).filter((r) => r.value > 0);
  const stageRows = Object.keys(STAGE_LABELS)
    .filter((key) => data?.stage_seconds[key] !== undefined)
    .map((key) => ({ key, label: STAGE_LABELS[key], value: data!.stage_seconds[key] }));

  return (
    <div className="page dashboard">
      <div className="container">
        <header className="page-head row row-between" style={{ alignItems: 'flex-end' }}>
          <div>
            <p className="eyebrow">Curator</p>
            <h1 className="page-title">Dashboard</h1>
          </div>
          <div className="row">
            <Link to="/jobs" className="btn btn-sm btn-ghost">
              <Icon name="layers" /> Jobs
            </Link>
            <Link to="/create" className="btn btn-sm">
              <Icon name="plus" /> New scan
            </Link>
          </div>
        </header>

        {!data ? (
          <div className="skeleton" style={{ height: 320 }} />
        ) : (
          <>
            <div className="stat-row">
              <Tile
                icon="box"
                label="Published objects"
                value={formatCount(data.objects.ready)}
                detail={[data.objects.processing && `${data.objects.processing} processing`, data.objects.failed && `${data.objects.failed} failed`].filter(Boolean).join(' · ') || `${data.objects.total} in total`}
              />
              <Tile icon="eye" label="Visits" value={formatCount(data.visits)} detail="Visitors, once per object per half hour" />
              <Tile icon="pin" label="Notes" value={formatCount(data.notes)} detail={data.notes_by_category.damage ? `${data.notes_by_category.damage} record damage` : `${data.shared_views} shared views`} />
              <Tile
                icon="clock"
                label="Median reconstruction"
                value={data.median_job_seconds === null ? '–' : formatDuration(data.median_job_seconds)}
                detail={successRate === null ? 'No finished jobs yet' : `${successRate}% of finished jobs succeeded`}
              />
              <Tile icon="drive" label="Storage" value={formatBytes(data.storage_bytes.total)} detail="Photos, models and covers" />
            </div>

            <div className="viz-grid">
              <Card title="Reconstructions" subtitle="Finished per day, last 30 days">
                <JobsChart days={data.jobs_by_day} />
              </Card>

              <Card title="Time per stage" subtitle="Average over successful runs">
                {stageRows.length ? <MeterList rows={stageRows} format={(v) => formatDuration(v)} /> : <p className="muted small">Appears after the first successful run.</p>}
              </Card>

              <Card title="Most visited" subtitle="Published objects, all time">
                {data.top_objects.length ? (
                  <ol className="top-list">
                    {data.top_objects.map((o) => (
                      <li key={o.id}>
                        <Link to={`/objects/${o.id}`}>
                          {o.thumbnail_url ? <img src={o.thumbnail_url} alt="" loading="lazy" /> : <span className="top-thumb" />}
                          <span className="top-title">{o.title}</span>
                          <span className="meter-value">{formatCount(o.visits)}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted small">Visits appear here once visitors open published objects.</p>
                )}
              </Card>

              <Card title="Storage" subtitle={formatBytes(data.storage_bytes.total)}>
                <div className="segmented-bar" role="img" aria-label={storage.map((s) => `${s.label} ${formatBytes(s.value)}`).join(', ')}>
                  {storage
                    .filter((s) => s.value > 0)
                    .map((s) => (
                      <span key={s.key} style={{ flexGrow: s.value, background: s.color }} title={`${s.label}: ${formatBytes(s.value)}`} />
                    ))}
                </div>
                <ul className="legend-list">
                  {storage.map((s) => (
                    <li key={s.key}>
                      <i className="swatch" style={{ background: s.color }} /> {s.label}
                      <span className="meter-value">{formatBytes(s.value)}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Notes by category" subtitle={`${data.notes} notes on ${data.objects.total} objects`}>
                {notesByCategory.length ? (
                  <MeterList
                    rows={notesByCategory.map((r) => ({
                      ...r,
                      label: (
                        <>
                          <span className="kind-dot" data-kind={r.key} /> {r.label}
                        </>
                      ),
                    }))}
                    format={(v) => String(v)}
                  />
                ) : (
                  <p className="muted small">No notes yet.</p>
                )}
              </Card>

              <Card
                title="Recent reconstructions"
                action={
                  <Link to="/jobs" className="link-arrow small">
                    All jobs <Icon name="chevronRight" />
                  </Link>
                }
              >
                {data.recent_jobs.length ? (
                  <ul className="recent-list">
                    {data.recent_jobs.map((job) => (
                      <li key={job.id}>
                        <Link to={`/jobs/${job.id}`}>
                          <span className="top-title">{job.object_title}</span>
                          <span className="muted small">{formatRelative(job.created_at)}</span>
                          <StatusBadge status={job.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No reconstructions yet.</p>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

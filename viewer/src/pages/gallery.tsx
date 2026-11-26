import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type CollectionObject, type ObjectQuery } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/icon';
import { EmptyState, ErrorState, useAsync, useDocumentTitle } from '../components/ui';
import { formatCount, formatRelative } from '../lib/format';

const PAGE_SIZE = 24;
const SORTS: { value: NonNullable<ObjectQuery['sort']>; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
];
const STATUSES: { value: NonNullable<ObjectQuery['status']>; label: string }[] = [
  { value: 'ready', label: 'Published' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
  { value: 'all', label: 'All' },
];

function ObjectCard({ object }: { object: CollectionObject }) {
  return (
    <Link to={object.status === 'ready' ? `/objects/${object.id}` : `/jobs/${object.job_id}`} className="card">
      <div className="card-media">
        {object.thumbnail_url ? (
          <img src={object.thumbnail_url} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="card-placeholder">
            <Icon name="box" />
          </div>
        )}
        <div className="card-badges">
          {object.status !== 'ready' ? <span className="badge">{object.status === 'processing' ? 'Processing' : 'Failed'}</span> : null}
          {object.is_demo ? <span className="badge">Demo</span> : null}
          {object.annotation_count > 0 ? (
            <span className="badge">
              <Icon name="pin" /> {object.annotation_count}
            </span>
          ) : null}
        </div>
      </div>
      <div className="card-body">
        <h3 className="card-title">{object.title}</h3>
        <div className="card-meta">
          {object.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
          <span>
            {object.triangles ? `${formatCount(object.triangles)} triangles · ` : ''}
            {formatRelative(object.created_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="card">
          <div className="skeleton" style={{ aspectRatio: '4 / 3', borderRadius: 18 }} />
          <div className="skeleton" style={{ height: 18, width: '60%' }} />
          <div className="skeleton" style={{ height: 14, width: '40%' }} />
        </div>
      ))}
    </div>
  );
}

export function Gallery() {
  useDocumentTitle('Collection');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tag = params.get('tag') ?? '';
  const sort = (params.get('sort') as ObjectQuery['sort']) ?? 'newest';
  const status = (params.get('status') as ObjectQuery['status']) ?? 'ready';
  const page = Number(params.get('page') ?? '1') || 1;
  const [draft, setDraft] = useState(q);
  const pushed = useRef(q);

  // Typing updates the URL after a short pause, so results are shareable and the back button works.
  useEffect(() => {
    if (draft === q) return;
    const id = setTimeout(() => {
      pushed.current = draft;
      update({ q: draft, page: '' });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Back, forward or a link changed the search: the box follows. Our own updates are skipped, so
  // letters typed meanwhile are not overwritten.
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setDraft(q);
    }
  }, [q]);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const results = useAsync(
    () => api.objects({ q, tag, sort, status: user ? status : 'ready', page, page_size: PAGE_SIZE }),
    [q, tag, sort, status, page, user?.id],
  );
  const tags = useAsync(() => api.tags(), []);
  const pages = results.data ? Math.max(1, Math.ceil(results.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="page">
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">The collection</p>
          <h1 className="page-title">Every object, from every angle.</h1>
          <p className="page-lede">Turn each record in 3D, measure it and read the notes curators pinned to it.</p>
        </header>

        <div className="toolbar">
          <label className="search">
            <span className="visually-hidden">Search the collection</span>
            <Icon name="search" />
            <input
              className="input"
              type="search"
              placeholder="Search by title, description or tag"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <label className="row">
            <span className="visually-hidden">Sort by</span>
            <select className="select" value={sort} onChange={(event) => update({ sort: event.target.value, page: '' })}>
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="chips" role="group" aria-label="Filter by tag">
          <button type="button" className="chip" aria-pressed={!tag} onClick={() => update({ tag: '', page: '' })}>
            All
          </button>
          {(tags.data ?? []).map(({ tag: name, count }) => (
            <button key={name} type="button" className="chip" aria-pressed={tag === name} onClick={() => update({ tag: tag === name ? '' : name, page: '' })}>
              {name} <span className="count">{count}</span>
            </button>
          ))}
        </div>

        {user ? (
          <div className="segmented" role="group" aria-label="Status" style={{ marginTop: 16 }}>
            {STATUSES.map((option) => (
              <button key={option.value} type="button" aria-pressed={status === option.value} onClick={() => update({ status: option.value === 'ready' ? '' : option.value, page: '' })}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        <p className="result-count" aria-live="polite">
          {results.data ? `${results.data.total} ${results.data.total === 1 ? 'object' : 'objects'}` : ' '}
        </p>

        {results.error ? (
          <ErrorState error={results.error} onRetry={results.reload} />
        ) : !results.data ? (
          <SkeletonGrid />
        ) : results.data.items.length === 0 ? (
          <EmptyState
            icon="search"
            title={q || tag ? 'No matches' : 'Nothing here yet'}
            action={
              q || tag ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDraft('');
                    update({ q: '', tag: '', page: '' });
                  }}
                >
                  Clear filters
                </button>
              ) : user ? (
                <Link to="/create" className="btn">
                  New scan
                </Link>
              ) : undefined
            }
          >
            {q || tag ? 'Try a different word or tag.' : 'Published objects will appear here.'}
          </EmptyState>
        ) : (
          <>
            <div className="grid">
              {results.data.items.map((object) => (
                <ObjectCard key={object.id} object={object} />
              ))}
            </div>
            {pages > 1 ? (
              <nav className="row" aria-label="Pages" style={{ justifyContent: 'center', marginTop: 40 }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                  <Icon name="chevronLeft" /> Previous
                </button>
                <span className="muted" style={{ fontSize: 14 }}>
                  Page {page} of {pages}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                  Next <Icon name="chevronRight" />
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// Login, the chrome-less embed view and the 404 page.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Viewer } from '../index';
import { BrandMark } from '../components/layout';
import { Icon } from '../components/icon';
import { ModelStage } from '../components/model-stage';
import { EmptyState, Notice, useAsync, useDocumentTitle } from '../components/ui';
import { safeNext } from '../lib/format';
import { DEFAULT_LIGHT, sharedLight } from '../lib/light';
import { applyLight, environmentOptions } from './viewerpage';

export function Login() {
  useDocumentTitle('Sign in');
  const { user, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  if (user) return <Navigate to={next} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await login(String(data.get('login') ?? ''), String(data.get('password') ?? ''));
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit} aria-describedby={error ? 'login-error' : undefined}>
        <BrandMark />
        <div className="group" style={{ gap: 6 }}>
          <h1>Sign in</h1>
          <p className="muted">Curators sign in to upload photos, edit objects and add notes. Visitors can browse without an account.</p>
        </div>
        <div className="field">
          <label htmlFor="login">Login</label>
          <input id="login" name="login" className="input" autoComplete="username" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" className="input" type="password" autoComplete="current-password" required />
        </div>
        {error ? (
          <div id="login-error">
            <Notice kind="danger">{error}</Notice>
          </div>
        ) : null}
        <button type="submit" className="btn btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <Link to="/collection" className="link-arrow" style={{ justifySelf: 'center', fontSize: 15 }}>
          Browse as a visitor <Icon name="chevronRight" />
        </Link>
      </form>
    </div>
  );
}

export function Embed() {
  const { id } = useParams();
  const objectId = Number(id);
  const [params] = useSearchParams();
  const object = useAsync(() => api.object(objectId), [objectId]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loaded, setLoaded] = useState(false);
  useDocumentTitle(object.data?.title ?? '3D model');

  const viewId = params.get('view');
  useEffect(() => {
    if (!viewer || !loaded || !viewId) return;
    api.view(viewId).then(({ state }) => {
      viewer.setView({ position: state.position, target: state.target }, { animate: false });
      applyLight(viewer, sharedLight(state, DEFAULT_LIGHT), DEFAULT_LIGHT);
    }, () => undefined);
  }, [viewer, loaded, viewId]);

  const data = object.data;
  return (
    <div className="embed">
      {object.error ? (
        <div className="stage-loading">This model is not available.</div>
      ) : data?.model_url ? (
        <ModelStage
          url={data.model_url}
          format={data.model_format}
          up={data.up}
          trueScale={Boolean(data.dimensions_mm)}
          label={`3D view of ${data.title}`}
          environment={environmentOptions(DEFAULT_LIGHT)}
          autoRotate={params.get('autorotate') === '1'}
          cooperative // The host page keeps its scrolling; Ctrl/⌘ + scroll zooms.
          onViewer={setViewer}
          onLoaded={() => setLoaded(true)}
        />
      ) : (
        <div className="stage-loading">
          <div className="ring" data-indeterminate />
        </div>
      )}
      <div className="stage-top">
        {data ? <span className="glass glass-pill">{data.title}</span> : <span />}
        <button type="button" className="glass glass-pill" style={{ cursor: 'pointer' }} onClick={() => viewer?.resetView()} aria-label="Reset view">
          <Icon name="reset" />
        </button>
      </div>
      <a className="glass glass-pill embed-brand" href={`/objects/${objectId}`} target="_blank" rel="noopener">
        Open in Vitrine <Icon name="external" />
      </a>
    </div>
  );
}

export function NotFound() {
  useDocumentTitle('Not found');
  return (
    <div className="page container">
      <EmptyState icon="search" title="This page does not exist" action={<Link to="/" className="btn">Go home</Link>}>
        The link may be old or mistyped.
      </EmptyState>
    </div>
  );
}

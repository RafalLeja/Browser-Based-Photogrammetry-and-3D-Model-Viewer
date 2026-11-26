// Two objects side by side with linked cameras: turn one and the other follows, at the same angle
// and the same zoom relative to its size. For before and after, raw and cleaned, or two copies.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type CollectionObject } from '../api';
import { mirrorView, type ModelInfo, type Viewer } from '../index';
import { Icon } from '../components/icon';
import { ModelStage } from '../components/model-stage';
import { EmptyState, useAsync, useDocumentTitle } from '../components/ui';
import { formatCount } from '../lib/format';

type Side = 'a' | 'b';

function Pane(props: {
  side: Side;
  object: CollectionObject | undefined;
  objects: CollectionObject[];
  onPick: (id: number) => void;
  onViewer: (viewer: Viewer | null) => void;
  onLoaded: (info: ModelInfo) => void;
  onDrive: () => void;
  info: ModelInfo | null;
}) {
  const { object } = props;
  return (
    <section className="compare-pane" aria-label={object ? `3D view of ${object.title}` : 'Choose an object'} onPointerDownCapture={props.onDrive} onWheelCapture={props.onDrive}>
      {object?.model_url ? (
        <ModelStage
          key={object.id}
          url={object.model_url}
          format={object.model_format}
          up={object.up}
          trueScale={Boolean(object.dimensions_mm)}
          label={`3D view of ${object.title}`}
          onViewer={props.onViewer}
          onLoaded={props.onLoaded}
        />
      ) : (
        <div className="stage-loading">{object ? 'This object has no model yet.' : <div className="ring" data-indeterminate />}</div>
      )}
      <div className="compare-top">
        <label className="glass compare-pick">
          <span className="visually-hidden">Object {props.side.toUpperCase()}</span>
          <span className="compare-letter" aria-hidden="true">
            {props.side.toUpperCase()}
          </span>
          <select value={object?.id ?? ''} onChange={(event) => props.onPick(Number(event.target.value))}>
            {props.objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
        {object ? (
          <Link to={`/objects/${object.id}`} className="glass glass-pill" title="Open in the viewer">
            <Icon name="external" /> <span className="pill-label">Open</span>
          </Link>
        ) : null}
      </div>
      {props.info ? (
        <div className="glass glass-pill compare-stats">
          {formatCount(props.info.triangles)} △ · {formatCount(props.info.stats.vertices)} vertices
        </div>
      ) : null}
    </section>
  );
}

export function ComparePage() {
  useDocumentTitle('Compare');
  const [params, setParams] = useSearchParams();
  const list = useAsync(() => api.objects({ page_size: 60, sort: 'oldest' }), []);
  const objects = (list.data?.items ?? []).filter((o) => o.model_url);
  const aId = Number(params.get('a')) || objects[0]?.id;
  const bId = Number(params.get('b')) || objects.find((o) => o.id !== aId)?.id;
  const a = objects.find((o) => o.id === aId);
  const b = objects.find((o) => o.id === bId);

  const [linked, setLinked] = useState(true);
  const viewers = useRef<Record<Side, Viewer | null>>({ a: null, b: null });
  const [infos, setInfos] = useState<Record<Side, ModelInfo | null>>({ a: null, b: null });
  const driver = useRef<Side>('a');
  const applying = useRef(false);
  const [, setReady] = useState(0); // Re-runs the linking effect when a viewer arrives.

  function pick(side: Side, id: number) {
    const next = new URLSearchParams(params);
    next.set(side, String(id));
    if (side === 'a' && !next.get('b') && bId) next.set('b', String(bId));
    if (side === 'b' && !next.get('a') && aId) next.set('a', String(aId));
    setInfos((current) => ({ ...current, [side]: null }));
    setParams(next, { replace: true });
  }

  // The pane the person is touching drives; the other copies its camera on every frame.
  useEffect(() => {
    const { a: va, b: vb } = viewers.current;
    if (!linked || !va || !vb || !infos.a || !infos.b) return;
    const follow = (from: Side, to: Side) => (view: { position: [number, number, number]; target: [number, number, number] }) => {
      const target = viewers.current[to];
      const fromInfo = infos[from];
      const toInfo = infos[to];
      if (applying.current || driver.current !== from || !target || !fromInfo || !toInfo) return;
      applying.current = true;
      target.setView(mirrorView(view, fromInfo, toInfo), { animate: false });
      applying.current = false;
    };
    const offs = [va.on('camera-move', follow('a', 'b')), vb.on('camera-move', follow('b', 'a'))];
    // Line the follower up with the driver straight away.
    driver.current = 'a';
    applying.current = true;
    vb.setView(mirrorView(va.getView(), infos.a, infos.b), { animate: false });
    applying.current = false;
    return () => offs.forEach((off) => off());
  }, [linked, infos]);

  function resetBoth() {
    viewers.current.a?.resetView();
    viewers.current.b?.resetView();
  }

  function swap() {
    if (!aId || !bId) return;
    setInfos({ a: infos.b, b: infos.a });
    setParams(new URLSearchParams({ a: String(bId), b: String(aId) }), { replace: true });
  }

  if (list.data && objects.length < 2) {
    return (
      <div className="page container">
        <EmptyState icon="columns" title="Two objects are needed" action={<Link to="/collection" className="btn">Back to the collection</Link>}>
          Compare needs at least two published objects with a model.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="compare">
      <div className="compare-bar">
        <div>
          <p className="eyebrow">Compare</p>
          <h1 className="compare-title">Side by side, one camera.</h1>
        </div>
        <div className="row">
          <label className="switch">
            <input type="checkbox" checked={linked} onChange={(event) => setLinked(event.target.checked)} />
            <Icon name="link" /> Link cameras
          </label>
          <button type="button" className="btn btn-sm btn-ghost" onClick={swap} disabled={!a || !b}>
            <Icon name="swap" /> Swap
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={resetBoth}>
            <Icon name="reset" /> Reset views
          </button>
        </div>
      </div>
      <div className="compare-panes">
        {(['a', 'b'] as Side[]).map((side) => (
          <Pane
            key={side}
            side={side}
            object={side === 'a' ? a : b}
            objects={objects}
            info={infos[side]}
            onPick={(id) => pick(side, id)}
            onDrive={() => {
              driver.current = side;
            }}
            onViewer={(viewer) => {
              viewers.current[side] = viewer;
              setReady((n) => n + 1);
            }}
            onLoaded={(info) => setInfos((current) => ({ ...current, [side]: info }))}
          />
        ))}
      </div>
    </div>
  );
}

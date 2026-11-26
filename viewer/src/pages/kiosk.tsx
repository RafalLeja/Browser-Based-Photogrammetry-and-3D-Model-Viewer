// Kiosk mode for a gallery screen or a lecture: an attract loop turns each object and tours its
// notes; a touch hands control to the visitor; after a quiet spell a countdown returns to the loop.
// /kiosk?ids=1,4,7&idle=90 picks the objects and the idle time in seconds.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Annotation, type CollectionObject } from '../api';
import type { Viewer } from '../index';
import { Icon } from '../components/icon';
import { ModelStage } from '../components/model-stage';
import { useAsync, useDocumentTitle } from '../components/ui';
import { nextPhase, type Phase } from '../lib/kiosk';
import { categoryLabel } from '../lib/museum';
import { toPin } from './viewerpage';

const TURN_MS = 14_000;
const NOTE_MS = 6_000;
const WARNING_S = 10;

export function Kiosk() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const idleSeconds = Math.max(20, Number(params.get('idle')) || 90);
  const objects = useAsync(async () => {
    const items = ids.length ? await Promise.all(ids.map((id) => api.object(id).catch(() => null))) : (await api.objects({ page_size: 12, sort: 'oldest' })).items;
    return items.filter((o): o is CollectionObject => Boolean(o?.model_url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('ids')]);
  const list = objects.data ?? [];

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'turn' });
  const [interactive, setInteractive] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastInput = useRef(Date.now());
  const object = list[index % Math.max(1, list.length)];
  const notes = useAsync(() => (object ? api.annotations(object.id) : Promise.resolve([] as Annotation[])), [object?.id]);
  const noteList = notes.data ?? [];
  useDocumentTitle(object ? `${object.title} · Kiosk` : 'Kiosk');

  const goTo = useCallback(
    (next: number) => {
      setLoaded(false);
      setPhase({ kind: 'turn' });
      setIndex(((next % list.length) + list.length) % list.length);
    },
    [list.length],
  );

  // The attract loop: turn, then each note, then the next object.
  useEffect(() => {
    if (interactive || !loaded || list.length === 0) return;
    const timer = setTimeout(
      () => {
        const next = nextPhase(phase, noteList.length);
        if (next === 'next-object') {
          if (list.length > 1) goTo(index + 1);
          else setPhase({ kind: 'turn' });
        } else setPhase(next);
      },
      phase.kind === 'turn' ? TURN_MS : NOTE_MS,
    );
    return () => clearTimeout(timer);
  }, [interactive, loaded, phase, noteList.length, list.length, index, goTo]);

  useEffect(() => {
    if (!viewer || !loaded) return;
    viewer.setPins(noteList.map(toPin));
    if (phase.kind === 'note' && noteList[phase.index]) {
      viewer.setAutoRotate(false);
      viewer.focusPin(String(noteList[phase.index].id));
    } else if (!interactive) {
      viewer.setActivePin(null);
      viewer.resetView();
      viewer.setAutoRotate(true);
    }
  }, [viewer, loaded, phase, noteList, interactive]);

  // Any touch, click or key hands control to the visitor.
  useEffect(() => {
    const wake = () => {
      lastInput.current = Date.now();
      setCountdown(null);
      setInteractive(true);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('wheel', wake, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('wheel', wake);
    };
  }, []);

  useEffect(() => {
    if (interactive) viewer?.setAutoRotate(false);
  }, [interactive, viewer]);

  // After a quiet spell a countdown appears; when it runs out, the loop takes over again.
  useEffect(() => {
    if (!interactive) return;
    const timer = setInterval(() => {
      const quiet = (Date.now() - lastInput.current) / 1000;
      if (quiet < idleSeconds - WARNING_S) return setCountdown(null);
      const left = Math.ceil(idleSeconds - quiet);
      if (left > 0) return setCountdown(left);
      setCountdown(null);
      setInteractive(false);
      setPhase({ kind: 'turn' });
    }, 250);
    return () => clearInterval(timer);
  }, [interactive, idleSeconds]);

  const note = phase.kind === 'note' ? noteList[phase.index] : undefined;
  const caption = [object?.record.maker, object?.record.date, object?.record.place].filter(Boolean).join(' · ');

  if (objects.data && list.length === 0) {
    return (
      <div className="kiosk kiosk-empty">
        <p>There is nothing to present yet.</p>
        <Link to="/collection" className="btn">
          Back to the collection
        </Link>
      </div>
    );
  }

  return (
    <div className="kiosk" data-interactive={interactive || undefined}>
      {object ? (
        <ModelStage
          key={object.id}
          url={object.model_url}
          format={object.model_format}
          up={object.up}
          trueScale={Boolean(object.dimensions_mm)}
          label={object.alt_text ? `3D view of ${object.title}: ${object.alt_text}` : `3D view of ${object.title}`}
          autoRotate
          onViewer={setViewer}
          onLoaded={() => setLoaded(true)}
        />
      ) : (
        <div className="stage-loading">
          <div className="ring" data-indeterminate />
        </div>
      )}

      <div className="kiosk-caption">
        {note ? (
          <div className="kiosk-note" key={note.id}>
            <span className="note-kind" data-kind={note.category}>
              {categoryLabel(note.category)}
            </span>
            <h2>{note.title}</h2>
            {note.text ? <p>{note.text}</p> : null}
          </div>
        ) : (
          <div className="kiosk-object" key={object?.id}>
            {object?.record.accession_number ? <span className="kiosk-accession">{object.record.accession_number}</span> : null}
            <h1>{object?.title}</h1>
            {caption ? <p className="kiosk-meta">{caption}</p> : null}
            {object?.description ? <p className="kiosk-description">{object.description}</p> : null}
          </div>
        )}
      </div>

      {interactive ? (
        <div className="kiosk-controls">
          {list.length > 1 ? (
            <button type="button" className="kiosk-btn" onClick={() => goTo(index - 1)} aria-label="Previous object">
              <Icon name="chevronLeft" />
            </button>
          ) : null}
          <button type="button" className="kiosk-btn" onClick={() => viewer?.resetView()} aria-label="Reset the view">
            <Icon name="reset" />
          </button>
          {noteList.length ? (
            <div className="kiosk-notes" role="group" aria-label="Notes">
              {noteList.map((n, i) => (
                <button key={n.id} type="button" className="kiosk-chip" data-kind={n.category} aria-pressed={phase.kind === 'note' && phase.index === i} onClick={() => setPhase({ kind: 'note', index: i })}>
                  {i + 1}. {n.title}
                </button>
              ))}
            </div>
          ) : null}
          {list.length > 1 ? (
            <button type="button" className="kiosk-btn" onClick={() => goTo(index + 1)} aria-label="Next object">
              <Icon name="chevronRight" />
            </button>
          ) : null}
          <button type="button" className="kiosk-btn" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())} aria-label="Full screen">
            <Icon name="maximize" />
          </button>
        </div>
      ) : (
        <p className="kiosk-hint" aria-hidden="true">
          Touch to explore
        </p>
      )}

      {list.length > 1 ? (
        <div className="kiosk-progress" aria-hidden="true">
          {list.map((o, i) => (
            <span key={o.id} data-current={i === index || undefined} />
          ))}
        </div>
      ) : null}

      {countdown !== null ? (
        <div className="kiosk-countdown" role="alertdialog" aria-label="Still exploring?">
          <h2>Still exploring?</h2>
          <p>The tour starts again in {countdown} s. Touch anywhere to stay.</p>
        </div>
      ) : null}

      <Link to={object ? `/objects/${object.id}` : '/collection'} className="kiosk-exit" aria-label="Leave kiosk mode">
        <Icon name="x" />
      </Link>
    </div>
  );
}

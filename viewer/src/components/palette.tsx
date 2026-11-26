// The command palette: Ctrl+K or ⌘K (or /) from anywhere finds objects and pages and runs actions.
// An accessible combobox: the input owns a listbox, arrows move the active option, Enter runs it.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type CollectionObject } from '../api';
import { useAuth } from '../auth';
import { fuzzyMatch } from '../lib/format';
import { Icon, type IconName } from './icon';

export const OPEN_PALETTE = 'vitrine:palette';

/** Opens the palette from anywhere, for example the search button in the navigation bar. */
export function openPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE));
}

interface Command {
  id: string;
  group: 'Objects' | 'Go to' | 'Actions';
  label: string;
  hint?: string;
  icon: IconName;
  image?: string | null;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [objects, setObjects] = useState<CollectionObject[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const listId = useId();

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_PALETTE, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_PALETTE, show);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    }
    if (!open && element.open) element.close();
  }, [open]);

  // Objects come from the API as the person types; an empty query shows the newest.
  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = setTimeout(() => {
      api.objects({ q: query.trim(), page_size: 6 }).then(
        (page) => current && setObjects(page.items),
        () => current && setObjects([]),
      );
    }, 120);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, query]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path);
    const pages: Command[] = [
      { id: 'home', group: 'Go to', label: 'Home', icon: 'museum', run: go('/') },
      { id: 'collection', group: 'Go to', label: 'Collection', icon: 'grid', run: go('/collection') },
      { id: 'compare', group: 'Go to', label: 'Compare two objects', icon: 'columns', run: go('/compare') },
      { id: 'kiosk', group: 'Go to', label: 'Kiosk mode', hint: 'Full-screen tour for a gallery screen', icon: 'monitor', run: go('/kiosk') },
      { id: 'guide', group: 'Go to', label: 'Capture guide', icon: 'camera', run: go('/guide') },
    ];
    if (user) {
      pages.push(
        { id: 'create', group: 'Actions', label: 'New scan', hint: 'Upload photos', icon: 'upload', run: go('/create') },
        { id: 'dashboard', group: 'Go to', label: 'Dashboard', icon: 'chart', run: go('/dashboard') },
        { id: 'jobs', group: 'Go to', label: 'Reconstruction jobs', icon: 'layers', run: go('/jobs') },
        {
          id: 'logout',
          group: 'Actions',
          label: 'Sign out',
          icon: 'logout',
          run: () => {
            void logout().then(() => navigate('/'));
          },
        },
      );
    } else {
      pages.push({ id: 'login', group: 'Actions', label: 'Sign in', hint: 'For curators', icon: 'lock', run: go('/login') });
    }
    const found: Command[] = objects.map((o) => ({
      id: `object-${o.id}`,
      group: 'Objects',
      label: o.title,
      hint: o.record.accession_number ?? o.tags.slice(0, 2).join(', '),
      icon: 'box',
      image: o.thumbnail_url,
      run: go(o.status === 'ready' ? `/objects/${o.id}` : `/jobs/${o.job_id}`),
    }));
    return [...found, ...pages.filter((c) => fuzzyMatch(`${c.label} ${c.hint ?? ''}`, query))];
  }, [objects, query, user, navigate, logout]);

  const selected = Math.min(active, Math.max(0, commands.length - 1));

  function run(command: Command | undefined) {
    if (!command) return;
    setOpen(false);
    command.run();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') setActive((selected + 1) % Math.max(1, commands.length));
    else if (event.key === 'ArrowUp') setActive((selected - 1 + commands.length) % Math.max(1, commands.length));
    else if (event.key === 'Enter') run(commands[selected]);
    else return;
    event.preventDefault();
  }

  let lastGroup = '';
  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Search and commands"
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === dialog.current) setOpen(false);
      }}
    >
      {open ? (
        <div className="palette-body">
          <div className="palette-search">
            <Icon name="search" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={commands[selected] ? `${listId}-${commands[selected].id}` : undefined}
              aria-autocomplete="list"
              aria-label="Search objects, pages and actions"
              placeholder="Search objects, pages and actions"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <kbd>Esc</kbd>
          </div>
          <ul id={listId} role="listbox" className="palette-list" aria-label="Results">
            {commands.map((command, index) => {
              const header = command.group !== lastGroup ? command.group : null;
              lastGroup = command.group;
              return (
                <li key={command.id} role="presentation">
                  {header ? (
                    <div className="palette-group" role="presentation">
                      {header}
                    </div>
                  ) : null}
                  <div
                    id={`${listId}-${command.id}`}
                    role="option"
                    aria-selected={index === selected}
                    className="palette-option"
                    onPointerMove={() => setActive(index)}
                    onClick={() => run(command)}
                  >
                    {command.image ? <img src={command.image} alt="" /> : <Icon name={command.icon} />}
                    <span className="palette-label">{command.label}</span>
                    {command.hint ? <span className="palette-hint">{command.hint}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="palette-foot" aria-live="polite">
            {commands.length ? `${commands.length} results · ↑↓ to choose · Enter to open` : 'Nothing matches. Try another word.'}
          </p>
        </div>
      ) : null}
    </dialog>
  );
}

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { initials } from '../lib/format';
import { Icon } from './icon';
import { openPalette } from './palette';

const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2997ff" />
          <stop offset="1" stopColor="#7a5cff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#0b0b0d" />
      <path d="M16 6 25 11v10l-9 5-9-5V11zM7 11l9 5 9-5M16 16v10" fill="none" stroke="url(#brand-gradient)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false); // Close the phone menu after navigating.
  }, [location.pathname]);

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link to="/" className="brand" aria-label="Vitrine home">
          <BrandMark />
          Vitrine
        </Link>
        <button
          type="button"
          className="icon-btn nav-menu-button"
          aria-expanded={open}
          aria-controls="nav-links"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'x' : 'menu'} />
        </button>
        <button type="button" className="nav-search" onClick={openPalette} aria-label={`Search (${SHORTCUT})`}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>{SHORTCUT}</kbd>
        </button>
        <nav id="nav-links" className="nav-links" data-open={open || undefined} aria-label="Main">
          <NavLink to="/collection" className="nav-link">
            Collection
          </NavLink>
          <NavLink to="/guide" className="nav-link">
            Capture guide
          </NavLink>
          {user ? (
            <>
              <NavLink to="/create" className="nav-link">
                New scan
              </NavLink>
              <NavLink to="/jobs" className="nav-link">
                Jobs
              </NavLink>
              <NavLink to="/dashboard" className="nav-link">
                Dashboard
              </NavLink>
              <div className="nav-user">
                <span className="avatar" title={`Signed in as ${user.display_name}`}>
                  {initials(user.display_name)}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Sign out"
                  title="Sign out"
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                >
                  <Icon name="logout" />
                </button>
              </div>
            </>
          ) : (
            <NavLink to="/login" className="nav-link">
              Sign in
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>Vitrine · Browser-based photogrammetry and 3D viewing · Wrocław University of Science and Technology</span>
        <nav aria-label="Footer">
          <Link to="/collection">Collection</Link>
          <Link to="/compare">Compare</Link>
          <Link to="/kiosk">Kiosk mode</Link>
          <Link to="/guide">Capture guide</Link>
          <a href="/api/docs">API</a>
        </nav>
      </div>
    </footer>
  );
}

export function Shell({ footer = true }: { footer?: boolean }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} style={{ flex: 1, outline: 'none' }}>
        <Outlet />
      </main>
      {footer ? <Footer /> : null}
    </>
  );
}

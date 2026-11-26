import { BrowserRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, RequireCurator } from './auth';
import { Shell } from './components/layout';
import { CommandPalette } from './components/palette';
import { ToastProvider } from './components/ui';
import { ComparePage } from './pages/compare';
import { Dashboard } from './pages/dashboard';
import { Gallery } from './pages/gallery';
import { Guide } from './pages/guide';
import { Home } from './pages/home';
import { JobPage, JobsPage } from './pages/jobs';
import { Kiosk } from './pages/kiosk';
import { Embed, Login, NotFound } from './pages/misc';
import { ConditionReport } from './pages/report';
import { Upload } from './pages/upload';
import { ViewerPage } from './pages/viewerpage';
import './styles.css';

/** A new page starts at the top, as people expect from a normal website. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0); // Braces matter: scrollTo returns a Promise in current Chrome, and an effect may only return a cleanup function.
  }, [pathname]);
  return null;
}

/** A fresh object page per object, so nothing (a draft note, a tour, the tab) carries over to the next. */
function ObjectRoute() {
  const { id } = useParams();
  return <ViewerPage key={id} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <CommandPalette />
          <Routes>
            <Route path="/embed/:id" element={<Embed />} />
            <Route path="/kiosk" element={<Kiosk />} />
            <Route path="/objects/:id/report" element={<ConditionReport />} />
            <Route element={<Shell footer={false} />}>
              <Route path="/objects/:id" element={<ObjectRoute />} />
              <Route path="/compare" element={<ComparePage />} />
            </Route>
            <Route element={<Shell />}>
              <Route path="/" element={<Home />} />
              <Route path="/collection" element={<Gallery />} />
              <Route path="/guide" element={<Guide />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/create"
                element={
                  <RequireCurator>
                    <Upload />
                  </RequireCurator>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <RequireCurator>
                    <Dashboard />
                  </RequireCurator>
                }
              />
              <Route
                path="/jobs"
                element={
                  <RequireCurator>
                    <JobsPage />
                  </RequireCurator>
                }
              />
              <Route
                path="/jobs/:id"
                element={
                  <RequireCurator>
                    <JobPage />
                  </RequireCurator>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

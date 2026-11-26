import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, RequireCurator } from './auth';
import { Shell } from './components/layout';
import { ToastProvider } from './components/ui';
import { Gallery } from './pages/gallery';
import { Guide } from './pages/guide';
import { Home } from './pages/home';
import { JobPage, JobsPage } from './pages/jobs';
import { Embed, Login, NotFound } from './pages/misc';
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <Routes>
            <Route path="/embed/:id" element={<Embed />} />
            <Route element={<Shell footer={false} />}>
              <Route path="/objects/:id" element={<ViewerPage />} />
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

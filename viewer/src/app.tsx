import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Gallery } from './pages/gallery';
// import { Login } from './pages/login';
// import { Upload } from './pages/upload';
import { ViewerPage } from './pages/viewerpage';
import './app.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <header className="header">
          <div className="logo">
            <span className="icon-placeholder">⬡</span> Browser-Based Photogrammetry and 3D Model Viewer
          </div>

          <nav className="navigation">
            <Link to="/" className="nav-btn">Gallery</Link>
            <Link to="/upload" className="nav-btn">Upload / Status</Link>
          </nav>

          <div className="user-profile">
            <div className="user-info">
              <span className="user-name">Mara Chen</span>
              <span className="user-role">Curator</span>
            </div>
            <div className="avatar">MC</div>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Gallery />} />
            {/* <Route path="/login" element={<Login />} />
            <Route path="/upload" element={<Upload />} /> */}
            <Route path="/viewer" element={<ViewerPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
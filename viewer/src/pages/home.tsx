import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon, type IconName } from '../components/icon';
import { ModelStage } from '../components/model-stage';
import { useAsync, useDocumentTitle, useReveal } from '../components/ui';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'camera',
    title: 'Capture',
    text: 'Walk around the object with any camera and take 30 to 80 overlapping photos. The capture guide shows how.',
  },
  {
    icon: 'layers',
    title: 'Reconstruct',
    text: 'Upload the set. COLMAP finds the cameras, measures depth and builds a coloured surface, which is then cleaned, turned upright and compressed.',
  },
  {
    icon: 'eye',
    title: 'Explore',
    text: 'Open the model in any modern browser. Turn it, measure it, pin notes to it, relight it and share the exact view.',
  },
];

interface Feature {
  icon: IconName;
  title: string;
  text: string;
  /** A screenshot in public/showcase, captured by scripts/screenshots.mjs. */
  image?: string;
  alt?: string;
  /** Which part of the image to keep when the tile crops it: 'top', 'bottom' or the centre. */
  focus?: 'top' | 'bottom';
  wide?: boolean;
  /** The whole row, for the one image a section leads with. */
  full?: boolean;
  dark?: boolean;
}

const SHOWCASE = `${import.meta.env.BASE_URL}showcase/`;

const VIEWER_FEATURES: Feature[] = [
  { icon: 'ruler', title: 'Measure true distances', text: 'Click two points on the surface. With the real height given at upload, the ruler reads millimetres.', image: 'measure.jpg', alt: 'A distance measured across the eagle sculpture', wide: true, dark: true },
  { icon: 'pin', title: 'Notes on the surface', text: 'Pin findings where they are, by category. Each note flies the camera to its spot; a tour plays them in order.', image: 'notes.jpg', alt: 'The camera close to a note pinned on the eagle’s wing', wide: true },
  { icon: 'sphere', title: 'Inspect the shape', text: 'Clay, wireframe and normal views, overall dimensions and model statistics, one key press each.', image: 'inspect.jpg', alt: 'The eagle in clay mode inside its labelled bounding box', wide: true },
  { icon: 'raking', title: 'Raking light', text: 'A low light from one side, as conservators use it, sweeps around to reveal relief and tool marks.', image: 'raking.jpg', alt: 'The eagle lit by a low raking light that throws long shadows', wide: true },
  { icon: 'section', title: 'Look inside', text: 'A section plane cuts the model open along any axis, and keeps the other side on request.' },
  { icon: 'share', title: 'Share and embed', text: 'A short link restores the camera and lighting. One iframe puts the viewer on any page.' },
  { icon: 'chip', title: 'Built for the GPU in every browser', text: 'WebGPU where available, WebGL 2 everywhere else, and frames drawn only when something changes.', dark: true },
];

const MUSEUM_FEATURES: Feature[] = [
  { icon: 'file', title: 'Condition reports in one click', text: 'Four overall views and a close-up of every note, damage first and by severity, ready to print or save as a PDF.', image: 'report.jpg', alt: 'A printable condition report with views of the eagle', wide: true },
  { icon: 'columns', title: 'Compare, with one camera', text: 'Two objects side by side: turn one and the other follows. Before and after, raw and cleaned, original and copy.', image: 'compare.jpg', alt: 'The cleaned and the raw eagle scan side by side', wide: true },
  { icon: 'monitor', title: 'Kiosk mode for the gallery', text: 'An attract loop turns each object and tours its notes. A touch hands over control; a quiet spell brings the tour back.', image: 'kiosk.jpg', alt: 'The eagle presented full screen with its title', full: true, dark: true },
  { icon: 'badge', title: 'Open access, done properly', text: 'A museum record, a Creative Commons licence, a ready citation and GLB, STL or OBJ downloads where the licence allows.', wide: true },
  { icon: 'eye', title: 'Accessible by default', text: 'Text descriptions for screen readers, keyboard control, visible focus and reduced motion respected.', wide: true },
];

const TEAM_FEATURES: Feature[] = [
  { icon: 'scan', title: 'Every photo checked before upload', text: 'Blur, exposure, duplicates and resolution are checked in the browser, so a weak photo is caught in a second, not after an hour.', image: 'photo-check.jpg', alt: 'Uploaded photos with the blurry and duplicate ones flagged', focus: 'bottom', wide: true },
  { icon: 'chart', title: 'A dashboard for the collection', text: 'Published objects, visits, notes, reconstruction times and storage at a glance.', image: 'dashboard.jpg', alt: 'The curator dashboard with charts of reconstructions and storage', focus: 'top', wide: true },
  { icon: 'search', title: 'Search everything with ⌘K', text: 'Objects by title or accession number, pages and actions, from any screen.', wide: true },
  { icon: 'layers', title: 'Reconstruction you can follow', text: 'Every stage, its time and the full log, with cancel and retry.', wide: true },
];

function FeatureTile({ feature }: { feature: Feature }) {
  return (
    <article className={`tile reveal ${feature.wide ? 'tile-wide' : ''} ${feature.full ? 'tile-full' : ''} ${feature.dark ? 'tile-dark' : ''} ${feature.image ? 'tile-media' : ''}`}>
      {feature.image ? (
        <div className="tile-image">
          <img src={`${SHOWCASE}${feature.image}`} alt={feature.alt ?? ''} loading="lazy" decoding="async" style={feature.focus ? { objectPosition: `center ${feature.focus}` } : undefined} />
        </div>
      ) : (
        <Icon name={feature.icon} className="tile-icon" />
      )}
      <div className="tile-copy">
        <h3>{feature.title}</h3>
        <p>{feature.text}</p>
      </div>
    </article>
  );
}

const AUDIENCES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'museum', title: 'Museums and archives', text: 'Publish a collection in 3D without a scanning lab. Visitors explore from home; curators annotate what matters.' },
  { icon: 'flask', title: 'Conservation and research', text: 'Measure cracks and losses, record condition with pinned notes and compare the same view over time.' },
  { icon: 'school', title: 'Teaching', text: 'Share a view of a detail with a whole class in one link, or embed objects in course pages.' },
];

export function Home() {
  useDocumentTitle('');
  useReveal();
  const { user } = useAuth();
  const featured = useAsync(async () => {
    const page = await api.objects({ sort: 'oldest', page_size: 12 });
    return page.items.find((o) => o.model_format === 'gltf' && o.title === 'Eagle') ?? page.items.find((o) => o.model_format === 'gltf') ?? null;
  }, []);
  const object = featured.data;

  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="eyebrow">Browser-based photogrammetry</p>
          <h1 className="hero-title">
            Photos in. <span className="gradient">Museum‑grade 3D</span> out.
          </h1>
          <p className="hero-lede">
            Vitrine turns a set of ordinary photos into an accurate, measurable 3D model, and gives every visitor a studio to explore it, right in the browser.
          </p>
          <div className="hero-actions">
            <Link to="/collection" className="btn">
              Explore the collection
            </Link>
            <a href="#how" className="link-arrow">
              See how it works <Icon name="chevronRight" />
            </a>
          </div>
        </div>
        <div className="container">
          <div className="showcase" aria-label="Featured 3D model">
            {object ? (
              <>
                <ModelStage url={object.model_url} format={object.model_format} up={object.up} label={`3D view of ${object.title}`} autoRotate cooperative />
                <div className="showcase-caption">
                  <strong>{object.title}</strong>
                  <span>Reconstructed with our pipeline · drag to turn</span>
                </div>
                <Link to={`/objects/${object.id}`} className="btn btn-sm showcase-cta">
                  Open in viewer
                </Link>
              </>
            ) : (
              <div className="stage-loading">{featured.loading ? <div className="ring" data-indeterminate /> : <span>The collection is empty.</span>}</div>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container stats reveal">
          <div className="stat">
            <strong>97%</strong>
            <span>smaller model files after clean-up and compression (90.7 MB to 2.2 MB)</span>
          </div>
          <div className="stat">
            <strong>3.2 M</strong>
            <span>raw triangles reduced to 300 k with the colours kept</span>
          </div>
          <div className="stat">
            <strong>60 fps</strong>
            <span>on the full raw scan, on WebGPU and on WebGL 2, on a desktop GPU</span>
          </div>
          <div className="stat">
            <strong>0</strong>
            <span>plug-ins or installs for visitors</span>
          </div>
        </div>
      </section>

      <section id="how" className="section section-alt">
        <div className="container">
          <div className="section-head reveal">
            <p className="eyebrow">How it works</p>
            <h2 className="section-title">Three steps from object to experience.</h2>
          </div>
          <div className="steps">
            {STEPS.map((step, index) => (
              <article key={step.title} className="step reveal">
                <span className="step-number">Step {index + 1}</span>
                <span className="step-icon">
                  <Icon name={step.icon} />
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head reveal">
            <p className="eyebrow">The viewer</p>
            <h2 className="section-title">A professional studio. In a browser tab.</h2>
            <p className="section-lede">Everything a curator or researcher needs to inspect an object, and nothing in the way of a first-time visitor.</p>
          </div>
          <div className="bento">
            {VIEWER_FEATURES.map((feature) => (
              <FeatureTile key={feature.title} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head reveal">
            <p className="eyebrow">For museums</p>
            <h2 className="section-title">Built for collections, not just models.</h2>
            <p className="section-lede">Condition reports, comparisons and gallery screens come with the viewer, and so do the rights and records a collection keeps.</p>
          </div>
          <div className="bento">
            {MUSEUM_FEATURES.map((feature) => (
              <FeatureTile key={feature.title} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head reveal">
            <p className="eyebrow">For your team</p>
            <h2 className="section-title">From photos to a published object, in one place.</h2>
          </div>
          <div className="bento">
            {TEAM_FEATURES.map((feature) => (
              <FeatureTile key={feature.title} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head reveal">
            <p className="eyebrow">Who it is for</p>
            <h2 className="section-title">Made for the people who look closest.</h2>
          </div>
          <div className="audiences">
            {AUDIENCES.map((audience) => (
              <article key={audience.title} className="audience reveal">
                <span className="step-icon">
                  <Icon name={audience.icon} />
                </span>
                <h3>{audience.title}</h3>
                <p>{audience.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-dark">
        <div className="container cta-band reveal">
          <h2 className="section-title">Start your first scan.</h2>
          <p className="section-lede muted">Read the two-minute capture guide, take your photos, and upload them.</p>
          <div className="hero-actions" style={{ marginTop: 8 }}>
            <Link to={user ? '/create' : '/login?next=/create'} className="btn">
              {user ? 'New scan' : 'Sign in to upload'}
            </Link>
            <Link to="/guide" className="link-arrow" style={{ color: '#2997ff' }}>
              Capture guide <Icon name="chevronRight" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

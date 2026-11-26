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

const FEATURES: { icon: IconName; title: string; text: string; wide?: boolean; dark?: boolean }[] = [
  { icon: 'ruler', title: 'Measure true distances', text: 'Click two points on the surface. With the real height given at upload, 1 unit is 1 metre.', wide: true, dark: true },
  { icon: 'pin', title: 'Notes on the surface', text: 'Pin findings where they are. Each note flies the camera to its spot.', wide: true },
  { icon: 'sun', title: 'Studio lighting', text: 'Studio, outdoor and room light, exposure and a movable key light.' },
  { icon: 'section', title: 'Look inside', text: 'A section plane cuts the model open along any axis.' },
  { icon: 'share', title: 'Share the exact view', text: 'A short link restores the camera and lighting you chose.' },
  { icon: 'code', title: 'Embed anywhere', text: 'One iframe puts the viewer on a museum page, a course or a shop.', wide: true },
  { icon: 'chip', title: 'Built for the GPU in every browser', text: 'WebGPU where available, WebGL 2 everywhere else, and frames drawn only when something changes.', wide: true, dark: true },
];

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
                <ModelStage url={object.model_url} format={object.model_format} up={object.up} label={`3D view of ${object.title}`} autoRotate />
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
            {FEATURES.map((feature) => (
              <article key={feature.title} className={`tile reveal ${feature.wide ? 'tile-wide' : ''} ${feature.dark ? 'tile-dark' : ''}`}>
                <Icon name={feature.icon} className="tile-icon" />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
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

import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Icon, type IconName } from '../components/icon';
import { useDocumentTitle, useReveal } from '../components/ui';

const TIPS: { icon: IconName; title: string; points: string[] }[] = [
  {
    icon: 'orbit',
    title: 'Walk a full circle, three times',
    points: [
      'Circle the object at three heights: low, eye level and from above.',
      'Take a photo every 10 to 15 degrees, so 25 to 35 per circle.',
      'Each spot on the surface should appear in at least two sharp photos, and more is better.',
    ],
  },
  {
    icon: 'layers',
    title: 'Overlap every photo',
    points: [
      'Neighbouring photos should share about two thirds of what they show.',
      'Move the camera between shots; turning on the spot adds no depth.',
      'Finish with a few close-ups of fine detail, still overlapping the rest.',
    ],
  },
  {
    icon: 'sun',
    title: 'Soft, even light',
    points: [
      'An overcast sky or a room with diffuse light works best.',
      'Avoid hard shadows and moving light: they change between photos.',
      'Do not use the flash; it moves with the camera.',
    ],
  },
  {
    icon: 'aperture',
    title: 'Sharp, consistent photos',
    points: [
      'Hold still or use a tripod; blurry photos are dropped or add noise.',
      'Keep the same zoom for the whole set, and do not crop or edit photos.',
      'Fill most of the frame with the object; the background can be busy.',
    ],
  },
  {
    icon: 'ruler',
    title: 'Get the real size',
    points: [
      'Measure the object’s height with a ruler or calliper before you start.',
      'Enter it as “Real height” when you upload, and the ruler shows true millimetres.',
      'Measure from the lowest to the highest point as the object stands.',
    ],
  },
  {
    icon: 'box',
    title: 'Pick a good subject',
    points: [
      'Matte, textured surfaces reconstruct best: stone, wood, clay, fabric.',
      'Shiny, transparent or plain single-colour surfaces are hard for any photogrammetry.',
      'The object must not move or change between photos.',
    ],
  },
];

export function Guide() {
  useDocumentTitle('Capture guide');
  useReveal();
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">Capture guide</p>
          <h1 className="page-title">Great models start with great photos.</h1>
          <p className="page-lede">Two minutes of reading saves an hour of reconstruction. Any recent phone or camera is enough.</p>
        </header>

        <div className="guide-grid">
          {TIPS.map((tip, index) => (
            <article key={tip.title} className="guide-card reveal">
              <span className="step-icon">
                <Icon name={tip.icon} />
              </span>
              <span className="step-number">{index + 1}</span>
              <h3>{tip.title}</h3>
              <ul>
                {tip.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="dos" style={{ marginTop: 56 }}>
          <section className="do-card good reveal">
            <h3>
              <Icon name="check" /> Do
            </h3>
            <ul>
              <li>30 to 80 photos for an object, more for a large or detailed one</li>
              <li>JPEG or PNG straight from the camera</li>
              <li>Photos of one object only per upload</li>
              <li>A zip file when the set is large</li>
            </ul>
          </section>
          <section className="do-card bad reveal">
            <h3>
              <Icon name="x" /> Avoid
            </h3>
            <ul>
              <li>HEIC, RAW or WebP files: convert them to JPEG first</li>
              <li>Screenshots, filters, panoramas or portrait-mode blur</li>
              <li>People or things moving through the scene</li>
              <li>Fewer than 20 photos, which leaves holes</li>
            </ul>
          </section>
        </div>

        <div className="cta-band" style={{ marginTop: 72 }}>
          <h2 className="section-title" style={{ fontSize: 40 }}>
            Ready?
          </h2>
          <Link to={user ? '/create' : '/login?next=/create'} className="btn">
            {user ? 'Start a new scan' : 'Sign in to upload'}
          </Link>
        </div>
      </div>
    </div>
  );
}

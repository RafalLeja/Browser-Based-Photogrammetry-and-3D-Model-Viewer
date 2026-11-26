// HTML layer over the canvas for pins, ruler lines and labels. HTML stays crisp at any pixel
// ratio, can be styled by the page, and pins are real buttons for keyboard and screen readers.
// The viewer projects the points; this file only places elements. Class names are public:
// .vw-overlay .vw-pin .vw-measure .vw-measure-label .vw-dot (states via data-* attributes).

export interface ScreenPoint {
  x: number;
  y: number;
  /** False when the point is behind the camera. */
  visible: boolean;
}

export interface PinView {
  id: string;
  title: string;
  point: ScreenPoint;
  occluded: boolean;
}

export interface MeasureView {
  id: string;
  a: ScreenPoint;
  b: ScreenPoint;
  label: string;
  pending?: boolean;
}

const STYLE_ID = 'vw-default-styles';

// :where() keeps specificity at zero, so any page rule wins over these defaults.
const DEFAULT_CSS = `
:where(.vw-overlay){position:absolute;inset:0;pointer-events:none;overflow:hidden;font:500 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif}
:where(.vw-svg){position:absolute;inset:0;width:100%;height:100%}
:where(.vw-measure){stroke:#fff;stroke-width:2;stroke-linecap:round;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
:where(.vw-measure[data-pending]){stroke-dasharray:6 5}
:where(.vw-dot){position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.45)}
:where(.vw-measure-label){position:absolute;transform:translate(-50%,-140%);padding:4px 8px;border-radius:999px;background:rgba(20,20,22,.82);color:#fff;white-space:nowrap;backdrop-filter:blur(8px)}
:where(.vw-pin){position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border:2px solid #fff;border-radius:50%;background:rgba(20,20,22,.85);color:#fff;font:600 12px/24px system-ui,sans-serif;text-align:center;cursor:pointer;pointer-events:auto;padding:0;transition:transform .15s ease,opacity .2s ease}
:where(.vw-pin:hover),:where(.vw-pin[data-active]){transform:scale(1.15);background:#0071e3}
:where(.vw-pin[data-occluded]){opacity:.35}
:where(.vw-pin:focus-visible){outline:3px solid #0071e3;outline-offset:2px}
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DEFAULT_CSS;
  document.head.prepend(style); // First, so page styles loaded later win at equal specificity.
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function place(element: HTMLElement, point: ScreenPoint): void {
  element.hidden = !point.visible;
  element.style.left = `${point.x}px`;
  element.style.top = `${point.y}px`;
}

interface MeasureElements {
  line: SVGLineElement;
  a: HTMLDivElement;
  b: HTMLDivElement;
  label: HTMLDivElement;
}

export class Overlay {
  readonly root = document.createElement('div');
  private readonly svg = document.createElementNS(SVG_NS, 'svg');
  private readonly pins = new Map<string, HTMLButtonElement>();
  private readonly measures = new Map<string, MeasureElements>();
  private activePin: string | null = null;

  constructor(container: HTMLElement, onPinClick: (id: string) => void) {
    ensureStyles();
    this.root.className = 'vw-overlay';
    this.svg.setAttribute('class', 'vw-svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.root.append(this.svg);
    container.append(this.root);
    this.root.addEventListener('click', (event) => {
      const pin = (event.target as HTMLElement).closest<HTMLButtonElement>('.vw-pin');
      if (pin?.dataset.id) onPinClick(pin.dataset.id);
    });
  }

  /** Creates or removes pin buttons so they match `pins`, numbered in list order. */
  syncPins(pins: { id: string; title: string }[]): void {
    const wanted = new Set(pins.map((p) => p.id));
    for (const [id, element] of this.pins) {
      if (!wanted.has(id)) {
        element.remove();
        this.pins.delete(id);
      }
    }
    pins.forEach((pin, index) => {
      let element = this.pins.get(pin.id);
      if (!element) {
        element = document.createElement('button');
        element.type = 'button';
        element.className = 'vw-pin';
        element.dataset.id = pin.id;
        this.root.append(element);
        this.pins.set(pin.id, element);
      }
      element.textContent = String(index + 1);
      element.setAttribute('aria-label', `Annotation ${index + 1}: ${pin.title}`);
      element.title = pin.title;
      element.toggleAttribute('data-active', pin.id === this.activePin);
    });
  }

  setActivePin(id: string | null): void {
    this.activePin = id;
    for (const [pinId, element] of this.pins) element.toggleAttribute('data-active', pinId === id);
  }

  render(pins: PinView[], measures: MeasureView[]): void {
    for (const pin of pins) {
      const element = this.pins.get(pin.id);
      if (!element) continue;
      place(element, pin.point);
      element.toggleAttribute('data-occluded', pin.occluded);
    }

    const wanted = new Set(measures.map((m) => m.id));
    for (const [id, elements] of this.measures) {
      if (!wanted.has(id)) {
        elements.line.remove();
        elements.a.remove();
        elements.b.remove();
        elements.label.remove();
        this.measures.delete(id);
      }
    }
    for (const measure of measures) {
      const elements = this.measures.get(measure.id) ?? this.createMeasure(measure.id);
      const visible = measure.a.visible && measure.b.visible;
      elements.line.setAttribute('x1', String(measure.a.x));
      elements.line.setAttribute('y1', String(measure.a.y));
      elements.line.setAttribute('x2', String(measure.b.x));
      elements.line.setAttribute('y2', String(measure.b.y));
      elements.line.style.display = visible ? '' : 'none';
      elements.line.toggleAttribute('data-pending', measure.pending === true);
      place(elements.a, measure.a);
      place(elements.b, measure.b);
      if (elements.label.textContent !== measure.label) elements.label.textContent = measure.label;
      place(elements.label, {
        x: (measure.a.x + measure.b.x) / 2,
        y: (measure.a.y + measure.b.y) / 2,
        visible: visible && measure.label !== '',
      });
    }
  }

  dispose(): void {
    this.root.remove();
    this.pins.clear();
    this.measures.clear();
  }

  private createMeasure(id: string): MeasureElements {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'vw-measure');
    this.svg.append(line);
    const dot = () => {
      const element = document.createElement('div');
      element.className = 'vw-dot';
      this.root.append(element);
      return element;
    };
    const label = document.createElement('div');
    label.className = 'vw-measure-label';
    const elements = { line, a: dot(), b: dot(), label };
    this.root.append(label);
    this.measures.set(id, elements);
    return elements;
  }
}

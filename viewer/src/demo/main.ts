// Demo page. It imports only the public API and lil-gui, never three,
// which proves the API is enough for a real frontend.
import GUI from 'lil-gui';

import { createViewer } from '../index';
import type { EnvironmentOptions, ToneMappingName } from '../index';

const BASE = import.meta.env.BASE_URL;
const STUDIO_HDR = `${BASE}hdr/studio_small_09_1k.hdr`;

const MODELS: Record<string, string> = {
  DamagedHelmet: `${BASE}models/DamagedHelmet.glb`,
  'eagle (raw scan)': `${BASE}models/eagle.glb`,
};

const ENVIRONMENTS: Record<string, EnvironmentOptions> = {
  'Studio HDR': { hdrUrl: STUDIO_HDR },
  Room: { preset: 'room' },
  None: { preset: 'none' },
};

const TONE_MAPPINGS: ToneMappingName[] = ['neutral', 'aces', 'agx', 'none'];

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing element ${selector} in index.html`);
  return element;
}

const statusPanel = requireElement('#status');
const status = { backend: '…', load: '–', triangles: '–', size: '–', error: '' };

function renderStatus(): void {
  const rows = [
    `Backend: ${status.backend}`,
    `Load: ${status.load}`,
    `Triangles: ${status.triangles}`,
    `Size: ${status.size}`,
  ].map((text) => {
    const row = document.createElement('div');
    row.textContent = text;
    return row;
  });

  if (status.error) {
    const row = document.createElement('div');
    row.className = 'error';
    row.textContent = `Error: ${status.error}`;
    rows.push(row);
  }
  statusPanel.replaceChildren(...rows);
}

function showError(message: string): void {
  status.error = message;
  renderStatus();
}

/** Rejections are already shown through the viewer's "error" event. */
function ignoreRejection(): void {}

async function main(): Promise<void> {
  renderStatus();

  const viewer = await createViewer(requireElement('#stage'), {
    forceWebGL: new URLSearchParams(location.search).has('webgl'),
    environment: { hdrUrl: STUDIO_HDR, showBackground: false },
  });

  status.backend = viewer.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';
  renderStatus();

  viewer.on('progress', ({ loaded, total }) => {
    status.load = total ? `${Math.round((loaded / total) * 100)}%` : 'loading…';
    renderStatus();
  });
  viewer.on('loaded', ({ triangles, size }) => {
    status.load = '100%';
    status.triangles = triangles.toLocaleString('en-GB');
    status.size = `${size.map((value) => value.toFixed(3)).join(' × ')} units`;
    renderStatus();
  });
  viewer.on('error', ({ message }) => showError(message));

  const params = {
    model: 'DamagedHelmet',
    environment: 'Studio HDR',
    showBackground: false,
    intensity: 1,
    toneMapping: 'neutral' as ToneMappingName,
    exposure: 1,
    keyLight: 1,
    testMeasure: () => viewer.enableMeasure(true),
    testPin: () =>
      viewer.addPin({ id: 'test', position: [0, 0, 0], normal: [0, 1, 0], title: 'Test' }),
  };

  const gui = new GUI({ title: 'Viewer controls' });
  gui
    .add(params, 'model', Object.keys(MODELS))
    .name('Model')
    .onChange((name: string) => {
      viewer.load(MODELS[name]).catch(ignoreRejection);
    });
  gui
    .add(params, 'environment', Object.keys(ENVIRONMENTS))
    .name('Environment')
    .onChange((name: string) => {
      viewer.setEnvironment(ENVIRONMENTS[name]).catch(ignoreRejection);
    });
  gui
    .add(params, 'showBackground')
    .name('Show background')
    .onChange((showBackground: boolean) => {
      viewer.setEnvironment({ showBackground }).catch(ignoreRejection);
    });
  gui
    .add(params, 'intensity', 0, 3, 0.01)
    .name('Environment intensity')
    .onChange((intensity: number) => {
      viewer.setEnvironment({ intensity }).catch(ignoreRejection);
    });
  gui
    .add(params, 'toneMapping', TONE_MAPPINGS)
    .name('Tone mapping')
    .onChange((toneMapping: ToneMappingName) => viewer.setLighting({ toneMapping }));
  gui
    .add(params, 'exposure', 0, 3, 0.01)
    .name('Exposure')
    .onChange((exposure: number) => viewer.setLighting({ exposure }));
  gui
    .add(params, 'keyLight', 0, 5, 0.01)
    .name('Key light intensity')
    .onChange((intensity: number) => viewer.setLighting({ keyLight: { intensity } }));
  gui.add(params, 'testMeasure').name('Test measure (stub)');
  gui.add(params, 'testPin').name('Test pin (stub)');

  await viewer.load(MODELS[params.model]);
}

main().catch((err: unknown) => {
  showError(err instanceof Error ? err.message : String(err));
});

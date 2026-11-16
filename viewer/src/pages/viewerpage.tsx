// Demo page. It imports only the public API and lil-gui, never three,
// which proves the API is enough for a real frontend.
import { useEffect, useRef } from 'react';
import GUI from 'lil-gui';
import { createViewer } from '../index';
import type { EnvironmentOptions, ToneMappingName, Viewer } from '../index';

const BASE = import.meta.env.BASE_URL;
const STUDIO_HDR = `${BASE}hdr/studio_small_09_1k.hdr`;

const MODELS: Record<string, string> = {
  DamagedHelmet: `${BASE}models/DamagedHelmet.glb`,
  'eagle (raw scan)': `${BASE}models/eagle.glb`,
  // On purpose: shows what a failed download looks like.
  'missing file (error test)': `${BASE}models/does-not-exist.glb`,
};

const ENVIRONMENTS: Record<string, EnvironmentOptions> = {
  'Studio HDR': { hdrUrl: STUDIO_HDR },
  Room: { preset: 'room' },
  None: { preset: 'none' },
};

const TONE_MAPPINGS: ToneMappingName[] = ['neutral', 'aces', 'agx', 'none'];

export function ViewerPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stageRef.current || !statusRef.current || !containerRef.current) return;

    // StrictMode runs this effect twice in development, so each run cleans up after itself.
    let disposed = false;
    let activeViewer: Viewer | null = null;
    let gui: GUI | null = null;
    const stage = stageRef.current;
    const container = containerRef.current;
    const statusPanel = statusRef.current;
    const statusObj = { backend: '…', model: '–', load: '–', triangles: '–', size: '–', error: '' };

    function renderStatus(): void {
      const rows = [
        `Backend: ${statusObj.backend}`,
        `Model: ${statusObj.model}`,
        `Load: ${statusObj.load}`,
        `Triangles: ${statusObj.triangles}`,
        `Size: ${statusObj.size}`,
        'Tip: drop a .glb file on the page',
      ].map((text) => {
        const row = document.createElement('div');
        row.textContent = text;
        return row;
      });

      if (statusObj.error) {
        const row = document.createElement('div');
        row.className = 'error';
        row.textContent = statusObj.error;
        rows.push(row);
      }
      statusPanel.replaceChildren(...rows);
    }

    function showError(message: string): void {
      statusObj.error = message;
      renderStatus();
    }

    /** Rejections are already shown through the viewer's "error" event. */
    function ignoreRejection(): void { }

    // Without preventDefault on both events the browser opens the dropped file itself and
    // leaves the page, also when the drop misses the canvas.
    function onDragOver(event: DragEvent): void {
      event.preventDefault();
    }
    function onDrop(event: DragEvent): void {
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (!file || !activeViewer) return;
      statusObj.model = file.name;
      renderStatus();
      // The object URL points at the file in memory. A .glb carries its textures inside, so
      // nothing needs the URL once the load has settled.
      const url = URL.createObjectURL(file);
      activeViewer
        .load(url)
        .catch(ignoreRejection)
        .finally(() => URL.revokeObjectURL(url));
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);

    async function init() {
      renderStatus();

      const viewer = await createViewer(stage, {
        forceWebGL: new URLSearchParams(location.search).has('webgl'),
        environment: { hdrUrl: STUDIO_HDR, showBackground: false },
      });
      if (disposed) {
        viewer.dispose(); // The page was left while the viewer was starting.
        return;
      }
      activeViewer = viewer;

      statusObj.backend = viewer.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';
      renderStatus();

      viewer.on('progress', ({ loaded, total }) => {
        statusObj.load = total ? `${Math.round((loaded / total) * 100)}%` : 'loading…';
        renderStatus();
      });
      viewer.on('loaded', ({ triangles, size }) => {
        statusObj.load = '100%';
        statusObj.triangles = triangles.toLocaleString('en-GB');
        statusObj.size = `${size.map((value) => value.toFixed(3)).join(' × ')} units`;
        statusObj.error = ''; // A model that loads replaces any earlier error.
        renderStatus();
      });
      viewer.on('error', ({ code, httpStatus, message }) => {
        const what = httpStatus === undefined ? code : `${code}, HTTP ${httpStatus}`;
        showError(`Error (${what}): ${message}`);
      });

      const params = {
        model: 'DamagedHelmet',
        environment: 'Studio HDR',
        showBackground: false,
        intensity: 1,
        toneMapping: 'neutral' as ToneMappingName,
        exposure: 1,
        keyLight: 1,
        groundShadow: 0.5,
        autoRotate: false,
        resetView: () => viewer.resetView(),
        testMeasure: () => viewer.enableMeasure(true),
        testPin: () =>
          viewer.addPin({ id: 'test', position: [0, 0, 0], normal: [0, 1, 0], title: 'Test' }),
      };

      // Ensure GUI is attached to our specific container, not the document body
      gui = new GUI({ title: 'Viewer controls', container });
      gui.domElement.style.position = 'absolute';
      gui.domElement.style.top = '20px';
      gui.domElement.style.right = '20px';
      gui.add(params, 'model', Object.keys(MODELS)).name('Model').onChange((name: string) => {
        statusObj.model = name;
        renderStatus();
        viewer.load(MODELS[name]).catch(ignoreRejection);
      });
      gui.add(params, 'environment', Object.keys(ENVIRONMENTS)).name('Environment').onChange((name: string) => {
        params.showBackground = true;
        gui!.controllersRecursive().forEach(c => c.updateDisplay());
        viewer.setEnvironment({
          ...ENVIRONMENTS[name],
          showBackground: true
        }).catch(ignoreRejection);
      });
      gui.add(params, 'showBackground')
        .name('Show background')
        .onChange((showBackground: boolean) => {
          viewer.setEnvironment({ showBackground }).catch(ignoreRejection);
        });
      gui.add(params, 'intensity', 0, 3, 0.01).name('Environment intensity').onChange((intensity: number) => {
        viewer.setEnvironment({ intensity }).catch(ignoreRejection);
      });
      gui.add(params, 'toneMapping', TONE_MAPPINGS).name('Tone mapping').onChange((toneMapping: ToneMappingName) => viewer.setLighting({ toneMapping }));
      gui.add(params, 'exposure', 0, 3, 0.01).name('Exposure').onChange((exposure: number) => viewer.setLighting({ exposure }));
      gui.add(params, 'keyLight', 0, 5, 0.01).name('Key light intensity').onChange((intensity: number) => viewer.setLighting({ keyLight: { intensity } }));
      gui.add(params, 'groundShadow', 0, 1, 0.01).name('Ground shadow').onChange((opacity: number) => viewer.setLighting({ groundShadow: { opacity } }));
      gui.add(params, 'autoRotate').name('Auto-rotate').onChange((on: boolean) => viewer.setAutoRotate(on));
      gui.add(params, 'resetView').name('Reset view');
      gui.add(params, 'testMeasure').name('Test measure (stub)');
      gui.add(params, 'testPin').name('Test pin (stub)');

      // A failure here is shown by the "error" listener; a cancelled load is not a failure.
      statusObj.model = params.model;
      renderStatus();
      await viewer.load(MODELS[params.model]).catch(ignoreRejection);
    }

    init().catch((err: unknown) => {
      showError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });

    return () => {
      disposed = true;
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      gui?.destroy();
      activeViewer?.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: 'calc(100vh - 80px)', minHeight: '600px', backgroundColor: '#222' }}>
      <div ref={statusRef} id="status" style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(0,0,0,0.7)', color: 'white', padding: '10px', borderRadius: '4px' }}></div>
      <div ref={stageRef} id="stage" style={{ width: '100%', height: '100%' }}></div>
    </div>
  );
}

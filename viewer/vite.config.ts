import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The dev server answers an unknown path with index.html, so the frontend's client-side routes
 * (such as /viewer) survive a page reload. For a missing model or HDR file that hides the real
 * problem: the viewer would receive a web page and report "could not be read" instead of 404.
 * This answers 404 for those files, as a real static host does.
 */
function missingAssetsAre404(): Plugin {
  return {
    name: 'missing-assets-are-404',
    configureServer(server) {
      // Returning a function runs it after Vite's own middlewares: files that exist have been
      // served by then, and only the index.html fallback is left.
      return () => {
        server.middlewares.use((req, res, next) => {
          const path = (req.originalUrl ?? '').split('?')[0];
          if (!/\.(glb|gltf|bin|hdr)$/i.test(path)) return next();
          res.statusCode = 404;
          res.end();
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [missingAssetsAre404()],
  build: {
    // Two pages ship from one build: the frontend (index.html) and the viewer test page.
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        demo: resolve(import.meta.dirname, 'demo.html'),
      },
    },
  },
});

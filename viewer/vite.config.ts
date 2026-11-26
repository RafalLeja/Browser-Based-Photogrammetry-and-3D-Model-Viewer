import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const API_TARGET = process.env.VITRINE_API ?? 'http://127.0.0.1:8000';

/**
 * The dev server answers an unknown path with index.html, so the frontend's client-side routes
 * (such as /objects/3) survive a page reload. For a missing model or HDR file that hides the real
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
          if (!/\.(glb|gltf|bin|hdr|ply|wasm)$/i.test(path)) return next();
          res.statusCode = 404;
          res.end();
        });
      };
    },
  };
}

/** Copies three's Draco and Basis decoders into public/decoders, where the viewer fetches them. */
function decoders(): Plugin {
  const copy = () => {
    const libs = fileURLToPath(new URL('./node_modules/three/examples/jsm/libs/', import.meta.url));
    const out = fileURLToPath(new URL('./public/decoders/', import.meta.url));
    if (!existsSync(`${out}draco/draco_decoder.wasm`)) cpSync(`${libs}draco/gltf`, `${out}draco`, { recursive: true });
    if (!existsSync(`${out}basis/basis_transcoder.wasm`)) cpSync(`${libs}basis`, `${out}basis`, { recursive: true });
  };
  return { name: 'copy-decoders', buildStart: copy, configureServer: copy };
}

export default defineConfig({
  plugins: [decoders(), missingAssetsAre404()],
  server: {
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 1600, // three's WebGPU build is large by itself; it is split into its own chunk.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : id.includes('node_modules/react') ? 'react' : undefined),
      },
    },
  },
});

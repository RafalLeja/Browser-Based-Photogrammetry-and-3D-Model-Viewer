// Starts a throw-away API for the end-to-end tests: fresh database and storage, the demo
// pipeline with short stages, and a test curator account. Playwright stops it afterwards.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
const storage = fileURLToPath(new URL('../../backend/storage-e2e/', import.meta.url));
rmSync(storage, { recursive: true, force: true });

const env = {
  ...process.env,
  DATABASE_URL: `sqlite:///${storage.replaceAll('\\', '/')}e2e.db`,
  STORAGE_DIR: storage,
  PIPELINE: 'demo',
  DEMO_STAGE_SECONDS: '0.3',
  DEMO_MODEL: 'models/DamagedHelmet.glb',
  CURATOR_LOGIN: 'e2e-curator',
  CURATOR_PASSWORD: 'e2e-password-123',
  CORS_ORIGINS: 'http://localhost:5180',
};

const server = spawn('uv', ['run', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8010'], {
  cwd: backend,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));

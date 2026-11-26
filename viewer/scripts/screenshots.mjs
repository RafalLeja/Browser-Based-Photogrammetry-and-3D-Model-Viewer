// Captures the README screenshots from a running dev stack (npm run dev + the API).
// Usage: node scripts/screenshots.mjs [baseUrl] [login] [password]
// Pages that need a curator are skipped when no login is given.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [base = 'http://localhost:5173', login, password] = process.argv.slice(2);
const out = fileURLToPath(new URL('../../docs/images/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: `${out}${name}.png` });
const modelReady = () => page.getByTitle('Graphics backend and triangle count').waitFor({ timeout: 60_000 });

await page.goto(`${base}/`);
await page.locator('.showcase canvas').waitFor();
await page.waitForTimeout(4000);
await shot('home');

await page.goto(`${base}/collection`);
await page.locator('.card img').first().waitFor();
await page.waitForTimeout(800);
await shot('collection');

const eagle = await (await page.request.get(`${base}/api/v1/objects?q=eagle&sort=oldest`)).json();
const eagleId = eagle.items.find((o) => o.title === 'Eagle').id;
await page.goto(`${base}/objects/${eagleId}`);
await modelReady();
await page.getByRole('tab', { name: /Notes/ }).click();
await page.locator('.list-main').first().click();
await page.waitForTimeout(1500);
await shot('object-notes');

await page.getByRole('button', { name: 'Reset view' }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Measure', exact: true }).click();
const box = await page.locator('.stage canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.74);
await page.getByRole('button', { name: 'Section' }).click();
await page.waitForTimeout(800);
await shot('object-tools');

if (login && password) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Login').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${base}/collection`);
  const jobs = await (await page.request.get(`${base}/api/v1/jobs`)).json();
  if (jobs.length) {
    await page.goto(`${base}/jobs/${jobs[0].id}`);
    await page.locator('.timeline').waitFor();
    await page.waitForTimeout(600);
    await shot('job');
  }
  await page.goto(`${base}/create`);
  await page.waitForTimeout(600);
  await shot('create');
}

await browser.close();
console.log(`Screenshots written to ${out}`);

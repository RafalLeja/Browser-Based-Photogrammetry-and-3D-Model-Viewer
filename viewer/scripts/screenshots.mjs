// Captures the README screenshots (docs/images/*.jpg) and the home page's feature images
// (public/showcase/*.jpg) from a running dev stack (npm run dev + the API).
// Usage: node scripts/screenshots.mjs [baseUrl] [login] [password]
// Pages that need a curator are skipped when no login is given.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [base = 'http://localhost:5173', login, password] = process.argv.slice(2);
const docs = fileURLToPath(new URL('../../docs/images/', import.meta.url));
const showcase = fileURLToPath(new URL('../public/showcase/', import.meta.url));
mkdirSync(docs, { recursive: true });
mkdirSync(showcase, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: `${docs}${name}.jpg`, type: 'jpeg', quality: 85 });
/** A feature image for the home page: one element, at CSS size, as a compact JPEG. */
const tile = async (name, selector) => {
  // The sticky bars would cover the top of a scrolled element, so they hide for the capture.
  const style = await page.addStyleTag({ content: '.nav, .report-bar { visibility: hidden !important; }' });
  await page.locator(selector).first().screenshot({ path: `${showcase}${name}.jpg`, type: 'jpeg', quality: 82, scale: 'css' });
  await style.evaluate((element) => element.remove());
};
const modelReady = () => page.getByTitle('Graphics backend and triangle count').waitFor({ timeout: 90_000 });

const found = await (await page.request.get(`${base}/api/v1/objects?q=eagle&sort=oldest`)).json();
const eagleId = found.items.find((o) => o.title === 'Eagle').id;
const rawId = found.items.find((o) => o.title === 'Eagle (raw reconstruction)')?.id;

await page.goto(`${base}/objects/${eagleId}`);
await modelReady();
await page.getByRole('tab', { name: /Notes/ }).click();
await page.locator('.list-main').nth(1).click();
await page.waitForTimeout(1500);
await shot('object-notes');
await tile('notes', '.stage');

await page.getByRole('button', { name: 'Reset view' }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Measure', exact: true }).click();
const box = await page.locator('.stage canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.68);
await page.waitForTimeout(600);
await tile('measure', '.stage');
await page.getByRole('button', { name: 'Section' }).click();
await page.waitForTimeout(800);
await shot('object-tools');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Clear' }).click().catch(() => undefined);
await page.getByRole('button', { name: 'Section' }).click();

await page.getByRole('tab', { name: 'Inspect' }).click();
await page.getByRole('button', { name: 'Clay' }).click();
await page.getByLabel('Show overall dimensions').check();
await page.getByRole('button', { name: 'Reset view' }).click();
await page.waitForTimeout(1500);
await shot('inspect');
await tile('inspect', '.stage');
await page.getByRole('button', { name: 'Colour' }).click();
await page.getByLabel('Show overall dimensions').uncheck();

await page.getByRole('tab', { name: 'Light' }).click();
await page.getByRole('button', { name: /^Raking light/ }).click();
await page.locator('#azimuth').fill('10');
await page.waitForTimeout(1200);
await shot('raking');
await tile('raking', '.stage');

if (rawId) {
  await page.goto(`${base}/compare?a=${eagleId}&b=${rawId}`);
  await page.locator('.compare-stats').nth(1).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await shot('compare');
  await tile('compare', '.compare-panes');
}

await page.goto(`${base}/kiosk?ids=${eagleId}`);
await page.locator('.kiosk-object h1').waitFor({ timeout: 90_000 });
await page.waitForTimeout(3000);
await shot('kiosk');
await tile('kiosk', '.kiosk');

await page.goto(`${base}/objects/${eagleId}/report`);
await page.getByRole('button', { name: 'Print or save as PDF' }).and(page.locator(':enabled')).waitFor({ timeout: 120_000 });
await page.waitForTimeout(600);
await shot('report');
await tile('report', '.report-sheet');

await page.goto(`${base}/collection`);
await page.locator('.card').first().waitFor();
await page.getByRole('button', { name: /^Search/ }).click();
await page.getByRole('combobox', { name: 'Search objects, pages and actions' }).fill('eagle');
await page.getByRole('option').first().waitFor();
await page.waitForTimeout(600);
await shot('palette');
await page.keyboard.press('Escape');

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

  await page.goto(`${base}/dashboard`);
  await page.locator('.stat-tile').first().waitFor();
  await page.waitForTimeout(800);
  await shot('dashboard');
  await tile('dashboard', '.dashboard .container');

  // The photo check, with test cards drawn in the page (see e2e/features.spec.ts).
  await page.goto(`${base}/create`);
  await page.evaluate(async () => {
    const card = (size, low, high, shift) => {
      const canvas = document.createElement('canvas');
      canvas.width = size * 1.5;
      canvas.height = size;
      const g = canvas.getContext('2d');
      const cell = size / 40;
      g.fillStyle = `rgb(${low},${low},${low})`;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = `rgb(${high},${high},${high})`;
      for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) if ((x + y + shift) % 2 === 0) g.fillRect(x * cell, y * cell, cell, cell);
      g.fillStyle = 'rgb(200,80,40)';
      g.beginPath();
      g.arc(canvas.width / 2 + shift * cell * 2, size / 2, size / 4, 0, 7);
      g.fill();
      return canvas;
    };
    const photo = async (name, source, smooth) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1800;
      canvas.height = 1200;
      const g = canvas.getContext('2d');
      g.imageSmoothingEnabled = smooth;
      g.drawImage(source, 0, 0, 1800, 1200);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      return new File([blob], name, { type: 'image/jpeg' });
    };
    const files = [];
    for (let i = 0; i < 9; i++) files.push(await photo(`IMG_${1040 + i}.jpg`, card(400, 30, 220, i), false));
    files.push(await photo('IMG_1049.jpg', card(40, 30, 220, 1), true));
    files.push(await photo('IMG_1050.jpg', card(400, 0, 22, 2), false));
    files.push(new File([files[0]], 'IMG_1040 copy.jpg', { type: 'image/jpeg' }));
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const input = document.querySelector('input[type=file][multiple]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByText(/may weaken the model/).waitFor({ timeout: 30_000 });
  await page.getByLabel('Object name').fill('Bronze figurine');
  await page.waitForTimeout(600);
  await shot('create');
  await tile('photo-check', '.create-layout > div');
}

// Last, so the home page already shows the feature images captured above.
await context.clearCookies();
await page.goto(`${base}/`);
await page.locator('.showcase canvas').waitFor();
await page.waitForTimeout(4000);
await shot('home');

await page.goto(`${base}/collection`);
await page.locator('.card img').first().waitFor();
await page.waitForTimeout(800);
await shot('collection');

await page.goto(`${base}/`);
await page.locator('.showcase canvas').waitFor();
await page.evaluate(() => window.scrollTo(0, document.querySelector('.bento')?.getBoundingClientRect().top + window.scrollY - 80));
await page.waitForTimeout(1500);
await shot('home-features');

await browser.close();
console.log(`Screenshots written to ${docs} and ${showcase}`);

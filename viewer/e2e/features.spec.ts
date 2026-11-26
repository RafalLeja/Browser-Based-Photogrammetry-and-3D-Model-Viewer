// End-to-end tests of the museum features: inspection, raking light, the object record, condition
// notes and reports, compare, kiosk, dashboard, the command palette and the photo check.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const CURATOR = { login: 'e2e-curator', password: 'e2e-password-123' };
const jpeg = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512)]) });

async function signIn(page: Page, next = '/collection') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Login').fill(CURATOR.login);
  await page.getByLabel('Password').fill(CURATOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}

async function waitForModel(page: Page) {
  await expect(page.getByTitle('Graphics backend and triangle count')).toContainText(/WebGPU|WebGL 2/, { timeout: 45_000 });
}

/** Publishes an object through the API (demo pipeline) and returns its id. */
async function publish(request: APIRequestContext, title: string): Promise<number> {
  const form = new FormData();
  form.append('title', title);
  for (const file of Array.from({ length: 3 }, (_, i) => jpeg(`IMG_${i}.jpg`))) form.append('files', new Blob([file.buffer], { type: file.mimeType }), file.name);
  const response = await request.post('/api/v1/uploads', { multipart: form });
  expect(response.status(), await response.text()).toBe(201);
  const { job, object } = await response.json();
  await expect.poll(async () => (await (await request.get(`/api/v1/jobs/${job.id}`)).json()).status, { timeout: 30_000 }).toBe('done');
  return object.id;
}

async function helmetId(request: APIRequestContext): Promise<number> {
  const page = await (await request.get('/api/v1/objects?q=helmet')).json();
  return page.items[0].id;
}

test('the home page scrolls over the 3D hero instead of zooming it', async ({ page }) => {
  await page.goto('/');
  const showcase = page.locator('.showcase');
  await expect(showcase.locator('canvas')).toBeVisible({ timeout: 45_000 });
  const box = (await showcase.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
});

test('Inspect switches render modes and shows dimensions and statistics', async ({ page, request }) => {
  await page.goto(`/objects/${await helmetId(request)}`);
  await waitForModel(page);
  await page.getByRole('tab', { name: 'Inspect' }).click();
  await page.getByRole('button', { name: 'Clay' }).click();
  await expect(page.getByRole('button', { name: 'Clay' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('3');
  await expect(page.getByRole('button', { name: 'Wireframe' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fact', { hasText: 'Vertices' })).toContainText(/\d/);
  await page.getByLabel('Show overall dimensions').check();
  await expect(page.locator('.vw-measure-label[data-kind="dimension"]')).toHaveCount(3);
});

test('raking light lowers the key light and offers a sweep', async ({ page, request }) => {
  await page.goto(`/objects/${await helmetId(request)}`);
  await waitForModel(page);
  await page.getByRole('tab', { name: 'Light' }).click();
  await page.getByRole('button', { name: /^Raking light/ }).click();
  await expect(page.getByRole('button', { name: /^Raking light/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('output[for="elevation"]')).toHaveText('6°');
  await page.getByRole('button', { name: 'Sweep the light around' }).click();
  await expect(page.getByRole('button', { name: 'Stop sweep' })).toBeVisible();
});

test('a curator records the museum record and licence, then cites and finds the object', async ({ page }) => {
  await signIn(page);
  const id = await publish(page.request, 'E2E record');
  await page.goto(`/objects/${id}`);
  await waitForModel(page);

  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Accession number').fill('E2E-42');
  await page.getByLabel('Maker').fill('Test workshop');
  await page.getByLabel('Licence').selectOption('cc-by');
  await page.getByLabel('Text description').fill('A test helmet.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.locator('.panel-eyebrow')).toHaveText('E2E-42');
  await expect(page.locator('.record')).toContainText('Test workshop');
  await expect(page.locator('.license')).toContainText('CC BY 4.0');
  await page.getByRole('button', { name: 'Cite' }).click();
  await expect(page.getByRole('dialog').locator('code').first()).toContainText('Test workshop, “E2E record”, E2E-42');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.goto('/collection?q=E2E-42');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card .badge', { hasText: 'CC BY' })).toBeVisible();
});

test('a damage note gets a severity, a coloured pin and a place in the condition report', async ({ page }) => {
  await signIn(page);
  const id = await publish(page.request, 'E2E condition');
  await page.goto(`/objects/${id}`);
  await waitForModel(page);

  await page.getByRole('button', { name: 'Add note' }).first().click();
  const box = (await page.locator('.stage canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Title', { exact: true }).fill('Dent on the crown');
  await page.getByLabel('Category').selectOption('damage');
  await page.getByLabel('Severity').selectOption('marked');
  await page.getByRole('button', { name: 'Save note' }).click();

  await expect(page.locator('.note-kind', { hasText: 'Damage · Marked' })).toBeVisible();
  await expect(page.locator('.vw-pin[data-kind="damage"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Condition report' }).click();
  await expect(page).toHaveURL(new RegExp(`/objects/${id}/report$`));
  await expect(page.locator('.report-note', { hasText: 'Dent on the crown' })).toContainText('Damage · Marked');
  // The print button waits for the off-screen renders of the four sides and the close-up.
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator('.report-sides img')).toHaveCount(4);
});

test('compare shows two objects side by side', async ({ page, request }) => {
  const helmet = await helmetId(request);
  await page.goto(`/compare?a=${helmet}&b=${helmet}`);
  await expect(page.locator('.compare-pane canvas')).toHaveCount(2, { timeout: 45_000 });
  await expect(page.locator('.compare-stats')).toHaveCount(2, { timeout: 45_000 });
  await expect(page.getByLabel('Link cameras')).toBeChecked();
});

test('kiosk mode presents objects and hands control to a visitor on touch', async ({ page, request }) => {
  await page.goto(`/kiosk?ids=${await helmetId(request)}`);
  await expect(page.locator('.kiosk-object h1')).toHaveText('Damaged Helmet', { timeout: 45_000 });
  await expect(page.getByText('Touch to explore')).toBeVisible();
  await page.mouse.click(200, 200);
  await expect(page.getByRole('button', { name: 'Reset the view' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Leave kiosk mode' })).toBeVisible();
});

test('the dashboard sums up the collection for curators', async ({ page }) => {
  await signIn(page, '/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('.stat-tile', { hasText: 'Published objects' }).locator('.stat-value')).toHaveText(/\d+/);
  await expect(page.getByRole('img', { name: /Reconstructions finished per day/ })).toBeVisible();
  await page.getByText('Show as a table').click();
  await expect(page.locator('.viz-table table')).toBeVisible();
});

test('the command palette finds an object and opens it', async ({ page }) => {
  await page.goto('/collection');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search objects, pages and actions' }).fill('helmet');
  await expect(page.getByRole('option', { name: /Damaged Helmet/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/objects\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Damaged Helmet' })).toBeVisible();
});

test('the photo check flags blurry, dark and duplicate photos before upload', async ({ page }) => {
  await signIn(page, '/create');
  // Photos are drawn in the page: five sharp test cards, a blurred one, a dark one and a copy. A
  // small card is scaled up to 1800 × 1200 (over 2 megapixels): without smoothing it stays sharp,
  // and from a tiny card with smoothing it comes out blurred. Canvas filters are too slow here.
  await page.evaluate(async () => {
    const card = (size: number, low: number, high: number, shift: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = size * 1.5;
      canvas.height = size;
      const g = canvas.getContext('2d')!;
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
    const photo = async (name: string, source: HTMLCanvasElement, smooth: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1800;
      canvas.height = 1200;
      const g = canvas.getContext('2d')!;
      g.imageSmoothingEnabled = smooth;
      g.drawImage(source, 0, 0, 1800, 1200);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8));
      return new File([blob], name, { type: 'image/jpeg' });
    };
    const files: File[] = [];
    for (let i = 0; i < 5; i++) files.push(await photo(`IMG_${i}.jpg`, card(400, 30, 220, i), false));
    files.push(await photo('IMG_blurry.jpg', card(40, 30, 220, 1), true));
    files.push(await photo('IMG_dark.jpg', card(400, 0, 22, 2), false));
    files.push(new File([files[0]], 'IMG_copy.jpg', { type: 'image/jpeg' }));
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('input[type=file][multiple]')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.getByText('3 photos may weaken the model')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.thumb-flag', { hasText: 'Duplicate' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove 3' }).click();
  await expect(page.getByText('Every photo looks sharp and well exposed')).toBeVisible();
  await expect(page.getByText(/^5 photos/)).toBeVisible();
});

// End-to-end: the real API (demo pipeline), the real frontend and a real browser.
import { expect, test, type Page } from '@playwright/test';

const CURATOR = { login: 'e2e-curator', password: 'e2e-password-123' };
// The server checks the first bytes of each photo, so a JPEG header is enough for the demo pipeline.
const jpeg = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512)]) });

async function signIn(page: Page, next = '/collection') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Login').fill(CURATOR.login);
  await page.getByLabel('Password').fill(CURATOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}

/** The renderer chip appears once the model is loaded and framed. */
async function waitForModel(page: Page) {
  await expect(page.getByTitle('Graphics backend and triangle count')).toContainText(/WebGPU|WebGL 2/, { timeout: 45_000 });
}

test('a visitor finds an object and inspects it in 3D', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Photos in.');
  await page.getByRole('link', { name: 'Explore the collection' }).click();

  await expect(page.getByText(/\d+ objects?/)).toBeVisible();
  await page.getByLabel('Search the collection').fill('helmet');
  await expect(page).toHaveURL(/q=helmet/);
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.card').first().click();

  await expect(page.getByRole('heading', { name: 'Damaged Helmet' })).toBeVisible();
  await waitForModel(page);
  await expect(page.locator('.stage canvas')).toBeVisible();
  await page.getByRole('tab', { name: 'Light' }).click();
  await page.getByRole('button', { name: 'Outdoor' }).click();
  await expect(page.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
});

test('the ruler measures between two clicked points', async ({ page }) => {
  await page.goto('/collection?q=helmet');
  await page.locator('.card').first().click();
  await waitForModel(page);

  await page.getByRole('button', { name: 'Measure' }).first().click();
  const canvas = page.locator('.stage canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx - 40, cy - 20);
  await page.mouse.click(cx + 40, cy + 20);

  await expect(page.locator('.measure-value')).toHaveCount(1);
  await expect(page.locator('.measure-value').first()).toHaveText(/\d/);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.measure-value')).toHaveCount(0);
});

test('a shared link restores the view', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/collection?q=helmet');
  await page.locator('.card').first().click();
  await waitForModel(page);
  await page.getByRole('button', { name: 'Share this view' }).click();
  const link = page.locator('.dialog code').first();
  await expect(link).toContainText('?view=');
  const url = (await link.textContent())!;

  await page.goto(url);
  await waitForModel(page);
  await expect(page.getByText('That shared view no longer exists.')).toHaveCount(0);
});

test('curator pages ask visitors to sign in, and a wrong password is explained', async ({ page }) => {
  await page.goto('/create');
  await expect(page).toHaveURL(/\/login\?next=%2Fcreate/);
  await page.getByLabel('Login').fill(CURATOR.login);
  await page.getByLabel('Password').fill('wrong password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong login or password.');
});

test('a curator uploads photos, follows the job and annotates the result', async ({ page }) => {
  await signIn(page, '/create');

  // Files that are not photos are explained, not uploaded.
  await page.locator('input[type=file][multiple]').setInputFiles([
    ...Array.from({ length: 5 }, (_, i) => jpeg(`IMG_${i}.jpg`)),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') },
  ]);
  await expect(page.getByText('1 file was skipped')).toBeVisible();
  await expect(page.getByText(/^5 photos/)).toBeVisible();

  await page.getByLabel('Object name').fill('E2E amphora');
  await page.getByLabel('Tags').fill('ceramic, test');
  await page.getByRole('button', { name: 'Start reconstruction' }).click();

  await expect(page).toHaveURL(/\/jobs\/\d+$/);
  await expect(page.getByRole('heading', { name: 'E2E amphora' })).toBeVisible();
  await expect(page.getByText('Demo pipeline.')).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'Done' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Open model' }).click();

  await expect(page.getByRole('heading', { name: 'E2E amphora' })).toBeVisible();
  await waitForModel(page);
  await expect(page.getByText('Demo reconstruction.')).toBeVisible();

  // Add a note on the surface.
  await page.getByRole('button', { name: 'Add note' }).first().click();
  const box = (await page.locator('.stage canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Title', { exact: true }).fill('Rim chip');
  await page.getByLabel('Note', { exact: true }).fill('Small loss on the rim.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.list-item h4', { hasText: 'Rim chip' })).toBeVisible();
  await expect(page.locator('.vw-pin')).toHaveCount(1);

  // Edit the title, then delete the object.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.locator('#edit-title').fill('E2E amphora (edited)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'E2E amphora (edited)' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/collection$/);
  await expect(page.locator('.card', { hasText: 'E2E amphora' })).toHaveCount(0);
});

test('the jobs list shows finished reconstructions', async ({ page }) => {
  await signIn(page, '/jobs');
  // The test queues its own job through the API, so it does not depend on the others.
  const form = new FormData();
  form.append('title', 'E2E jobs list');
  for (const file of Array.from({ length: 3 }, (_, i) => jpeg(`IMG_${i}.jpg`))) {
    form.append('files', new Blob([file.buffer], { type: file.mimeType }), file.name);
  }
  const response = await page.request.post('/api/v1/uploads', { multipart: form });
  expect(response.status(), await response.text()).toBe(201);
  const { job } = await response.json();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${job.id}`)).json()).status, { timeout: 30_000 }).toBe('done');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.job-row', { hasText: 'E2E jobs list' })).toBeVisible();
  await page.getByRole('button', { name: 'Failed' }).click();
  await expect(page.locator('.job-row', { hasText: 'E2E jobs list' })).toHaveCount(0);
});

test('the capture guide and the 404 page render', async ({ page }) => {
  await page.goto('/guide');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Great models');
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const path of ['/', '/collection', '/guide', '/login', '/compare']) {
    test(`${path} fits the screen without sideways scrolling`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('#main')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('the menu opens and the object page stacks the panel under the 3D view', async ({ page }) => {
    await page.goto('/collection?q=helmet');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('link', { name: 'Capture guide' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();
    await page.locator('.card').first().click();
    const stage = (await page.locator('.stage').boundingBox())!;
    const panel = (await page.locator('.panel').boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    // Five panel tabs and the dock must not push the page sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

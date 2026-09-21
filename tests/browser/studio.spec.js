import { test, expect } from '@playwright/test';

async function ready(page) { await page.goto('/?inspect=1'); await expect(page.getByText('Live 3D preview')).toBeVisible({ timeout: 30000 }); }

test('all variants, door animation, component inspection and lighting', async ({ page }) => {
  test.setTimeout(120000); // Multiple GLB views are rendered with software WebGL in this test environment.
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  const initial = await page.evaluate(() => window.__sauna.diagnostics());
  expect(initial.bounds[0]).toBeCloseTo(1.4, 3); expect(initial.bounds[1]).toBeCloseTo(2.02, 3); expect(initial.bounds[2]).toBeCloseTo(1.2, 3);
  for (const door of ['left','right']) for (const heater of ['integrated','external']) {
    await page.getByRole('button', { name: `${door === 'left' ? 'Left' : 'Right'} hinge` }).click();
    await page.getByRole('button', { name: heater === 'integrated' ? 'Integrated Controls on the heater' : 'External A separate wall controller' }).click();
    const state = await page.evaluate(() => window.__sauna.diagnostics());
    expect(state.visible).toContain(`door_${door}-hinge`); expect(state.visible).toContain(`heater_${heater}-control`);
    expect(state.visible.filter(id => id.startsWith('door_'))).toHaveLength(1);
    await page.getByLabel('Door opening angle').fill('90');
    await expect.poll(async () => (await page.evaluate(() => window.__sauna.diagnostics())).pivots.find(p => p.id === `door_${door}-hinge`).angle).toBeCloseTo(door === 'left' ? -Math.PI / 2 : Math.PI / 2, 2);
    await page.getByLabel('Door opening angle').fill('0');
  }
  await page.getByLabel('Timber wall light').uncheck();
  expect((await page.evaluate(() => window.__sauna.diagnostics())).visible).not.toContain('lighting_timber-shade');
  for (const part of ['cabin','door','heater','lighting','scale','all']) {
    await page.getByLabel('Component view').selectOption(part);
    expect((await page.evaluate(() => window.__sauna.diagnostics())).component).toBe(part);
  }
  await page.getByRole('button', { name: 'Cutaway', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'output/web/cutaway.png' });
  await page.getByRole('button', { name: 'Exterior', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'output/web/desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('individual component renders and image download', async ({ page }) => {
  test.setTimeout(90000);
  await ready(page);
  for (const part of ['door', 'heater', 'lighting']) {
    await page.getByLabel('Component view').selectOption(part);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `output/web/component-${part}.png` });
  }
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('sauna-lighting.png');
});

test('fit checks, stale-result reset, saved links and backend restoration', async ({ page, context }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Check my space', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('182');
  await page.getByRole('spinbutton', { name: 'Depth', exact: true }).fill('140');
  await page.getByRole('spinbutton', { name: 'Ceiling height' }).fill('240');
  await page.getByRole('button', { name: 'Check the dimensions' }).click();
  await expect(page.getByText('Fits when turned 90°')).toBeVisible();
  await page.screenshot({ path: 'output/web/space-check.png' });
  await page.getByRole('spinbutton', { name: 'Ceiling height' }).fill('190');
  await expect(page.getByText('Fits when turned 90°')).not.toBeVisible();
  await page.getByRole('button', { name: 'Check the dimensions' }).click();
  await expect(page.getByText('This space is too small')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Right hinge' }).click();
  await page.getByRole('button', { name: 'Save design', exact: true }).click();
  await expect(page.getByLabel('Design link')).toBeVisible();
  const url = await page.getByLabel('Design link').inputValue();
  expect(url).toContain('?design=');
  const other = await context.newPage(); await other.goto(url);
  await expect(other.getByRole('button', { name: 'Right hinge' })).toHaveAttribute('aria-pressed','true');
  await other.close();
});

test('mobile layout, denied camera, and model load recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }); });
  await ready(page); await page.screenshot({ path: 'output/web/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Check my space', exact: true }).click();
  await page.getByRole('button', { name: 'Open camera preview' }).click();
  await expect(page.getByText(/Camera permission was declined/)).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.route('**/api/catalog', route => route.abort());
  await page.reload(); await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.unroute('**/api/catalog'); await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Live 3D preview')).toBeVisible({ timeout: 30000 });
});

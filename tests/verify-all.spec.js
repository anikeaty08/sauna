// Full configurator verification: every product family/option group and the
// customer-journey UX (share, quote, PDF, undo/redo, browser back, room fit).
// Run with: npm test   (spins up the app itself via playwright.config.js)
import { test, expect } from '@playwright/test';

const total = page => page.locator('.grand-total b').first().textContent();
const clickSafe = async loc => {
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
  // force: bypasses Playwright's stability wait, which can hang against a
  // continuously-redrawing WebGL canvas (60fps setAnimationLoop) even though
  // the target button itself is static and perfectly clickable.
  await loc.click({ timeout: 8000, force: true });
};
const openSection = async (page, id) => {
  const el = page.locator(`#section-${id}`);
  const isOpen = await el.evaluate(node => node.open);
  if (!isOpen) await clickSafe(page.locator(`#section-${id} summary`));
};

test.describe.configure({ mode: 'serial' });

test('full configurator: catalog + customer journey', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await expect.soft(page.locator('.preset-card')).toHaveCount(7); // 6 presets + the "build from scratch" tile
  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1000);

  // ---- family types & product families ----
  await openSection(page, 'cabin');
  const typeButtons = page.locator('.type-filter button');
  await expect.soft(typeButtons).toHaveCount(7); // All, Indoor, Hexagon, Round, Barrel, Garden house, Infrared

  for (const typeLabel of ['Hexagon', 'Round', 'Barrel', 'Garden house', 'Infrared']) {
    await clickSafe(typeButtons.filter({ hasText: typeLabel }));
    await page.waitForTimeout(150);
    const cards = page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch');
    const n = await cards.count();
    await clickSafe(cards.first());
    await page.waitForTimeout(600);
    expect.soft(n, `${typeLabel} family list`).toBeGreaterThan(0);
    await expect.soft(await total(page), `${typeLabel} prices`).toMatch(/CHF [\d']+/);
  }
  await clickSafe(typeButtons.first());
  await page.waitForTimeout(150);

  // Named indoor families all select and price.
  for (const name of ['Heinola', 'Rauma', 'Kemi', 'Mikkeli', 'Alder', 'Erle', 'Espoo']) {
    const card = page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').filter({ hasText: new RegExp(name, 'i') });
    if (await card.count()) {
      await clickSafe(card.first());
      await page.waitForTimeout(500);
      await expect.soft(await total(page), `${name} price`).toMatch(/CHF [\d']+/);
    }
  }

  // Bergzauber - richest configurator: wood-per-side options should appear.
  const bergzauber = page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').filter({ hasText: /Bergzauber/i });
  await expect.soft(bergzauber, 'Bergzauber family present').toHaveCount(1);
  if (await bergzauber.count()) {
    await clickSafe(bergzauber.first());
    await page.waitForTimeout(500);
    const woodSwatches = page.locator('#section-cabin').getByText(/Panel wood outside|Paneele aussen/i);
    await expect.soft(woodSwatches.first()).toBeVisible();
    const cornerEntry = page.locator('#section-cabin .opt-grid').filter({ hasText: /Corner entry|Eckeinstieg/i });
    await expect.soft(cornerEntry.first()).toBeVisible();
  }

  // Back to fichte for the rest.
  const fichteCard = page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').filter({ hasText: /Solid Nordic spruce|Fichte/i });
  await clickSafe(fichteCard.first());
  await page.waitForTimeout(500);

  // ---- door glass/handle, window types ----
  await openSection(page, 'door');
  await expect.soft(page.locator('#section-door').getByText(/Door glass|Glas/i).first()).toBeVisible();
  await expect.soft(page.locator('#section-door').getByText(/Door handle|Türgriff/i).first()).toBeVisible();
  await expect.soft(page.locator('#section-door .opt-grid').filter({ hasText: /Window|Fenster/i }).first()).toBeVisible();

  // ---- heater bundles, infrared add-on, wood-fired + chimney ----
  await openSection(page, 'heater');
  const bundleList = page.locator('#section-heater .opt-list').first();
  const bundleCount = await bundleList.locator('.opt-swatch').count();
  expect.soft(bundleCount, 'heater bundles').toBeGreaterThanOrEqual(4);
  const t0 = await total(page);
  await clickSafe(bundleList.locator('.opt-swatch').first());
  await page.waitForTimeout(400);
  expect.soft(await total(page), 'selecting a bundle changes price').not.toBe(t0);
  await expect.soft(page.locator('#section-heater').getByText(/Infrared emitter|Infrarot-Strahler/i).first()).toBeVisible();

  // wood-fired heater -> chimney requirement (only offered on outdoor families: barrel/house)
  await openSection(page, 'cabin');
  await clickSafe(typeButtons.filter({ hasText: 'Barrel' }));
  await page.waitForTimeout(150);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
  await page.waitForTimeout(500);
  await openSection(page, 'heater');
  const heaterCards = page.locator('#section-heater .opt-list').nth(1).locator('.opt-swatch');
  const woodFired = heaterCards.filter({ hasText: /Linear|wood-fired|Holzofen/i });
  const woodFiredCount = await woodFired.count();
  expect.soft(woodFiredCount, 'wood-fired heater offered outdoors').toBeGreaterThan(0);
  if (woodFiredCount) {
    await clickSafe(woodFired.first());
    await page.waitForTimeout(500);
    const chimneyLabel = page.locator('#section-heater p.panel-label').filter({ hasText: /Chimney kit|Schornstein/i });
    await expect.soft(chimneyLabel).toBeVisible();
    const warn = page.locator('.panel-warnings');
    const warnText = (await warn.count()) ? await warn.textContent() : '';
    expect.soft(warnText, 'warns when chimney not yet chosen').toMatch(/chimney|Schornstein/i);
    // The chimney option list is the element right after the "Chimney kit" label -
    // NOT ".opt-list".last(), which can match the unrelated infrared list that
    // also renders inside this section.
    const chimneyOption = chimneyLabel.locator('xpath=following-sibling::div[contains(@class,"opt-list")][1]').locator('.opt-swatch').first();
    await clickSafe(chimneyOption);
    await page.waitForTimeout(400);
    const warnText2 = (await page.locator('.panel-warnings').count()) ? await page.locator('.panel-warnings').textContent() : '';
    expect.soft(warnText2, 'chimney selection clears the warning').not.toMatch(/chimney|Schornstein/i);
  }
  // indoor family should not offer wood-fired heaters at all
  await openSection(page, 'cabin');
  await clickSafe(typeButtons.first());
  await page.waitForTimeout(150);
  await clickSafe(fichteCard.first());
  await page.waitForTimeout(500);
  await openSection(page, 'heater');
  const indoorHeaterCards = page.locator('#section-heater .opt-list').nth(1).locator('.opt-swatch');
  await expect.soft(indoorHeaterCards.filter({ hasText: /Linear|wood-fired|Holzofen/i })).toHaveCount(0);
  await clickSafe(indoorHeaterCards.filter({ hasText: /Virta/i }).first());
  await page.waitForTimeout(400);

  // ---- Interior / benches section: layout switching + sliders don't crash ----
  await openSection(page, 'interior');
  for (const layout of [/L-shape/i, /U-shape/i, /Straight/i]) {
    const btn = page.locator('#section-interior .opt-grid').filter({ hasText: /Layout|L-shape|U-shape|Straight/i }).locator('.opt-swatch').filter({ hasText: layout });
    if (await btn.count()) { await clickSafe(btn.first()); await page.waitForTimeout(400); }
  }
  const interiorErrorsBefore = errors.length;
  const sliders = page.locator('#section-interior input[type=range]');
  const sliderCount = await sliders.count();
  for (let i = 0; i < sliderCount; i++) {
    const s = sliders.nth(i);
    const [min, max] = await s.evaluate(el => [Number(el.min), Number(el.max)]);
    await s.fill(String(max));
    await page.waitForTimeout(150);
    await s.fill(String(min));
    await page.waitForTimeout(150);
  }
  expect.soft(errors.slice(interiorErrorsBefore), 'layout + slider extremes throw no errors').toEqual([]);
  const switches = page.locator('#section-interior .mini-switch input');
  const switchCount = await switches.count();
  for (let i = 0; i < switchCount; i++) { await switches.nth(i).click({ force: true }); await page.waitForTimeout(100); }
  expect.soft(errors.slice(interiorErrorsBefore), 'toggling all switches throws no errors').toEqual([]);

  // ---- cladding + insulation (on a house family) ----
  await openSection(page, 'cabin');
  await clickSafe(typeButtons.filter({ hasText: 'Garden house' }));
  await page.waitForTimeout(150);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
  await page.waitForTimeout(500);
  await expect.soft(page.locator('#section-cabin').getByText(/Insulation|Dämmung/i).first()).toBeVisible();
  await expect.soft(page.locator('#section-cabin').getByText(/Roof shingles|Dacheindeckung/i).first()).toBeVisible();
  await clickSafe(typeButtons.first());
  await page.waitForTimeout(150);
  await clickSafe(fichteCard.first());
  await page.waitForTimeout(500);
  await expect.soft(page.locator('#section-cabin .opt-grid').filter({ hasText: /Slate|Reclaimed|Schiefer|Altholz/i }).first()).toBeVisible();

  // ---- accessories: foot mat / floating bench / 2-step bench, assembly service ----
  await openSection(page, 'accessory');
  const accText = await page.locator('#section-accessory').textContent();
  expect.soft(accText, 'accessory catalog').toMatch(/foot mat|floating bench|2-step|Fussmatte|Schwebeliege/i);
  expect.soft(accText, 'assembly on-request option').toMatch(/on request|auf Anfrage/i);
  expect.soft(accText, 'assembly service present').toMatch(/assembly|Montage/i);

  // ---- Room fit check ----
  await openSection(page, 'room');
  const roomInputs = page.locator('#section-room input[type=number]');
  await roomInputs.nth(0).fill('300'); await page.waitForTimeout(150);
  await roomInputs.nth(1).fill('300'); await page.waitForTimeout(150);
  await roomInputs.nth(2).fill('250'); await page.waitForTimeout(300);
  const fitText = await page.locator('.fit-result').textContent().catch(() => '');
  expect.soft(fitText, 'room fit computes a result').toMatch(/fits|passt/i);
  await expect.soft(roomInputs.nth(0)).toHaveValue('300');

  // ---- Undo / redo ----
  const beforeUndo = await total(page);
  await openSection(page, 'lighting');
  const lightRow = page.locator('#section-lighting .opt-row').first();
  await clickSafe(lightRow);
  await page.waitForTimeout(300);
  const afterToggle = await total(page);
  expect.soft(afterToggle, 'toggle changed price').not.toBe(beforeUndo);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  await expect.soft(await total(page), 'undo reverts the price').toBe(beforeUndo);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(300);
  await expect.soft(await total(page), 'redo reapplies the change').toBe(afterToggle);

  // ---- Browser back/forward ----
  await page.goBack();
  await page.waitForTimeout(500);
  await expect.soft(page.locator('.preset-card').first()).toBeVisible();
  await page.goForward();
  await page.waitForTimeout(700);
  await expect.soft(page.locator('canvas').first()).toBeVisible();

  // ---- Share link (server-backed short link) ----
  const shareTotal = await total(page);
  await page.locator('.share-btn').click();
  await page.waitForSelector('.share-box input', { timeout: 8000 });
  const shareUrl = await page.locator('.share-box input').inputValue();
  expect.soft(shareUrl, 'share link is a short server-backed link').toContain('?d=');
  const page2 = await context.newPage();
  await page2.goto(shareUrl, { waitUntil: 'networkidle' });
  await page2.waitForSelector('canvas', { timeout: 10000 }).catch(() => {});
  await page2.waitForTimeout(1200);
  const restoredTotal = await page2.locator('.grand-total b').first().textContent().catch(() => '(missing)');
  expect.soft(restoredTotal, 'share link restores identical price').toBe(shareTotal);
  await page2.close();

  // ---- Quote request (real API) ----
  await page.locator('button:has-text("Request a quote")').click();
  await page.waitForTimeout(300);
  await page.locator('.quote-form input').first().fill('Verification Test');
  await page.locator('.quote-form input[type=email]').fill('verify@example.com');
  await page.locator('.quote-form button[type=submit]').click();
  await page.waitForTimeout(1000);
  await expect.soft(page.locator('.quote-done')).toHaveCount(1);
  await page.locator('.quote-modal button:has-text("Close")').click().catch(() => {});

  // ---- PDF / print quote (floor plan + line items) ----
  const [printPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('button:has-text("PDF")').first().click(),
  ]);
  await printPage.waitForLoadState();
  const printBody = await printPage.locator('body').textContent();
  await expect.soft(printPage.locator('svg').first()).toBeVisible();
  expect.soft(printBody, 'PDF quote includes line items').toMatch(/CHF/);
  await printPage.close();

  // ---- Reset ----
  await clickSafe(page.locator('button:has-text("Reset")').first());
  await page.waitForTimeout(400);

  expect(errors, `unexpected console/page errors: ${errors.join('; ')}`).toEqual([]);
});

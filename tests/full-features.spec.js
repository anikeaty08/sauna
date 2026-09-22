// Smoke check for the expanded catalog + customer-journey features.
//   node tests/full-features.spec.js  (against `node server/index.js`, port 3001)
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const log = (...a) => console.log('[smoke]', ...a);
const total = page => page.locator('.grand-total b').first().textContent();
// Scroll the element to the vertical centre of the panel first, so it is never
// under the sticky total bar, then do a real (non-forced) click.
const clickSafe = async loc => { await loc.evaluate(el => el.scrollIntoView({ block: 'center' })); await loc.click({ timeout: 8000 }); };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await page.locator('.preset-card').first().click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1000);
  log('baseline total:', await total(page));

  // Cabin & size is open by default; switch product type filter, pick a barrel sauna.
  const typeButtons = page.locator('.type-filter button');
  log('type filter options:', await typeButtons.allTextContents());
  await typeButtons.filter({ hasText: /barrel|fass/i }).first().click();
  await page.waitForTimeout(150);
  const familyCards = page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch');
  log('barrel families shown:', await familyCards.count());
  await clickSafe(familyCards.first());
  await page.waitForTimeout(700);
  log('barrel total:', await total(page));
  await page.screenshot({ path: 'test-results/barrel.png' });

  // Switch to a garden house family and an infrared family, confirm no crash.
  await typeButtons.filter({ hasText: /house|garten/i }).first().click();
  await page.waitForTimeout(150);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
  await page.waitForTimeout(700);
  log('house total:', await total(page));
  await page.screenshot({ path: 'test-results/house.png' });

  await typeButtons.filter({ hasText: /infrared|infrarot/i }).first().click();
  await page.waitForTimeout(150);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
  await page.waitForTimeout(700);
  log('infrared total:', await total(page));
  await page.screenshot({ path: 'test-results/infrared.png' });

  // Back to a standard cabin family for the rest of the checks.
  await typeButtons.first().click();
  await page.waitForTimeout(150);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').filter({ hasText: /Fichte|spruce/i }).first());
  await page.waitForTimeout(700);

  // Heater bundles
  await clickSafe(page.locator('#section-heater summary'));
  await page.waitForTimeout(150);
  const t0 = await total(page);
  await clickSafe(page.locator('#section-heater .opt-list').first().locator('.opt-swatch').first());
  await page.waitForTimeout(400);
  log('bundle select total:', t0, '->', await total(page));
  await page.screenshot({ path: 'test-results/bundle.png' });

  // Room fit
  await clickSafe(page.locator('#section-room summary'));
  await page.waitForTimeout(150);
  const roomInputs = page.locator('#section-room input[type=number]');
  await roomInputs.nth(0).fill('300');
  await roomInputs.nth(1).fill('300');
  await roomInputs.nth(2).fill('250');
  await page.waitForTimeout(400);
  log('room fit result:', await page.locator('.fit-result').textContent().catch(() => '(none)'));
  await page.screenshot({ path: 'test-results/room-fit.png' });

  // Share link
  const totalBeforeShare = await total(page);
  await page.locator('.share-btn').first().click();
  await page.waitForSelector('.share-box input', { timeout: 8000 });
  const shareUrl = await page.locator('.share-box input').inputValue();
  log('share url:', shareUrl);

  // Reload with the share link and confirm it restores the same config
  if (shareUrl) {
    const page2 = await browser.newPage();
    await page2.goto(shareUrl, { waitUntil: 'networkidle' });
    await page2.waitForSelector('canvas', { timeout: 10000 });
    await page2.waitForTimeout(1000);
    const restored = await page2.locator('.grand-total b').first().textContent();
    log('share-link restore total:', restored, restored === totalBeforeShare ? '(MATCHES)' : '(MISMATCH!)');
    log('share-link restored family title:', await page2.locator('.panel-head h2').textContent());
    await page2.screenshot({ path: 'test-results/share-restore.png' });
    await page2.close();
  }

  // Quote modal -> submit
  await page.locator('button:has-text("Request a quote"), button:has-text("Offerte anfragen")').first().click();
  await page.waitForTimeout(300);
  await page.locator('.quote-form input[type=text], .quote-form input:not([type])').first().fill('Test Customer');
  await page.locator('.quote-form input[type=email]').fill('test@example.com');
  await page.locator('.quote-form button[type=submit]').click();
  await page.waitForTimeout(800);
  log('quote submitted, confirmation shown:', await page.locator('.quote-done').count() > 0);
  await page.screenshot({ path: 'test-results/quote-done.png' });
  await page.locator('.quote-modal button:has-text("Close"), .quote-modal button:has-text("Schliessen")').click();

  // PDF print window (includes the floor plan)
  const [printPage] = await Promise.all([
    page.context().waitForEvent('page'),
    page.locator('button:has-text("PDF")').first().click(),
  ]);
  await printPage.waitForLoadState();
  log('print page title:', await printPage.title());
  await printPage.screenshot({ path: 'test-results/print-quote.png', fullPage: true });
  await printPage.close();

  // Reset
  await page.locator('button:has-text("Reset"), button:has-text("Zurücksetzen")').first().click();
  await page.waitForTimeout(400);
  log('total after reset:', await total(page));

  log('console/page errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exitCode = 1;
})();

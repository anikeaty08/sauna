import { test, expect as baseExpect } from '@playwright/test';

// The headless runner renders WebGL in software; allow for slow frames.
const expect = baseExpect.configure({ timeout: 60000 });

// Clicks are dispatched on the element: the WebGL canvas keeps the software
// renderer busy enough that Playwright's actionability waits time out.
const click = loc => loc.first().evaluate(el => el.click());

// Chromium's default headless GPU path. The repo-wide forced SwiftShader flags
// make compositing a modal over the WebGL canvas take ~90 s (a test-machine
// artefact; with them the same flow is instant in a normal browser).
test.use({ launchOptions: { args: [] } });
const price = page => page.locator('.st-price').first().innerText();

test('production studio: one configurable sauna, real prices, QR share and PDF quote', async ({ page, context }) => {
  test.setTimeout(600000);
  await page.goto('/studio');
  await expect(page.locator('.st-product h1')).toHaveText('Designsauna Zirbe 6-Eck');
  await expect(page.locator('.st-canvas canvas')).toHaveCount(1);
  // default: 230 x 250, EOS set (price on request) -> 19'990 + 1'181 + 1'156
  await expect.poll(() => price(page)).toContain("22'327");

  // width 150 -> base + depth surcharge only
  await click(page.locator('.st-chip', { hasText: /^150 cm$/ }));
  await expect.poll(() => price(page)).toContain("21'146");

  // heater set with a published price
  await click(page.locator('.st-tabs button', { hasText: 'Interior' }));
  await click(page.locator('.st-rail button', { hasText: 'Heater' }));
  await click(page.locator('.st-dot', { hasText: 'Harvia Virta Combi' }));
  await expect.poll(() => price(page)).toContain("24'261");

  // bench wood: alder is "on request"
  await click(page.locator('.st-dot', { hasText: 'Alder' }));
  await expect(page.locator('.st-price')).toContainText('on request');

  // accessories add their real prices
  await click(page.locator('.st-dot', { hasText: 'LED strip' }));
  await expect.poll(() => price(page)).toContain("24'560");

  // View in your room (desktop): QR code to the AR page; the AR model is prepared for the phone
  await click(page.locator('.st-stage-actions button', { hasText: 'View in your room' }));
  await expect(page.locator('.st-qr img')).toBeVisible({ timeout: 30000 });
  const href = await page.locator('.st-modal-link').getAttribute('href');
  expect(href).toMatch(/\/studio\/ar\?c=[A-Za-z0-9_-]{12}$/);
  await expect(page.locator('.st-modal-note')).toContainText('Ready', { timeout: 120000 });
  const id = href.split('c=')[1];
  for (const [file, type] of [['model.glb', 'model/gltf-binary'], ['model.usdz', 'model/vnd.usdz+zip']]) {
    const r = await page.request.get(`/api/studio/configurations/${id}/ar/${file}`);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain(type);
  }
  // the AR page on a desktop shows the design and a QR code for the phone
  const ar = await context.newPage();
  await ar.goto(href);
  await expect(ar.locator('.ar-card h1')).toContainText('150 × 250 cm');
  await expect(ar.locator('.ar-qr img')).toBeVisible({ timeout: 30000 });
  await ar.close();

  // PDF quote: a formal quotation downloaded straight from the server
  const [download] = await Promise.all([page.waitForEvent('download'), click(page.locator('.st-actions button', { hasText: 'PDF quote' }))]);
  expect(download.suggestedFilename()).toMatch(/^HolzSauna-Quotation-.*\.pdf$/);
  const pdf = await (await page.request.get(await download.url())).body();
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});

test('shareable link: snapshot, copy, reuse when unchanged, new link after an edit', async ({ page, context }) => {
  test.setTimeout(600000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/studio');
  await expect.poll(() => price(page)).toContain("22'327");
  await click(page.locator('.st-chip', { hasText: /^200 cm$/ }));
  await expect.poll(() => price(page)).toContain("21'858");

  await click(page.locator('.st-stage-actions button', { hasText: 'Share' }));
  const url = page.locator('.st-share-url');
  await expect(url).toHaveValue(/\/studio\?c=[A-Za-z0-9_-]{12}$/);
  const first = await url.inputValue();
  expect(page.url()).toBe(first);                         // address bar = the shared link
  await click(page.locator('.st-share-copy'));
  await expect(page.locator('.st-share-copy')).toHaveText(/Copied/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
  await expect(page.locator('.st-modal')).toContainText('200 × 250 cm');
  await click(page.locator('.st-modal-close'));

  // the recipient sees exactly this design, labelled as shared
  const other = await context.newPage();
  await other.goto(first);
  await expect(other.locator('.st-shared')).toHaveText(/shared design/i);
  await expect.poll(() => other.locator('.st-price').first().innerText()).toContain("21'858");
  // re-sharing the unchanged design gives the same link
  await click(other.locator('.st-stage-actions button', { hasText: 'Share' }));
  await expect(other.locator('.st-share-url')).toHaveValue(first);
  await click(other.locator('.st-modal-close'));
  // an edit drops the old link from the address bar and sharing makes a new one
  await click(other.locator('.st-chip', { hasText: /^210 cm$/ }));
  await expect.poll(() => other.url()).toMatch(/\/studio$/);
  await click(other.locator('.st-stage-actions button', { hasText: 'Share' }));
  await expect(other.locator('.st-share-url')).toHaveValue(/c=/);
  expect(await other.locator('.st-share-url').inputValue()).not.toBe(first);
  // the original link still shows the original design
  const again = await context.newPage();
  await again.goto(first);
  await expect.poll(() => again.locator('.st-price').first().innerText()).toContain("21'858");

  // an unknown link says so and falls back to the standard design
  await again.goto('/studio?c=AAAAAAAAAAAA');
  await expect(again.locator('.st-viewer-msg[role=alert]')).toContainText('could not be found');
});

test('the legacy demo at / still renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
});

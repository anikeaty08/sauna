// Verify the language dropdown: collapsed by default, opens, switches the UI
// language, closes on Escape and on an outside click.
import { chromium } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const OUT = process.env.OUT || '.';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lang-select');

  const trigger = page.locator('.lang-trigger');
  console.log('collapsed label   :', (await trigger.innerText()).replace(/\s+/g, ' ').trim());
  console.log('options visible   :', await page.locator('.lang-option').count(), '(expect 0)');
  console.log('aria-expanded     :', await trigger.getAttribute('aria-expanded'));

  await trigger.evaluate(el => el.click());
  await page.waitForSelector('.lang-menu');
  console.log('after open        :', await page.locator('.lang-option').count(), 'options',
              JSON.stringify(await page.locator('.lang-option-name').allTextContents()));
  await page.screenshot({ path: `${OUT}/lang-open.png`, clip: { x: 860, y: 0, width: 580, height: 260 } });

  // Escape closes it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  console.log('after Escape      :', await page.locator('.lang-option').count(), '(expect 0)');

  // Pick French and confirm the UI actually switches.
  await trigger.evaluate(el => el.click());
  await page.locator('.lang-option', { hasText: 'Français' }).evaluate(el => el.click());
  await page.waitForTimeout(400);
  console.log('after picking FR  :', (await trigger.innerText()).replace(/\s+/g, ' ').trim());
  console.log('menu closed       :', await page.locator('.lang-option').count(), '(expect 0)');
  const frText = await page.locator('body').innerText();
  console.log('FR copy present   :', /Concevez|Choisir|Configurer|Demander/i.test(frText));

  // Outside click closes it.
  await trigger.evaluate(el => el.click());
  await page.waitForTimeout(120);
  await page.mouse.click(400, 600);
  await page.waitForTimeout(200);
  console.log('after outside clk :', await page.locator('.lang-option').count(), '(expect 0)');

  await page.screenshot({ path: `${OUT}/lang-closed.png`, clip: { x: 860, y: 0, width: 580, height: 120 } });
  await browser.close();
})();

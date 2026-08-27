import puppeteer from '/Users/stefano.rapisarda/StefanoHome/Projects/KI/PrecisionMedicineCentral/Showcases/dashboard/web/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--disable-gpu'], defaultViewport: { width: 1680, height: 1000 } });
const page = await browser.newPage();
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

await page.goto('http://localhost:5173/graph', { waitUntil: 'domcontentloaded' });

/* a loading state must appear before anything is drawn */
const sawLoader = await page.waitForSelector('.loading', { timeout: 8000 }).then(() => true, () => false);
check('loading state appears while it settles', sawLoader);

const hiddenWhileSettling = await page.$eval('.cyhost', el =>
  getComputedStyle(el).opacity === '0' || el.classList.contains('settling'));
check('canvas stays hidden until placed', hiddenWhileSettling);

/* sample zoom continuously; the viewport should be framed once and then held */
await page.evaluate(() => {
  window.__zooms = [];
  const tick = () => {
    if (window.__cy) window.__zooms.push(Number(window.__cy.zoom().toFixed(4)));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.waitForFunction(() => !document.querySelector('.loading'), { timeout: 40000 });
check('loading state clears when the layout lands', true);
await new Promise(r => setTimeout(r, 2500));

const zooms = await page.evaluate(() => window.__zooms);
const settled = zooms.filter(z => z > 0);
const distinct = [...new Set(settled)];
/* how many times did the zoom actually change after the first frame? */
let changes = 0;
for (let i = 1; i < settled.length; i++) if (settled[i] !== settled[i - 1]) changes++;
check('viewport is framed once, not repeatedly', changes <= 1,
      `${changes} zoom change(s) across ${settled.length} frames, ${distinct.length} distinct`);

const visible = await page.$eval('.cyhost', el => getComputedStyle(el).opacity);
check('canvas is revealed once placed', Number(visible) > 0.9, `opacity ${visible}`);

/* and the same on a re-settle triggered by a layer toggle */
await page.evaluate(() => { window.__zooms.length = 0;
  [...document.querySelectorAll('#layerbox .layerrow')][1].querySelector('.eye').click(); });
await page.waitForSelector('.loading', { timeout: 8000 }).catch(() => {});
await page.waitForFunction(() => !document.querySelector('.loading'), { timeout: 40000 });
await new Promise(r => setTimeout(r, 1500));
const z2 = (await page.evaluate(() => window.__zooms)).filter(z => z > 0);
let changes2 = 0;
for (let i = 1; i < z2.length; i++) if (z2[i] !== z2[i - 1]) changes2++;
check('re-settle also frames once', changes2 <= 2, `${changes2} change(s)`);

console.log(results.join('\n'));
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await page.screenshot({ path: process.env.SHOT
  ? `${process.env.SHOT}/graph-loaded.png` : 'tests/graph-loaded.png' });
await browser.close();
process.exit(failed ? 1 : 0);

/* Zoom must work in every layout, and must not come back as a side effect of
   the drag-ownership split. Cytoscape's own wheel handler bails unless user
   panning is enabled — which it is not in the force view — so this is the check
   that catches that interaction the moment it regresses. */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--disable-gpu'],
  defaultViewport: { width: 1680, height: 1000 } });
const page = await browser.newPage();
/* Layouts are picked by NAME, not by index: the switch has grown and an index
   silently selects a different view when it does. */
const layoutBtn = (name) => page.evaluate((n) => {
  const b = [...document.querySelectorAll('.layoutsw button')].find((x) => x.textContent.includes(n));
  if (!b) throw new Error('no layout button ' + n);
  b.click();
}, name);

await page.goto('http://localhost:5173/graph', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.querySelector('.loading'), { timeout: 40000 });
/* The loading cover going away is not the same as the graph being ready. The
   cover lifts when the simulation stops moving; the controls mount on the next
   render, and the viewport is framed on the one after that. Clicking in that gap
   measured a zoom of 4 — the maximum — because the fit had not happened yet. The
   bar saying "settled" is the signal that all three are done. */
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 40000 });
await page.waitForSelector('.spinsw', { timeout: 20000 });
await page.click('.spinsw');                     // hold the picture still
await new Promise(r => setTimeout(r, 400));

const zoom = () => page.evaluate(() => window.__cy.zoom());
const pan = () => page.evaluate(() => { const p = window.__cy.pan();
  return `${Math.round(p.x)},${Math.round(p.y)}`; });

const box = await page.$eval('.graphwrap', el => {
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };

await page.mouse.move(centre.x, centre.y);
const start = await zoom();
await page.mouse.wheel({ deltaY: -400 });
await new Promise(r => setTimeout(r, 300));
const zoomedIn = await zoom();
check('wheel zooms in (force view)', zoomedIn > start, `${start.toFixed(3)} → ${zoomedIn.toFixed(3)}`);

await page.mouse.wheel({ deltaY: 400 });
await new Promise(r => setTimeout(r, 300));
const zoomedOut = await zoom();
check('wheel zooms back out', zoomedOut < zoomedIn, `${zoomedIn.toFixed(3)} → ${zoomedOut.toFixed(3)}`);

/* zooming toward the pointer, not the middle: the point under the cursor should
   stay roughly put, which means pan has to move with it */
await page.mouse.move(box.x + box.w * 0.8, box.y + box.h * 0.25);
const panBefore = await pan();
await page.mouse.wheel({ deltaY: -300 });
await new Promise(r => setTimeout(r, 300));
check('zoom is anchored to the pointer', panBefore !== (await pan()),
      `${panBefore} → ${await pan()}`);

/* and the drag still must not pan */
const panPreDrag = await pan(), zoomPreDrag = await zoom();
await page.mouse.move(centre.x, centre.y);
await page.mouse.down();
await page.mouse.move(centre.x - 160, centre.y, { steps: 10 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 300));
check('rotating still does not pan or zoom',
      panPreDrag === (await pan()) && zoomPreDrag === (await zoom()));

/* zooming has to work in the other views too */
for (const name of ['Grouped']) {
  await layoutBtn(name);
  await new Promise(r => setTimeout(r, 1200));
  await page.mouse.move(centre.x, centre.y);
  const before = await zoom();
  await page.mouse.wheel({ deltaY: -400 });
  await new Promise(r => setTimeout(r, 300));
  const after = await zoom();
  check(`wheel zooms in the ${name.toLowerCase()} view`, after !== before,
        `${before.toFixed(3)} → ${after.toFixed(3)}`);
}

/* back to force, and zoom must still be live there */
await layoutBtn('Force');
await page.waitForFunction(() => !document.querySelector('.loading'), { timeout: 40000 });
await new Promise(r => setTimeout(r, 500));
await page.mouse.move(centre.x, centre.y);
const backBefore = await zoom();
await page.mouse.wheel({ deltaY: -400 });
await new Promise(r => setTimeout(r, 300));
check('zoom survives a round trip through the flat views', (await zoom()) !== backBefore);

console.log(results.join('\n'));
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);

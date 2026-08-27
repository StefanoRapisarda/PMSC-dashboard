import puppeteer from '/Users/stefano.rapisarda/StefanoHome/Projects/KI/PrecisionMedicineCentral/Showcases/dashboard/web/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--disable-gpu'], defaultViewport: { width: 1680, height: 1000 } });
const page = await browser.newPage();
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

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
await page.click('.spinsw');           // pause the spin so only the drag moves things
await new Promise(r => setTimeout(r, 400));

const state = () => page.evaluate(() => {
  const cy = window.__cy;
  const p = cy.pan();
  return {
    pan: `${Math.round(p.x)},${Math.round(p.y)}`,
    zoom: Number(cy.zoom().toFixed(4)),
    nodes: cy.nodes().not('.hidden').slice(0, 30)
      .map(n => `${Math.round(n.position().x)},${Math.round(n.position().y)}`).join('|'),
    grabbable: cy.nodes()[0].grabbable(),
    panning: cy.userPanningEnabled(),
  };
});

const before = await state();
check('viewport panning is off while the sim owns positions', before.panning === false);
check('nodes are not grabbable in the force view', before.grabbable === false);

const box = await page.$eval('.graphwrap', el => {
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.5);
await page.mouse.down();
for (let i = 1; i <= 15; i++)
  await page.mouse.move(box.x + box.w * 0.6 - i * 12, box.y + box.h * 0.5, { steps: 1 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 400));

const after = await state();
check('drag rotates the projection', before.nodes !== after.nodes);
check('drag does NOT pan the viewport', before.pan === after.pan,
      `${before.pan} → ${after.pan}`);
check('drag does NOT change zoom', before.zoom === after.zoom,
      `${before.zoom} → ${after.zoom}`);

/* the flat views are the opposite: nothing animates, so pan and grab are back */
await layoutBtn('Layered');
await new Promise(r => setTimeout(r, 1200));
const flat = await state();
check('panning returns in the layered view', flat.panning === true);
check('nodes are grabbable in the layered view', flat.grabbable === true);

await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.5, { steps: 10 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 300));
const flatAfter = await state();
check('drag pans in the layered view', flat.pan !== flatAfter.pan,
      `${flat.pan} → ${flatAfter.pan}`);

/* back to the force view, where turning is the point */
await layoutBtn('Force');
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 40000 });
await new Promise((r) => setTimeout(r, 500));

/* Two gestures, no mode switch: left turns, right moves. A mode button is a
   place to put a gesture, not a substitute for having one. */
check('the drag-mode switch is gone', (await page.$$('.dragsw')).length === 0);

const worstDrift = (a, b) => Math.max(...b.nodes.split('|').map((p, i) => {
  const [x, y] = p.split(',').map(Number);
  const [px, py] = a.nodes.split('|')[i].split(',').map(Number);
  return Math.max(Math.abs(x - px), Math.abs(y - py));
}));

const beforeRight = await state();
await page.mouse.move(box.x + box.w * 0.55, box.y + box.h * 0.5);
await page.mouse.down({ button: 'right' });
await page.mouse.move(box.x + box.w * 0.38, box.y + box.h * 0.44, { steps: 10 });
await page.mouse.up({ button: 'right' });
await new Promise((r) => setTimeout(r, 400));
const afterRight = await state();
check('right-drag pans the view', beforeRight.pan !== afterRight.pan,
      `${beforeRight.pan} → ${afterRight.pan}`);
check('right-drag does not turn the graph', worstDrift(beforeRight, afterRight) <= 2);

/* and a graph you can move has to be one click from coming back */
await page.click('.recentre');
await new Promise((r) => setTimeout(r, 500));
const recentred = await state();
check('recentre brings the graph back', recentred.pan !== afterRight.pan,
      `${afterRight.pan} → ${recentred.pan}`);

/* The gesture list is reference material, so it folds away — but it has to be
   one click from the canvas, not buried in a sidebar. */
check('the controls panel is closed by default', (await page.$$('.helppanel')).length === 0);
await page.click('.helpbtn');
await new Promise((r) => setTimeout(r, 250));
const help = await page.$eval('.helppanel', (el) => el.textContent.replace(/\s+/g, ' '));
check('opening it explains both drags',
      help.includes('Left-drag') && help.includes('Right-drag'), help.slice(0, 80));
await page.click('.helpbtn');
await new Promise((r) => setTimeout(r, 250));
check('and it closes again', (await page.$$('.helppanel')).length === 0);

/* the counts belong in the bar above the canvas, not floating over the corner */
const barOverCanvas = await page.evaluate(() => {
  const hud = document.querySelector('.hud');
  const wrap = document.querySelector('.graphwrap');
  if (!hud || !wrap) return null;
  return { inside: wrap.contains(hud),
           above: hud.getBoundingClientRect().bottom <= wrap.getBoundingClientRect().top + 1 };
});
check('the cohort counts sit outside the canvas', barOverCanvas?.inside === false);
check('and in a bar above it', barOverCanvas?.above === true);

console.log(results.join('\n'));
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);

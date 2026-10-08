/* Drives a real Chrome against the running app. Asserts the things that are only
   observable in the browser: that the 3-D layout settles, that rotation actually
   moves the projection, that it stops when paused, and that it is disabled in
   the flat layouts. */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (name, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu', '--window-size=1680,1000'],
  defaultViewport: { width: 1680, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

/* Layouts are picked by NAME, not by index: the switch has grown and an index
   silently selects a different view when it does. */
const layoutBtn = (name) => page.evaluate((n) => {
  const b = [...document.querySelectorAll('.layoutsw button')].find((x) => x.textContent.includes(n));
  if (!b) throw new Error('no layout button ' + n);
  b.click();
}, name);

await page.goto('http://localhost:5173/graph', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('#layerbox .layerrow').length > 0,
                           { timeout: 20000 });

/* Shell opens the view now, so a suite about the force layout has to ask for it
   rather than assume it. */
await layoutBtn('Force');

/* the HUD reports the settle */
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 40000 });
const hud = await page.$eval('.hud', (el) => el.textContent.replace(/\s+/g, ' ').trim());
check('3-D layout settles', hud.includes('settled'), hud.slice(0, 70));

/* positions must change from one moment to the next while spinning */
/* sample VISIBLE nodes: the simulation only places the switched-on types, so
   hidden ones legitimately never move and would make this always pass */
const sample = () => page.evaluate(() => {
  const cy = window.__cy;
  if (!cy) return null;
  return cy.nodes().not('.hidden').slice(0, 40).map((n) => {
    const p = n.position();
    return `${Math.round(p.x)},${Math.round(p.y)}`;
  }).join('|');
});
const visibleCount = () => page.evaluate(
  () => (window.__cy ? window.__cy.nodes().not('.hidden').length : 0));

const before = await sample();
await new Promise((r) => setTimeout(r, 1200));
const after = await sample();
check('rotation moves the projection', before !== null && before !== after,
      before === null ? 'cy handle not exposed' : '');

/* pausing must hold the picture still */
await page.click('.spinsw');
await new Promise((r) => setTimeout(r, 400));
const paused1 = await sample();
await new Promise((r) => setTimeout(r, 1200));
const paused2 = await sample();
check('pause stops the rotation', paused1 === paused2);

await page.click('.spinsw');   // resume

/* dragging on the canvas rotates */
const box = await page.$eval('.graphwrap', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.click('.spinsw');   // pause first, so any change is from the drag
await new Promise((r) => setTimeout(r, 300));
const preDrag = await sample();
await page.mouse.move(box.x + box.w * 0.7, box.y + box.h * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.5, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const postDrag = await sample();
check('drag rotates the view', preDrag !== postDrag);
await page.click('.spinsw');

/* A selected node is the one thing you are reading; turning the picture moves
   it out from under you. So the spin waits, and lets go when you deselect. */
const tapNode = () => page.evaluate(() => {
  window.__cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample')[0].emit('tap');
});
const tapCanvas = () => page.evaluate(() => {
  const cy = window.__cy; cy.emit({ type: 'tap', target: cy });
});
const spinLabel = () => page.$eval('.spinsw', (el) => el.textContent.replace(/\s+/g, ' ').trim());

await tapNode();
await new Promise((r) => setTimeout(r, 400));
check('selecting a node says the spin is paused', /^▶ Rotation/.test(await spinLabel()),
      await spinLabel());
const held1 = await sample();
await new Promise((r) => setTimeout(r, 1400));
check('and the picture actually holds still', held1 === (await sample()));

await tapCanvas();
await new Promise((r) => setTimeout(r, 400));
check('deselecting resumes it', (await spinLabel()) === '⏸ Rotation', await spinLabel());
const free1 = await sample();
await new Promise((r) => setTimeout(r, 1400));
check('and the picture turns again', free1 !== (await sample()));

/* a hold must not overwrite what the button was set to */
await page.click('.spinsw');                     // user pauses
await tapNode();
await new Promise((r) => setTimeout(r, 300));
await tapCanvas();
await new Promise((r) => setTimeout(r, 400));
check('a selection does not undo a manual pause',
      /^▶ Rotation/.test(await spinLabel()), await spinLabel());
await page.click('.spinsw');                     // back to spinning
await new Promise((r) => setTimeout(r, 300));

/* and pressing play while a node is selected means "spin anyway" */
await tapNode();
await new Promise((r) => setTimeout(r, 300));
await page.click('.spinsw');
await new Promise((r) => setTimeout(r, 400));
check('play overrides the selection hold', (await spinLabel()) === '⏸ Rotation',
      await spinLabel());
await tapCanvas();
await new Promise((r) => setTimeout(r, 300));

await layoutBtn('Force');      // back to Force
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 30000 });
check('force view returns and re-settles', true);

/* the sidebar drives the simulated set: switching Identifier on should pull the
   ID chain into the picture and re-settle around it */
const beforeLayer = await visibleCount();
await page.evaluate(() => {
  [...document.querySelectorAll('#layerbox .layerrow')][1].querySelector('.eye').click();
});
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 40000 });
const afterLayer = await visibleCount();
check('switching a layer on grows the simulated set', afterLayer > beforeLayer,
      `${beforeLayer} → ${afterLayer} nodes`);

await page.screenshot({ path: process.env.SHOT
  ? `${process.env.SHOT}/rotation-force.png` : 'tests/rotation-force.png' });

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (errors.length) console.log('\nconsole errors:\n' + [...new Set(errors)].slice(0, 5).join('\n'));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);

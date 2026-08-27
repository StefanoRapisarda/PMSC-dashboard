import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from '/Users/stefano.rapisarda/StefanoHome/Projects/KI/PrecisionMedicineCentral/Showcases/dashboard/web/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'pmsc-export-'));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--disable-gpu'], defaultViewport: { width: 1680, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

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
await new Promise((r) => setTimeout(r, 1800));
await page.click('.spinsw');                       // hold the picture still

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
/** wait for a file matching `re` to finish arriving, and return its size */
const waitFile = async (re, timeout = 20000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = fs.readdirSync(DL).find((f) => re.test(f) && !f.endsWith('.crdownload'));
    if (hit) {
      const size = fs.statSync(path.join(DL, hit)).size;
      if (size > 0) return { name: hit, size };
    }
    await settle(200);
  }
  return null;
};
const exportFrom = async (heading, label) => {
  await page.evaluate(() => [...document.querySelectorAll('.iconbtn')]
    .find((b) => b.getAttribute('aria-controls') === 'graph-export').click());
  await settle(300);
  await page.evaluate((h, l) => {
    const menu = document.querySelector('.exportmenu');
    const idx = [...menu.querySelectorAll('.mh')].findIndex((x) => x.textContent.includes(h));
    const rows = [...menu.querySelectorAll('.row')];
    [...rows[idx].querySelectorAll('button')].find((b) => b.textContent.trim() === l).click();
  }, heading, label);
};

// ---- the graph, as it stands
const before = await page.evaluate(() => ({ zoom: +window.__cy.zoom().toFixed(4),
                                            pan: window.__cy.pan() }));
await exportFrom('This view', 'PNG');
const viewPng = await waitFile(/^pmsc-graph-force-\d{4}-\d{2}-\d{2}\.png$/);
check('the current view saves as a PNG', !!viewPng, viewPng ? `${viewPng.size} bytes` : 'no file');

await exportFrom('This view', 'PDF');
const viewPdf = await waitFile(/^pmsc-graph-force-\d{4}-\d{2}-\d{2}\.pdf$/);
check('and as a PDF', !!viewPdf, viewPdf ? `${viewPdf.size} bytes` : 'no file');
/* a PDF that is not a PDF downloads perfectly happily, so look at the bytes */
if (viewPdf) {
  const head = fs.readFileSync(path.join(DL, viewPdf.name)).subarray(0, 5).toString('latin1');
  check('which really is a PDF', head === '%PDF-', head);
}

// ---- the whole graph, with its caption
await exportFrom('Whole graph', 'PNG');
const fullPng = await waitFile(/^pmsc-graph-force-full-\d{4}-\d{2}-\d{2}\.png$/);
check('the whole graph saves as a PNG', !!fullPng, fullPng ? `${fullPng.size} bytes` : 'no file');

/* The caption is drawn under the picture, so the detailed export is taller than
   the plain one at the same width. That is the cheapest way to prove from the
   outside that the caption block was actually drawn. */
if (viewPng && fullPng) {
  const size = (f) => {
    const b = fs.readFileSync(path.join(DL, f));
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  };
  const a = size(viewPng.name), b = size(fullPng.name);
  check('the whole-graph export carries a caption block underneath',
        b.w === a.w && b.h > a.h, `${a.w}x${a.h} then ${b.w}x${b.h}`);
}

/* Framing the whole graph moves the viewport. Leaving the reader somewhere they
   did not ask to be would be a worse bug than a missing export. */
const after = await page.evaluate(() => ({ zoom: +window.__cy.zoom().toFixed(4),
                                           pan: window.__cy.pan() }));
check('and puts the viewport back exactly where it was',
      after.zoom === before.zoom && Math.abs(after.pan.x - before.pan.x) < 0.5
      && Math.abs(after.pan.y - before.pan.y) < 0.5,
      `${JSON.stringify(before)} then ${JSON.stringify(after)}`);

// ---- the shell view, whose rings live on our canvas rather than Cytoscape's
await page.evaluate(() => [...document.querySelectorAll('.layoutsw button')]
  .find((b) => b.textContent.includes('Shell')).click());
await settle(1800);
await exportFrom('Whole graph', 'PNG');
const shellPng = await waitFile(/^pmsc-graph-shell-full-\d{4}-\d{2}-\d{2}\.png$/);
check('the shell view saves too', !!shellPng, shellPng ? `${shellPng.size} bytes` : 'no file');

// ---- the whole-path timeline, which is HTML rather than canvas
await page.evaluate(() => [...document.querySelectorAll('.layoutsw button')]
  .find((b) => b.textContent.trim() === 'Force').click());
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 40000 });
await settle(800);
await page.evaluate(() => {
  window.__cy.nodes().not('.hidden')
    .filter((x) => x.data('type') === 'sample' && x.data('reached') === 8)[0]
    .emit({ type: 'cxttap', originalEvent: { preventDefault() {} } });
});
await settle(400);
await page.evaluate(() => [...document.querySelectorAll('.ctx button')]
  .find((b) => b.textContent.includes('Trace the whole path')).click());
await settle(1000);

/* What the picture must contain: the dialog is a fixed-size window onto content
   that scrolls inside it, so the first version of this photographed the window
   and lost the platform cards off the right. */
const dialog = await page.evaluate(() => {
  const w = document.querySelector('.win');
  const scroll = w.querySelector('.scroll');
  return { winH: Math.round(w.getBoundingClientRect().height),
           contentH: Math.round(w.scrollHeight),
           scrollsInside: scroll.scrollWidth > scroll.clientWidth
                       || scroll.scrollHeight > scroll.clientHeight,
           rows: w.querySelectorAll('.rowlabel').length };
});
await page.evaluate(() => [...document.querySelectorAll('.save button')]
  .find((b) => b.textContent.trim() === 'PNG').click());
const tlPng = await waitFile(/^pmsc-timeline-.*\.png$/);
check('the timeline saves as a PNG', !!tlPng, tlPng ? `${tlPng.size} bytes` : 'no file');
if (tlPng) {
  const b = fs.readFileSync(path.join(DL, tlPng.name));
  const h = b.readUInt32BE(20) / 2;                 // exported at twice the scale
  check('at its full height, not cropped to the dialog',
        h > dialog.winH + 20, `${Math.round(h)}px tall, dialog is ${dialog.winH}px`);
}

/* The Save and Close buttons belong to the app, not to the figure. */
const stripped = await page.evaluate(() =>
  document.querySelectorAll('.win [data-noexport]').length);
check('the app controls are marked to be left out of the picture', stripped >= 2,
      `${stripped} marked`);

await page.evaluate(() => [...document.querySelectorAll('.save button')]
  .find((b) => b.textContent.trim() === 'PDF').click());
const tlPdf = await waitFile(/^pmsc-timeline-.*\.pdf$/);
check('and as a PDF', !!tlPdf, tlPdf ? `${tlPdf.size} bytes` : 'no file');

check('no page errors', errors.length === 0, errors[0] ?? '');

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
fs.rmSync(DL, { recursive: true, force: true });
await browser.close();
process.exit(failed ? 1 : 0);

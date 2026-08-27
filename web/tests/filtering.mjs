/* Filtering and elision.

   Two controls with two different meanings, and the graph has to behave
   differently for each:

     * A facet ticks a subcohort. Unticking removes those objects and everything
       hanging off them — a half-transparent specimen is still a specimen you
       have to read past.
     * A layer toggle picks a level of detail. The objects still exist, so the
       derivation chain across them is BRIDGED and the bridge says what it stands
       for. Dropping the connection would assert that two related things are
       unrelated; drawing it as a plain edge would assert a directness that is
       not there.

   Bridges follow the provenance spine only. Joining a hidden node's neighbours
   in general invents relationships that are not provenance, and explodes: three
   platform nodes would become ~14,000 edges that way, versus none along the
   spine, because nothing flows past a platform. */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--disable-gpu'],
  defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
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
await page.click('.spinsw');
await new Promise((r) => setTimeout(r, 600));

const state = () => page.evaluate(() => {
  const cy = window.__cy;
  const vis = cy.nodes().not('.hidden');
  const byType = {};
  vis.forEach((n) => { const t = n.data('type'); byType[t] = (byType[t] || 0) + 1; });
  return {
    visible: vis.length,
    dimmed: cy.nodes().filter((n) => n.hasClass('dim')).length,
    bridges: cy.edges('.bridge').length,
    isolatedTypes: [...new Set(vis.filter((n) =>
      n.connectedEdges().not('.hidden').length === 0).map((n) => n.data('type')))],
    byType,
  };
});
const facet = (label) => page.evaluate((l) => {
  [...document.querySelectorAll('aside.left input[type=checkbox]')]
    .find((b) => b.parentElement.textContent.trim() === l).click();
}, label);
/* by name, not by position: the list of node types changes */
const layer = (name) => page.evaluate((label) => {
  [...document.querySelectorAll('#layerbox .layerrow')]
    .find((r) => r.textContent.trim().startsWith(label)).querySelector('.eye').click();
}, name);
/* Reset lived in the highlight panel, which is gone. Clicking the dark
   background clears the same two sets, so that is the way back. */
const clearAll = async () => {
  await page.evaluate(() => { const cy = window.__cy; cy.emit({ type: 'tap', target: cy }); });
  await settle(400);
};

const sun = (name) => page.evaluate((label) => {
  [...document.querySelectorAll('#layerbox .layerrow')]
    .find((r) => r.textContent.trim().startsWith(label)).querySelector('.sun').click();
}, name);
const settle = (ms = 1400) => new Promise((r) => setTimeout(r, ms));

const base = await state();
check('nothing is left dimmed by default', base.dimmed === 0);

/* A translucent ring the same colour as the dot, padded to nearly half its
   radius, has no edge — several hundred of them read as the whole picture being
   out of focus. So nothing glows at rest. Where a glow does survive it must
   follow the node shape: Cytoscape's underlay defaults to a rounded rectangle,
   which puts a square around a circular node and reads as though it encoded
   something. */
const halo = await page.evaluate(() => {
  const cy = window.__cy;
  const n = cy.nodes().not('.hidden')[0];
  n.addClass('marked');
  const marked = { shape: n.style('underlay-shape'), opacity: Number(n.style('underlay-opacity')) };
  n.removeClass('marked');
  return {
    rest: Number(n.style('underlay-opacity')),
    node: n.style('shape'),
    marked,
    /* measure the outcome, not an internal field: the backing store's width
       over the CSS width IS the resolution the dots are drawn at */
    canvasRatio: (() => {
      const c = document.querySelector('.cyhost canvas');
      return c ? Math.round((c.width / c.clientWidth) * 100) / 100 : null;
    })(),
    devicePixelRatio: window.devicePixelRatio,
  };
});
check('nothing glows at rest', halo.rest === 0, `underlay-opacity ${halo.rest}`);
check('a hand-picked node still glows', halo.marked.opacity > 0);
check('and its glow follows the node shape', halo.marked.shape === 'ellipse',
      `halo ${halo.marked.shape} behind a ${halo.node}`);
/* Half-resolution rendering gives every dot a soft edge on a Retina screen,
   which reads as the picture being out of focus rather than as a setting. */
check('the canvas renders at the display resolution',
      halo.canvasRatio === Math.min(2, halo.devicePixelRatio),
      `backing store ${halo.canvasRatio}x at device ${halo.devicePixelRatio}x`);


// ---- a facet removes, and takes what hangs off it
await facet('Female'); await settle();
const filtered = await state();
check('unticking a facet removes nodes rather than fading them',
      filtered.visible < base.visible && filtered.dimmed === 0,
      `${base.visible} → ${filtered.visible} visible, ${filtered.dimmed} dimmed`);
check('the samples of excluded patients go too',
      filtered.byType.sample < base.byType.sample,
      `${base.byType.sample} → ${filtered.byType.sample} samples`);
check('and so do their aliquots',
      filtered.byType.aliquot < base.byType.aliquot,
      `${base.byType.aliquot} → ${filtered.byType.aliquot} aliquots`);
await facet('Female'); await settle();

// ---- a layer toggle bridges the chain instead of breaking it
await layer('Aliquot');
await settle(2200);
const hidden = await state();
check('hiding a level of the chain creates bridges',
      hidden.bridges > 0, `${hidden.bridges} bridges`);
check('the platforms stay connected through the bridge',
      hidden.byType.platform === base.byType.platform
      && !hidden.isolatedTypes.includes('platform'),
      `platforms: ${hidden.byType.platform}, isolated: ${hidden.isolatedTypes.join(',') || 'none'}`);

const via = await page.evaluate(() =>
  [...new Set(window.__cy.edges('.bridge').map((e) => e.data('via')))]);
check('every bridge records what it stands for',
      via.length > 0 && via.every((v) => typeof v === 'string' && v.length > 0),
      via.slice(0, 3).join(' / '));

// ---- several hidden levels in a row still make one honest edge
await layer('Sample');
await settle(2200);
const deeper = await state();
const chains = await page.evaluate(() =>
  [...new Set(window.__cy.edges('.bridge').map((e) => e.data('via')))]
    .filter((v) => v.includes('→')));
check('consecutive hidden levels collapse into one bridge that names them all',
      chains.length > 0, chains.slice(0, 2).join(' / '));
check('bridges never multiply into a hub projection',
      deeper.bridges < 1500, `${deeper.bridges} bridges`);

await layer('Sample'); await layer('Aliquot'); await settle(2200);

// ---- a click selects and fills the panel; tracing is a named command now
await page.evaluate(() => {
  window.__cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample')[0].emit('tap');
});
await settle();
const clicked = await state();
const panel = await page.$eval('aside.right', (e) => e.textContent.trim());
check('a click selects and fills the panel without dimming anything',
      clicked.dimmed === 0 && panel.length > 40, `${clicked.dimmed} dimmed`);

/* The panel used to head itself with the standard a type is anchored to —
   "CKG Analytical_sample" for an aliquot — which never contains the word the
   sidebar, the legend and the tooltip all use. It has to say what you clicked
   in the same words as the rest of the page. */
const heading = async (type) => {
  await page.evaluate((t) => {
    window.__cy.nodes().not('.hidden').filter((n) => n.data('type') === t)[0].emit('tap');
  }, type);
  await settle(400);
  return page.$eval('aside.right .panel-title', (e) => e.textContent.replace(/\s+/g, ' ').trim());
};
const aliHead = await heading('aliquot');
check('clicking an aliquot names it an Aliquot', /^Aliquot\b/.test(aliHead), aliHead);
check('and still gives the standard it maps to',
      /CKG Analytical_sample/.test(aliHead), aliHead);
const sampleHead = await heading('sample');
check('a sample is headed Sample', /^Sample\b/.test(sampleHead), sampleHead);
const patientHead = await heading('patient');
check('a patient is headed Patient', /^Patient\b/.test(patientHead), patientHead);

/* PDL-0001 and PMSC-2025-0001-DNA are codes, not names, so the panel says so
   rather than leaving the reader to infer it */
const titleOf = async (type) => {
  await heading(type);
  return page.$eval('aside.right .title', (e) => ({
    tag: e.querySelector('.idtag')?.textContent.trim() ?? null,
    name: e.querySelector('.name')?.textContent.trim() ?? null,
  }));
};
for (const type of ['patient', 'sample', 'aliquot']) {
  const t = await titleOf(type);
  check(`a ${type}'s code is marked as an ID`, t.tag === 'ID', `${t.tag} ${t.name}`);
}
/* a facility has a name, not a code — tagging it would be a lie */
const plat = await titleOf('platform');
check('a platform name is not tagged as an ID', plat.tag === null, `${plat.tag} ${plat.name}`);

/* rotating must not empty the picture: the edges are the provenance */
const beforeSpin = await page.evaluate(() => window.__cy.edges().not('.hidden').length);
await page.click('.spinsw');                       // resume rotation
await settle(900);
const duringSpin = await page.evaluate(() => window.__cy.edges().not('.hidden').length);
check('connections stay visible while the graph turns',
      duringSpin === beforeSpin, `${beforeSpin} → ${duringSpin} edges`);
const box = await page.$eval('.graphwrap', (el) => {
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.5, { steps: 8 });
const duringDrag = await page.evaluate(() => window.__cy.edges().not('.hidden').length);
await page.mouse.up();
check('and while it is being dragged', duringDrag === beforeSpin,
      `${beforeSpin} → ${duringDrag} edges`);

/* the ⓘ next to each node type used the browser's built-in tooltip, which is
   slow enough to look broken, and said only the standard's name */
const tipText = await page.evaluate(async () => {
  const icon = [...document.querySelectorAll('#layerbox .layerrow')]
    .find((r) => r.textContent.trim().startsWith('Aliquot')).querySelector('.info');
  icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  icon.closest('.layerrow').classList.add('probe');
  const tip = icon.querySelector('.tip');
  return { text: tip.textContent.replace(/\s+/g, ' ').trim(),
           inside: tip.getBoundingClientRect().left >= 0 };
});
check('the node-type help says what the thing is, in plain words',
      /fraction extracted/.test(tipText.text), tipText.text.slice(0, 50));

/* activities, QC results and deviations are no longer objects on the canvas */
const listed = await page.$$eval('#layerbox .layerrow',
  (ls) => ls.map((l) => l.textContent.trim().split(' ')[0]));
/* QC outcome and deviations are properties to filter on. Activities are drawn,
   because which steps ran on a specimen is a question about the material. */
check('QC and deviation are not node types',
      !listed.some((l) => ['QC', 'Deviation'].includes(l)), listed.join(', '));
check('activities are', listed.includes('Activity'));
const emitted = await page.evaluate(() =>
  [...new Set(window.__cy.nodes().map((n) => n.data('type')))].sort());
check('and the graph does not carry them at all',
      !emitted.some((t) => ['qc', 'deviation'].includes(t)), emitted.join(', '));
check('operators are connected to the steps they performed',
      await page.evaluate(() => window.__cy.edges()
        .filter((e) => e.data('type') === 'performed').length) > 0);

/* deviation became a filter instead */
const before = await state();
await page.evaluate(() => {
  [...document.querySelectorAll('aside.left input[type=checkbox]')]
    .find((b) => b.parentElement.textContent.trim() === 'No deviation recorded').click();
});
await settle();
const onlyDeviations = await state();
check('filtering to samples with a deviation narrows the cohort',
      onlyDeviations.byType.sample < before.byType.sample,
      `${before.byType.sample} → ${onlyDeviations.byType.sample} samples`);
await page.evaluate(() => {
  [...document.querySelectorAll('aside.left input[type=checkbox]')]
    .find((b) => b.parentElement.textContent.trim() === 'No deviation recorded').click();
});
await settle();
check('the help stays inside the sidebar', tipText.inside);

/* ONE CARD, ONE NODE. Clicking a sample used to answer with the sample's facts,
   then its four fractions and their QC, then a chain of identifiers belonging to
   the patient and every fraction. Most of what you were reading was about
   something you had not clicked on. */
await page.evaluate(() => {
  const cy = window.__cy;
  cy.nodes().not('.hidden')
    .filter((n) => n.data('type') === 'sample' && (n.data('_alisIdx') || []).length >= 3)[0]
    .emit('tap');
});
await settle(700);
const single = await page.evaluate(() => ({
  cards: document.querySelectorAll('aside.right .card').length,
  keys: [...document.querySelectorAll('aside.right .kv .k')]
    .map((k) => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
  text: document.querySelector('aside.right').textContent.replace(/\s+/g, ' '),
}));
check('a single click describes one node and nothing else', single.cards === 1,
      `${single.cards} cards`);
check('it shows that node\'s own names', /PAD \(pathology\)/.test(single.keys)
      && /tube barcode/.test(single.keys), single.keys);
check('and none of its fractions', !/PMSC-\d{4}-\d+-(DNA|RNA|PROT|PEP)/.test(single.text)
      && !/aliquot ID/.test(single.keys), single.keys);

/* The ID chain is still the WP2 deliverable. It is read by walking the family,
   where each row of the chain sits on the thing it names rather than being
   flattened into one list under whichever node you happened to click. */
await page.evaluate(() => {
  const cy = window.__cy;
  cy.nodes().not('.hidden')
    .filter((n) => n.data('type') === 'sample' && (n.data('_alisIdx') || []).length >= 3)[0]
    .emit('dbltap');
});
await settle(800);
const familyPanel = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('aside.right .card')].map((c) => ({
    kind: c.querySelector('.panel-title').textContent.replace(/\s+/g, ' ').trim(),
    name: c.querySelector('.name')?.textContent.trim(),
    /* the graphical element that separates one card from the next */
    ruled: getComputedStyle(c).borderTopWidth !== '0px',
    dot: !!c.querySelector('.dot'),
  })),
  keys: [...document.querySelectorAll('aside.right .kv .k')]
    .map((k) => k.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
}));
check('a double click describes every node in the family',
      familyPanel.cards.length > 3, `${familyPanel.cards.length} cards`);
check('the one you clicked leads', /^Sample/.test(familyPanel.cards[0].kind),
      familyPanel.cards.map((c) => c.kind.split(' ·')[0]).join(' → '));
check('each card after the first is separated by a rule and a colour mark',
      familyPanel.cards.slice(1).every((c) => c.ruled && c.dot),
      familyPanel.cards.map((c) => `${c.ruled}/${c.dot}`).join(' '));
check('the chain still runs from the patient study ID to the fractions',
      /eCRF study ID/.test(familyPanel.keys) && /PAD \(pathology\)/.test(familyPanel.keys)
      && /aliquot ID/.test(familyPanel.keys), familyPanel.keys.slice(0, 90));
await clearAll();

const linked = await page.evaluate(() => {
  const cy = window.__cy;
  const owners = {};
  cy.edges().filter((e) => e.data('type') === 'identified_as').forEach((e) => {
    const t = cy.getElementById(e.data('source')).data('type');
    owners[t] = (owners[t] || 0) + 1;
  });
  return owners;
});
check('identifiers hang off patients, samples and aliquots alike',
      linked.patient > 0 && linked.sample > 0 && linked.aliquot > 0,
      JSON.stringify(linked));

check('the use-case views are gone',
      (await page.$$('aside.left .chips .chip')).length === 0
      && (await page.$$('.ucbtn')).length === 0);

// ---- highlight: pick nodes out by hand, push everything else back
const pick = (i) => page.evaluate((idx) => {
  const cy = window.__cy;
  cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample')[idx]
    .emit({ type: 'tap', originalEvent: { shiftKey: true } });
}, i);
await pick(0); await pick(1); await pick(2);
await settle(500);
const hl = await page.evaluate(() => ({
  marked: window.__cy.nodes('.marked').length,
  faded: window.__cy.nodes('.faded').length,
  visible: window.__cy.nodes().not('.hidden').length,
  panel: document.querySelector('.hud .lit')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
}));
/* Cytoscape ids are strings and GraphNode.id is a number; if the two are not
   reconciled the picked set matches nothing and everything fades, silently */
check('shift-click marks the nodes it picked', hl.marked === 3, `${hl.marked} marked`);
check('everything else fades back', hl.faded === hl.visible - 3,
      `${hl.faded} faded of ${hl.visible} visible`);
check('the bar counts what is highlighted', /3 highlighted/.test(hl.panel ?? ''), hl.panel);

await clearAll();
const cleared = await page.evaluate(() => ({
  marked: window.__cy.nodes('.marked').length,
  faded: window.__cy.nodes('.faded').length,
}));
check('clicking the background clears the highlight',
      cleared.marked === 0 && cleared.faded === 0);

/* processing steps are nodes again, and their kind is a filter */
await layer('Activity');
await settle(2600);
const withSteps = await page.evaluate(() => {
  const vis = window.__cy.nodes().not('.hidden');
  const kinds = {};
  vis.filter((n) => n.data('type') === 'activity')
     .forEach((n) => { const k = n.data('kind'); kinds[k] = (kinds[k] || 0) + 1; });
  return kinds;
});
check('every kind of processing step is drawn',
      Object.keys(withSteps).length >= 7, Object.keys(withSteps).sort().join(', '));
/* collection and SP3 were absent for a while: the seeder resolved a step's
   specimen by following USED, which those two kinds do not have */
check('collection and SP3 are among them',
      withSteps.collection > 0 && withSteps.sp3 > 0,
      `collection ${withSteps.collection}, sp3 ${withSteps.sp3}`);

await layer('Operator');
await settle(2600);
check('operators appear with the steps they performed',
      await page.evaluate(() => window.__cy.nodes().not('.hidden')
        .filter((n) => n.data('type') === 'operator').length) > 0);

const dropStep = (label) => page.evaluate((l) => {
  [...document.querySelectorAll('aside.left input[type=checkbox]')]
    .find((b) => b.parentElement.textContent.trim() === l).click();
}, label);
const beforeDrop = await page.evaluate(() => window.__cy.nodes().not('.hidden')
  .filter((n) => n.data('type') === 'activity').length);
await dropStep('Collection · surgery');
await settle(2600);
const afterDrop = await page.evaluate(() => window.__cy.nodes().not('.hidden')
  .filter((n) => n.data('type') === 'activity').length);
check('unticking a step removes just that kind', afterDrop < beforeDrop,
      `${beforeDrop} → ${afterDrop} steps`);
await dropStep('Collection · surgery');
await layer('Operator'); await layer('Activity');
await settle(2600);

/* double-click lights a node with its parents and children */
const dbl = (which) => page.evaluate((i) => {
  window.__cy.nodes().not('.hidden')
    .filter((n) => n.data('type') === 'sample')[i].emit('dbltap');
}, which);
const bright = () => page.evaluate(() => {
  const vis = window.__cy.nodes().not('.hidden');
  const lit = vis.filter((n) => !n.hasClass('faded'));
  return { count: lit.length,
           types: [...new Set(lit.map((n) => n.data('type')))].sort() };
});

await dbl(0);
await settle(600);
const family = await bright();
check('double-click lights a node with its parents and children',
      family.count > 1 && family.types.includes('sample') && family.types.includes('patient'),
      `${family.count} bright: ${family.types.join(',')}`);

/* a second double-click narrows to what the two have in common, rather than
   growing the set — an OR is what the sun already does */
await dbl(1);
await settle(600);
const both = await bright();
check('a second double-click narrows to what they have in common',
      both.count < family.count, `${family.count} → ${both.count}`);

/* clicking the dark background is the way back to the whole picture */
await page.evaluate(() => { const cy = window.__cy; cy.emit({ type: 'tap', target: cy }); });
await settle(500);
check('clicking empty canvas clears the highlight',
      (await page.evaluate(() => window.__cy.nodes('.faded').length)) === 0);

/* the sun beside a type lights every node of that type at once */
await sun('Aliquot');
await settle(600);
const litOne = await page.evaluate(() => {
  const cy = window.__cy, vis = cy.nodes().not('.hidden');
  const bright = vis.filter((n) => !n.hasClass('faded'));
  return { types: [...new Set(bright.map((n) => n.data('type')))], faded: vis.filter((n) => n.hasClass('faded')).length };
});
check('a sun lights its whole type and dims the rest',
      litOne.types.length === 1 && litOne.types[0] === 'aliquot' && litOne.faded > 0,
      `${litOne.types.join(',')} bright, ${litOne.faded} faded`);

await sun('Patient');
await settle(600);
const litTwo = await page.evaluate(() =>
  [...new Set(window.__cy.nodes().not('.hidden').filter((n) => !n.hasClass('faded'))
    .map((n) => n.data('type')))].sort());
check('suns add up', litTwo.join(',') === 'aliquot,patient', litTwo.join(','));

/* a sun and a node family narrow each other: "the aliquots of THIS specimen" */
await sun('Patient');
await dbl(0);
await settle(700);
const anded = await bright();
check('a sun and a double-click narrow each other',
      anded.types.length === 1 && anded.types[0] === 'aliquot',
      `${anded.count} bright: ${anded.types.join(',')}`);
await clearAll();

/* turning the last sun off ends the highlight, so Reset is a shortcut not the
   only way out */
await sun('Aliquot'); await sun('Patient');
await settle(600);
await sun('Aliquot'); await sun('Patient');
await settle(600);
check('turning every sun off clears the highlight on its own',
      await page.evaluate(() => window.__cy.nodes('.faded').length) === 0);

/* the highlight panel and its picking mode are gone: shift-click (checked
   above) and the ☀ suns are how a highlight starts now */
check('the highlight panel is gone',
      (await page.$$('.hlbox')).length === 0 && (await page.$$('.pick')).length === 0);
check('and so is its Reset button', (await page.$$('.reset')).length === 0);

/* the right-click menu still traces and clears — it just no longer offers to
   add one node at a time */
await page.evaluate(() => {
  const cy = window.__cy;
  const n = cy.nodes().not('.hidden').filter((x) => x.data('type') === 'sample')[0];
  n.emit({ type: 'cxttap', originalEvent: { preventDefault() {} } });
});
await settle(300);
const menu = await page.$$eval('.ctx button', (bs) => bs.map((b) => b.textContent.trim()));
check('the menu no longer offers "Add to highlight"',
      !menu.some((t) => /to highlight$/.test(t)), menu.join(' / '));
check('but it still traces and highlights a family',
      menu.some((t) => /Trace the whole path/.test(t))
      && menu.some((t) => /Highlight its family/.test(t)), menu.join(' / '));
await page.keyboard.press('Escape');
await clearAll();

/* the only legend left explains the three ways an edge can look */
const edgeKey = await page.$$eval('.edgekey div', (rows) =>
  rows.map((r) => r.textContent.trim()));
check('the connections key lists the three edge styles', edgeKey.length === 3,
      edgeKey.join(' / '));
check('and nothing else', (await page.$$('aside.left .legendp')).length === 0);

/* Toggling a layer must not hide the graph: watching the ID chain pull itself
   onto each specimen is the reason to tick that box, and a loading cover over
   the canvas hides exactly the change you asked to see. This is a FORCE-layout
   behaviour — the shell computes its positions, so there is nothing to re-settle
   and no progress to report. */
await layoutBtn('Force');
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 40000 });
await settle(500);
await layer('Identifier');
await settle(400);
const midToggle = await page.evaluate(() => ({
  covered: !!document.querySelector('.loading'),
  hiddenCanvas: document.querySelector('.cyhost').classList.contains('settling'),
  corner: document.querySelector('.resettle') !== null,
}));
check('re-settling leaves the graph on screen',
      !midToggle.covered && !midToggle.hiddenCanvas);
check('progress moves to a corner instead', midToggle.corner);
await page.waitForFunction(() => !document.querySelector('.resettle'), { timeout: 40000 });
await layer('Identifier');
await settle(1500);

// ---- the agreed interaction conventions
await page.evaluate(() => { const cy = window.__cy; cy.emit({ type: 'tap', target: cy }); });
await settle(400);
await page.evaluate(() => {
  window.__cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample')[0].emit('tap');
});
await settle(400);
/* a click selects and fills the panel; dimming the whole canvas is a bigger act
   than a single click should carry */
check('single click selects without dimming the canvas',
      await page.evaluate(() => window.__cy.nodes('.dim').length + window.__cy.nodes('.faded').length) === 0);

/* A right-click while something is lit clears it, so the menu is only reachable
   from a clean canvas. That rule is checked on its own further down. */
await clearAll();
await page.evaluate(() => {
  window.__cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample')[0]
    .emit({ type: 'cxttap', originalEvent: { preventDefault() {} } });
});
await settle(400);
const items = await page.$$eval('.ctx button', (b) => b.map((x) => x.textContent.trim()));
check('right-click opens a menu with the commands that cannot fit on a gesture',
      items.some((i) => /whole path/.test(i)) && items.some((i) => /come from/.test(i))
      && items.some((i) => /became of it/.test(i)), items.join(' | '));

await page.evaluate(() => [...document.querySelectorAll('.ctx button')]
  .find((b) => b.textContent.includes('whole path')).click());
await page.waitForFunction(() => !document.querySelector('.resettle'), { timeout: 40000 });
await settle(600);
const lineage = await page.evaluate(() => {
  const vis = window.__cy.nodes().not('.hidden');
  const lit = vis.filter((n) => !n.hasClass('faded'));
  return { bright: lit.length, visible: vis.length,
           types: [...new Set(lit.map((n) => n.data('type')))].sort(),
           steps: [...document.querySelectorAll('.path li .what')].map((e) => e.textContent.trim()) };
});
check('tracing a path lights one chain and dims the rest',
      lineage.bright > 3 && lineage.bright < lineage.visible / 4,
      `${lineage.bright} of ${lineage.visible}`);
check('the path runs from the patient through to the tumour board',
      lineage.types.includes('patient') && lineage.types.includes('mtb'), lineage.types.join(','));
/* dates alone put the undated aliquots first and the tumour board too early:
   the order has to follow the pipeline, not the calendar */
check('the panel lists the path in the order it happened',
      /^PDL-/.test(lineage.steps[0]) && /MTB/.test(lineage.steps[lineage.steps.length - 1]),
      `${lineage.steps[0]} … ${lineage.steps[lineage.steps.length - 1]}`);

await clearAll();

// ---- the two views a cohort question actually asks
/* SHELL. Position has to mean the thing the label claims: radius is the stage
   the material reached. Patients are enrolled and nothing else, so they must be
   the outermost ring; a specimen that reached the tumour board must be inside a
   specimen that stalled at PM-SC prep. If that ordering does not hold, the rings
   are decoration. */
await layoutBtn('Shell');
await settle(1200);
const shell = await page.evaluate(() => {
  const cy = window.__cy, sim = window.__rotator?.sim;
  /* the REAL radius, not the projected one: the projection flattens one axis,
     so a stage holding four nodes can look nearer the centre than the stage
     outside it purely by where its spokes point */
  const r = (n) => {
    const p = sim?.positionOf(Number(n.id()));
    return p ? Math.hypot(p.x, p.y, p.z) : NaN;
  };
  const byStage = {};
  cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample').forEach((n) => {
    (byStage[n.data('reached')] = byStage[n.data('reached')] || []).push(r(n));
  });
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const patients = cy.nodes().not('.hidden').filter((n) => n.data('type') === 'patient');
  const mtb = cy.nodes().not('.hidden').filter((n) => n.data('type') === 'mtb')[0];
  return {
    stageMedians: Object.fromEntries(Object.entries(byStage)
      .map(([k, v]) => [k, Math.round(med(v))])),
    patientMedian: Math.round(med(patients.map(r))),
    mtbAtCentre: mtb ? Math.round(Math.hypot(mtb.position().x, mtb.position().y)) : null,
  };
});
const stages = Object.keys(shell.stageMedians).map(Number).sort((a, b) => a - b);
/* every step further along the pipeline must sit strictly further in, or the
   labelled rings are decoration */
const monotonic = stages.every((st, i) =>
  i === 0 || shell.stageMedians[st] < shell.stageMedians[stages[i - 1]]);
check('further along the pipeline sits further in', monotonic,
      stages.map((st) => `${st}:${shell.stageMedians[st]}`).join(' '));
check('patients are the outermost ring',
      shell.patientMedian > shell.stageMedians[stages[0]],
      `patients ${shell.patientMedian} vs stage ${stages[0]} ${shell.stageMedians[stages[0]]}`);
check('the tumour board is the centre', shell.mtbAtCentre === 0, String(shell.mtbAtCentre));

const ringGuides = await page.evaluate(() => {
  const c = document.querySelector('canvas.hulls');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});
/* a radius that means something and does not say so invites the reader to
   invent a meaning, and they will pick the wrong one */
check('the stage rings are drawn', ringGuides > 2000, `${ringGuides} px painted`);
const shellRule = await page.$eval('.hud .rule', (e) => e.textContent.trim());
check('and the bar states what distance means', /further in/.test(shellRule), shellRule);

/* CLUSTERED. Every node lands in exactly one outcome, the buckets add up to the
   cohort, and nothing that is not material is filed as an outcome. */
await layoutBtn('Clustered');
await settle(1200);
const clustered = await page.evaluate(() => {
  const cy = window.__cy, counts = {}, byType = {};
  cy.nodes().not('.hidden').forEach((n) => {
    const o = n.data('outcome');
    counts[o] = (counts[o] || 0) + 1;
    byType[n.data('type')] = byType[n.data('type')] || new Set();
    byType[n.data('type')].add(o);
  });
  /* clusters must actually separate: the spread WITHIN a bucket has to be small
     next to the distance BETWEEN buckets, or it is one blob with labels */
  const mid = {};
  cy.nodes().not('.hidden').forEach((n) => {
    const o = n.data('outcome'), p = n.position();
    (mid[o] = mid[o] || []).push(p);
  });
  const centres = {}, spread = {};
  for (const o in mid) {
    const ps = mid[o];
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const cy2 = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    centres[o] = { x: cx, y: cy2 };
    spread[o] = Math.max(...ps.map((p) => Math.hypot(p.x - cx, p.y - cy2)));
  }
  const keys = Object.keys(centres);
  let nearest = Infinity;
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      nearest = Math.min(nearest, Math.hypot(centres[keys[i]].x - centres[keys[j]].x,
                                             centres[keys[i]].y - centres[keys[j]].y));
  return { counts, visible: cy.nodes().not('.hidden').length,
           nonMaterial: [...(byType.platform ?? [])].concat([...(byType.mtb ?? [])]),
           widest: Math.round(Math.max(...Object.values(spread))), nearest: Math.round(nearest) };
});
const total = Object.values(clustered.counts).reduce((a, b) => a + b, 0);
check('every visible node lands in exactly one outcome', total === clustered.visible,
      `${total} of ${clustered.visible} visible`);
check('the buckets are the four outcomes plus context',
      Object.keys(clustered.counts).sort().join(',')
        === 'QC failure,context,not collected,on track,stalled',
      Object.keys(clustered.counts).sort().join(','));
/* an aliquot that failed its own QC is a failure whatever its specimen did, and
   a peptide derives from a protein aliquot rather than straight from a specimen
   — following only the first hop filed 87 of them as "not collected" */
check('no phantom "not collected" material',
      clustered.counts['not collected'] === 5,
      `${clustered.counts['not collected']} — should be the 5 patients with nothing taken`);
check('platforms and the board are not given an outcome',
      clustered.nonMaterial.every((o) => o === 'context'), clustered.nonMaterial.join(','));
check('the clusters actually separate', clustered.nearest > clustered.widest,
      `widest cluster ${clustered.widest}, closest pair ${clustered.nearest}`);
const hulls = await page.evaluate(() => {
  const c = document.querySelector('canvas.hulls');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});
check('the outcome hulls are drawn', hulls > 2000, `${hulls} px painted`);

/* The clustered views are balls in three dimensions, not flat discs, so they
   turn like the other two — turning is how you see inside a group of 503. Only
   Layered stays flat: its left-to-right axis is the one thing it says. */
check('the clustered view can be turned',
      await page.$eval('.spinsw', (el) => el.disabled) === false);
const spun = async () => {
  const before = await page.evaluate(() => window.__cy.nodes().not('.hidden').slice(0, 30)
    .map((n) => `${Math.round(n.position().x)},${Math.round(n.position().y)}`).join('|'));
  await settle(1400);
  return before !== (await page.evaluate(() => window.__cy.nodes().not('.hidden').slice(0, 30)
    .map((n) => `${Math.round(n.position().x)},${Math.round(n.position().y)}`).join('|')));
};
check('and it actually turns', await spun());

await layoutBtn('Grouped');
await settle(1200);
check('so can grouped by type', await page.$eval('.spinsw', (el) => el.disabled) === false);
check('and it turns too', await spun());

await layoutBtn('Layered');
await settle(1200);
check('the pipeline view stays flat',
      await page.$eval('.spinsw', (el) => el.disabled) === true);

await layoutBtn('Shell');
await settle(900);
check('and turning comes back in the shell',
      await page.$eval('.spinsw', (el) => el.disabled) === false);

// ---- the whole path, as a straight line
/* Following a chain by eye through a rotating cloud is not reading a workflow.
   The trace command has to produce something you can actually read in order. */
await layoutBtn('Force');
await page.waitForFunction(
  () => (document.querySelector('.hud')?.textContent ?? '').includes('settled'),
  { timeout: 40000 });
await settle(500);
await clearAll();
await page.evaluate(() => {
  const cy = window.__cy;
  cy.nodes().not('.hidden')
    .filter((x) => x.data('type') === 'sample' && x.data('reached') === 8)[0]
    .emit({ type: 'cxttap', originalEvent: { preventDefault() {} } });
});
await settle(400);
/* an earlier block in this suite traced a path, so clear the decks first */
await page.keyboard.press('Escape');
await settle(250);
check('the whole-path window is not open until asked for',
      (await page.$$('.win')).length === 0);
await clearAll();
await page.evaluate(() => {
  const cy = window.__cy;
  cy.nodes().not('.hidden')
    .filter((x) => x.data('type') === 'sample' && x.data('reached') === 8)[0]
    .emit({ type: 'cxttap', originalEvent: { preventDefault() {} } });
});
await settle(400);
await page.evaluate(() => [...document.querySelectorAll('.ctx button')]
  .find((b) => b.textContent.includes('Trace the whole path')).click());
await settle(700);

const win = await page.evaluate(() => {
  const w = document.querySelector('.win');
  if (!w) return null;
  const cards = [...w.querySelectorAll('.plot .card')].map((c) => ({
    name: c.querySelector('.name').textContent.trim(),
    when: c.querySelector('.when').textContent.trim(),
    x: Math.round(parseFloat(c.style.left)),
    y: Math.round(parseFloat(c.style.top)),
    type: c.closest('.band').previousElementSibling ? null : null,
  }));
  return {
    head: w.querySelector('h2')?.textContent.replace(/\s+/g, ' ').trim(),
    totals: w.querySelector('.totals')?.textContent.replace(/\s+/g, ' ').trim(),
    rows: [...w.querySelectorAll('.rowlabel')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    ticks: [...w.querySelectorAll('.tick span')].map((t) => t.textContent.trim()),
    cards,
    /* the platforms are the parallel case: three facilities, one date */
    platforms: [...w.querySelectorAll('.band')]
      .map((b) => [...b.querySelectorAll('.card')])
      .find((cs) => cs.length && cs.every((c) => /SciLifeLab|Genomics Express/.test(
        c.querySelector('.name').textContent)))
      ?.map((c) => ({ x: Math.round(parseFloat(c.style.left)),
                      y: Math.round(parseFloat(c.style.top)) })) ?? [],
    notDated: w.querySelector('.notdated')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    /* the user-visible promise: a card shows what it says, in full */
    truncated: [...w.querySelectorAll('.name,.detail,.when')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
      .map((e) => e.textContent.trim().slice(0, 40)),
    /* a date alone cannot separate two steps that happened on the same day */
    times: [...w.querySelectorAll('.plot .card')]
      .map((c) => ({ name: c.querySelector('.name').textContent.trim(),
                     when: c.querySelector('.when').textContent.trim(),
                     y: Math.round(parseFloat(c.style.top)),
                     flagged: /earlier than the step above/.test(c.textContent) })),
    scroller: (() => {
      const sc = w.querySelector('.scroll');
      return { over: sc.scrollWidth - sc.clientWidth };
    })(),
    bars: [...w.querySelectorAll('.outbar')].length,
    /* a card whose content is taller than its box loses its bottom line, which
       is the date — the one line that must never be the one cut off */
    clipped: [...w.querySelectorAll('.card')].filter((c) => {
      const inner = [...c.children].reduce((sum, k) => sum + k.getBoundingClientRect().height, 0);
      return inner > c.getBoundingClientRect().height - 10;
    }).length,
    /* a flag must stay inside its card's bottom row */
    strayFlags: [...w.querySelectorAll('.flag')].filter((f) =>
      getComputedStyle(f).position === 'absolute').length,
  };
});
check('tracing the whole path opens a window', win !== null);
check('it names the sample it is about', /^Sample S-/.test(win.head ?? ''), win.head);

/* One axis, one row per kind of thing. The rail this replaced had to invent an
   order for work that ran at the same time, and ended up printing a wait of
   minus one day between two steps that were never sequential. */
/* The patient is the only step with no date at all, so it has nothing to draw
   on the axis. An empty band with a label beside it reads as a gap in the
   record rather than as a step listed underneath. */
check('there is a row for each kind of thing that has a dated step',
      win.rows.map((r) => r.split(' ')[0]).join(',') === 'Sample,Activity,Aliquot,Platform,MTB',
      win.rows.join(' | '));
check('the axis is labelled with dates', win.ticks.length >= 4, win.ticks.join(' '));

/* the whole point: three platforms reporting on the same day share a column and
   stack, rather than being strung out as if one followed another */
check('parallel work shares one column', win.platforms.length === 3
      && new Set(win.platforms.map((p) => p.x)).size === 1, JSON.stringify(win.platforms));
check('and is stacked, not overlapping',
      new Set(win.platforms.map((p) => p.y)).size === 3, JSON.stringify(win.platforms));

/* a fraction is away at a lab for a stretch, not for an instant */
check('a fraction sent and returned gets a bar for the time it was away',
      win.bars >= 2, `${win.bars} bars`);

/* Placing an undated step on the axis is a claim about when it happened. The
   protein fraction has no dates at all and used to sit at the very start, where
   it looked as though it existed before the sample was collected. */
check('undated steps are named under the axis, not placed on it',
      /Not dated/.test(win.notDated ?? '') && /PROT/.test(win.notDated ?? '')
      && /PDL-/.test(win.notDated ?? ''), win.notDated);

/* Fixing the card height meant clamping the name to two lines and cutting the
   detail off with an ellipsis, so a sample read "FFPE · Pathology r…". A card
   that hides what it says is not worth the space it takes. */
check('no card truncates its text', win.truncated.length === 0, win.truncated.join(' | '));
/* the three platforms sharing a column are the point of the view, and having to
   scroll sideways to find them defeats it */
check('the whole span fits without scrolling sideways', win.scroller.over === 0,
      `${win.scroller.over}px over`);
check('every dated card carries a date', win.cards.every((c) => /\d\d-\d\d/.test(c.when)),
      win.cards.filter((c) => !/\d\d-\d\d/.test(c.when)).map((c) => c.name).join(' | '));
check('no card has its date clipped off the bottom', win.clipped === 0,
      `${win.clipped} cards overflow`);
/* `.wait` is the axis gap bar and is absolutely positioned. A QC pill that
   shared the class was pulled out of its card and dropped on top of the name. */
check('no flag escapes its card', win.strayFlags === 0, `${win.strayFlags} stray`);
/* Several steps land on the same date, so the date alone cannot say which came
   first. The export records a clock time for the collection and the pathology
   registration, and those are exactly the two that share a date. */
const clocked = win.times.filter((t) => /\d\d:\d\d/.test(t.when));
check('steps that carry a clock time show it beside the date',
      clocked.length >= 2, clocked.map((t) => `${t.name}: ${t.when}`).join(' | '));

/* The pipeline order places the cards, never the clock. The order a sample must
   pass through is what we know; a clock time is a form field. */
const collection = win.times.find((t) => /Sample collection/.test(t.name));
const pathology = win.times.find((t) => /Pathology registration/.test(t.name));
check('the pipeline order places the cards, not the clock',
      collection.y < pathology.y,
      `collection at y${collection.y}, pathology at y${pathology.y}`);

/* The generator used to draw every time independently, so a sample could be
   collected at 14:35 and registered at pathology at 09:55 on the same day. It
   now orders same-day times to match the order the steps happen in, and this is
   the check that says so — across the whole cohort, not just this one sample. */
const inversions = await page.evaluate(() => {
  const cy = window.__cy;
  /* every activity that carries a clock time, grouped by sample and date */
  const byKey = {};
  cy.nodes().filter((n) => n.data('type') === 'activity' && n.data('time'))
    .forEach((n) => {
      const owner = cy.edges().filter((e) => e.data('type') === 'used'
        && e.data('source') === n.id())[0]?.data('target') ?? 'none';
      const key = `${owner}|${n.data('date')}`;
      (byKey[key] = byKey[key] || []).push({ kind: n.data('kind'), t: n.data('time') });
    });
  const ORDER = ['collection', 'pathology'];
  const bad = [];
  for (const key in byKey) {
    const steps = byKey[key]
      .filter((x) => ORDER.includes(x.kind))
      .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].t < steps[i - 1].t) bad.push(`${key}: ${steps.map((x) => x.kind + ' ' + x.t).join(' → ')}`);
    }
  }
  return bad;
});
check('no sample is registered at pathology before it was collected',
      inversions.length === 0, `${inversions.length} — e.g. ${inversions[0] ?? ''}`);
check('so nothing on this path is flagged as out of order',
      !win.times.some((t) => t.flagged),
      win.times.filter((t) => t.flagged).map((t) => t.name).join(' | '));

check('and the header totals the journey', /days end to end/.test(win.totals ?? ''), win.totals);

await page.keyboard.press('Escape');
await settle(300);
check('escape closes it', (await page.$$('.win')).length === 0);

/* "where did this come from" is a partial question — answering it with a window
   titled "the whole path" would be a lie */
await clearAll();
await page.evaluate(() => {
  const cy = window.__cy;
  cy.nodes().not('.hidden').filter((x) => x.data('type') === 'sample')[0]
    .emit({ type: 'cxttap', originalEvent: { preventDefault() {} } });
});
await settle(400);
await page.evaluate(() => [...document.querySelectorAll('.ctx button')]
  .find((b) => b.textContent.includes('Where did this come from')).click());
await settle(600);
check('a partial trace does not claim to be the whole path',
      (await page.$$('.win')).length === 0);
await clearAll();

// ---- the way back is a button, not a gesture
/* Right-click clearing the highlight meant the trace menu took two right-clicks
   to reach, once to clear and once to open. The menu is back on the first
   right-click, and getting back to the whole picture has a control of its own
   that shows up only while there is something to clear. */
const clearBtn = () => page.evaluate(() => {
  const b = document.querySelector('.clearsel');
  return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
});
await clearAll();
check('no clear button while nothing is lit', (await clearBtn()) === null);

await page.evaluate(() => {
  window.__cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample')[0].emit('tap');
});
await settle(600);
check('one appears as soon as a node is selected', /Clear selection/.test(await clearBtn()),
      await clearBtn());

await page.evaluate(() => {
  window.__cy.nodes().not('.hidden').filter((n) => n.data('type') === 'sample')[0].emit('dbltap');
});
await settle(700);
/* the number on the button is what is BRIGHT on screen, not the size of the
   set: a family reaches through layers that may be switched off, and a button
   that says 12 while you can see 6 is just wrong */
const onScreen = await page.evaluate(() => window.__cy.nodes().not('.hidden')
  .filter((n) => !n.hasClass('faded')).length);
check('and it counts what the double click actually lit',
      (await clearBtn()).endsWith(` ${onScreen}`),
      `${await clearBtn()} vs ${onScreen} bright`);
check('which really is a narrowed set',
      await page.evaluate(() => window.__cy.nodes('.faded').length) > 0);

/* a right-click still opens the menu, whatever is lit */
const nodeAt = await page.evaluate(() => {
  const cy = window.__cy;
  const n = cy.nodes().not('.hidden').filter((x) => !x.hasClass('faded'))[0];
  const p = n.renderedPosition(); const b = cy.container().getBoundingClientRect();
  return { x: b.x + p.x, y: b.y + p.y };
});
await page.mouse.click(nodeAt.x, nodeAt.y, { button: 'right' });
await settle(500);
check('right-click opens the menu on the first press, even with a family lit',
      (await page.$$('.ctx button')).length > 0);
await page.keyboard.press('Escape');
await settle(300);

await page.click('.clearsel');
await settle(600);
const afterButton = await page.evaluate(() => ({
  faded: window.__cy.nodes('.faded').length,
  marked: window.__cy.nodes('.marked').length,
  empty: document.querySelector('aside.right').textContent.includes('Nothing selected'),
  button: !!document.querySelector('.clearsel'),
}));
check('the button clears the highlight, the selection and itself',
      afterButton.faded === 0 && afterButton.marked === 0 && afterButton.empty
      && !afterButton.button, JSON.stringify(afterButton));

check('no page errors', errors.length === 0, errors[0] ?? '');

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);

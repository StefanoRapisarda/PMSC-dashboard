/* The cohort flow must tell the sample's actual journey, and every number in it
   must come from the API.

   What this pins down, all of which the chart got wrong at some point:
     * QC is a step in each track, not a footnote — it is where material is lost.
     * The protein track has a different shape (digested to peptide, QC after the
       run), so its steps are read from the data rather than assumed.
     * The three streams name their own destinations; one "SciLifeLab" column
       would misname two of them.
     * A specimen that has not moved on is not a stalled specimen.
     * Nothing overlaps. */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

/* 127.0.0.1 rather than localhost. Node resolves localhost to ::1 first, and
   anything else on this machine listening on IPv6 port 8000 — another project's
   container, say — will answer instead of the API this suite is about. */
const API = process.env.PMSC_API ?? 'http://127.0.0.1:8000';
const api = await (await fetch(`${API}/api/overview`)).json();
const flow = api.flow;
const stage = (n) => flow.specimen_stages.find((s) => s.stage === n)?.count ?? 0;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--disable-gpu'],
  defaultViewport: { width: 1500, height: 1450 } });
const page = await browser.newPage();
await page.goto('http://localhost:5173/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg text', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 800));

const labels = await page.$$eval('svg text', (els) => els.map((e) => e.textContent.trim()));
const text = labels.join(' | ');
const hints = await page.$$eval('.hint', (els) => els.map((e) => e.textContent).join(' '));

/* the specimen stream, before the split */
for (const [name, value] of [
  ['Collected', stage('Collected')], ['Pathology', stage('Pathology')],
  ['PM-SC prep', stage('PM-SC prep')], ['AllPrep', stage('AllPrep')],
  ['Data back', flow.analysis.count], ['MTB Portal', flow.mtb.count],
]) check(`${name} shows ${value}`, labels.includes(String(value)));

check('no invented columns', !text.includes('Study coordination') && !text.includes('Surgery |'));

/* every step of every track, with the count the API reports */
for (const [name, stream] of Object.entries(flow.streams)) {
  check(`${name} track is present`, labels.includes(name));
  for (const step of stream.chain) {
    check(`${name}: ${step.stage} = ${step.count}`, labels.includes(String(step.count)),
          `looking for ${step.count}`);
  }
  check(`${name} names its destination`,
        text.includes(stream.facility.split(',')[0]), stream.facility);
}

/* QC is a step, and the losses at it are called out as QC failures */
check('DNA QC step is drawn', text.includes('QC pass'));
check('protein QC comes after the run, and is labelled as such', text.includes('MS QC pass'));
check('protein digestion is its own step', text.includes('digested'));
for (const [name, stream] of Object.entries(flow.streams)) {
  if (!stream.qc_fail) continue;
  check(`${name}: exactly ${stream.qc_fail} QC failures shown`,
        text.includes(`−${stream.qc_fail} failed QC`), `−${stream.qc_fail} failed QC`);
}

/* the drop at a QC gate is failures PLUS aliquots not yet QC'd; labelling the
   whole drop as failure overstates it, so the two must be separated */
const dnaDrop = flow.streams.DNA.chain[0].count - flow.streams.DNA.chain[1].count;
const dnaPending = dnaDrop - flow.streams.DNA.qc_fail;
check('aliquots awaiting QC are not counted as failures',
      dnaPending === 0 || text.includes(`${dnaPending} not yet QC'd`),
      `drop ${dnaDrop} = ${flow.streams.DNA.qc_fail} failed + ${dnaPending} pending`);

/* the pass rate at each gate, using the same definition as the KPI tile */
for (const [name, stream] of Object.entries(flow.streams)) {
  const gate = stream.chain.find((c) => c.stage.includes('QC'));
  if (!gate) continue;
  const rate = Math.round((gate.count / (gate.count + stream.qc_fail)) * 100);
  check(`${name} gate shows its pass rate (${rate}%)`, text.includes(`· ${rate}%`),
        `${gate.count}/${gate.count + stream.qc_fail}`);
}
check('gate rates use the same definition as the KPI tile',
      hints.includes('passed over resolved'));

/* the unit change is stated, not left to be inferred */
check('the change of counting unit is stated', text.includes('counted as aliquots'));

/* not-yet-proceeded is kept distinct from stalled */
const gap = stage('Pathology') - stage('PM-SC prep');
check(`drop-off shows ${gap} not yet past`, text.includes(`${gap} not yet past this step`));
check('drop-offs are not called stalled', !text.toLowerCase().includes('stalled'));
check('stalled is stated separately',
      hints.includes(`${flow.stalled}`) && hints.includes('flagged stalled'),
      `${flow.stalled} stalled vs ${gap} not yet proceeded`);

/* the turnaround card leads with the end-to-end figure and splits by owner */
const turn = api.turnaround;
const turnText = await page.$$eval('.card', (cards) => {
  const card = cards.find((c) => c.querySelector('h3')?.textContent.includes('tumour board'));
  return card ? card.textContent.replace(/\s+/g, ' ') : '';
});
/* named after the endpoint the trial family reports, not the generic term */
check('the card is named for the endpoint it measures',
      /Time to tumour board/.test(turnText) && !/^Turnaround/.test(turnText.trim()));
check('turnaround leads with the end-to-end median',
      turnText.includes(String(turn.end_to_end.median_days)), `${turn.end_to_end.median_days} days`);
/* the conventional laboratory-medicine phases, not an invented split */
for (const phase of turn.phases) {
  check(`${phase.label} phase shown as ${phase.days} days`,
        turnText.includes(phase.label) && turnText.includes(`${phase.days} days`),
        `${phase.days} days ${phase.where}`);
}
check('phases say where the time is spent',
      turnText.includes('in house') && turnText.includes('at the analysis labs'));
/* "20.5 d ours" read as "d-hours", and "ours" is not a professional label */
check('no informal or ambiguous unit labels',
      !/\bours\b/.test(turnText) && !/\d\s*d\s+ours/.test(turnText));
check('the analysis-lab segment is marked parallel', turnText.toLowerCase().includes('parallel'));
check('the individual analysis labs sit inside that segment, not beside it',
      turn.analysis_labs.filter((p) => p.median_days != null)
        .every((p) => turnText.includes(p.name.split(',')[0])));
check('turnaround names the longest step handled in house',
      /Longest step handled in house/.test(turnText));
check('turnaround warns that medians do not add', turnText.includes('Medians do not add'));
/* "p90 48" on its own is jargon; the card has to say what it means */
check('the percentile is explained in plain words',
      /9 in 10 within/.test(turnText), turnText.match(/9 in 10 within [^·]*/)?.[0]?.trim());
const oldShape = turnText.includes('HANDS-ON') || turnText.includes('Hands-on');
check('the misleading hands-on framing is gone', !oldShape);

/* the sample-type composition, complementary to the QC bars beside it */
const donut = await page.$$eval('.wrap .row', (rows) => rows.map((r) => ({
  name: r.querySelector('.name')?.textContent.trim(),
  n: r.querySelector('.n')?.textContent.trim(),
  pc: r.querySelector('.pc')?.textContent.trim(),
  ali: r.querySelector('.ali')?.textContent.trim(),
})));
check('every sample type is in the composition legend',
      api.sample_types.every((t) => donut.some((d) => d.name === t.type)),
      donut.map((d) => d.name).join(', '));
for (const t of api.sample_types) {
  const row = donut.find((d) => d.name === t.type);
  check(`${t.type}: ${t.specimens} specimens, ${t.aliquots} aliquots`,
        row?.n === String(t.specimens) && row?.ali === `${t.aliquots} aliquots`,
        `${row?.n} / ${row?.ali}`);
}
const slices = await page.$$eval('.donut .slice', (p) => p.length);
check('the donut has one slice per type', slices === api.sample_types.length,
      `${slices} slices`);
const centre = await page.$eval('.donut .total', (e) => e.textContent.trim());
check('the donut centre states the cohort size',
      centre === String(api.kpis.specimens_collected), centre);

/* hovering a slice should answer for that slice, not make you read the legend */
const biggest = api.sample_types[0];
/* a stroked ring's bounding-box centre is the hole, so aim at the stroke itself:
   the first slice starts at twelve o'clock and runs clockwise */
const ring = await page.$eval('.donut', (el) => {
  const r = el.getBoundingClientRect();
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, radius: r.width * (78 / 210) };
});
const angle = -Math.PI / 2 + 0.5;          // inside the first slice
await page.mouse.move(ring.cx + ring.radius * Math.cos(angle),
                      ring.cy + ring.radius * Math.sin(angle));
await new Promise((r) => setTimeout(r, 300));
const hoveredCentre = await page.$$eval('.donut text', (els) =>
  els.map((e) => e.textContent.trim()).join(' | '));
check('hovering a slice reports that slice in the centre',
      hoveredCentre.includes(String(biggest.specimens)) && hoveredCentre.includes(biggest.type),
      hoveredCentre);
const dimmed = await page.$$eval('.donut .slice', (els) =>
  els.filter((e) => Number(e.getAttribute('opacity')) < 1).length);
check('the other slices recede while one is focused', dimmed === api.sample_types.length - 1,
      `${dimmed} dimmed`);
await page.mouse.move(0, 0);
await new Promise((r) => setTimeout(r, 300));
check('the centre returns to the cohort total',
      (await page.$eval('.donut .total', (e) => e.textContent.trim()))
        === String(api.kpis.specimens_collected));
/* the QC-by-sample-type card states each rate, using the same definition */
const qcRows = await page.$$eval('.qcchart .qcrow', (rows) => rows.map((r) => ({
  name: r.querySelector('.qcname')?.textContent.trim(),
  pct: r.querySelector('.qcpct')?.textContent.trim(),
  num: r.querySelector('.qcnum')?.textContent.trim(),
})));
check('every QC row shows a rate', qcRows.length > 0 && qcRows.every((r) => /^\d+%$/.test(r.pct)),
      `${qcRows.length} rows`);
let rateErrors = [];
for (const [type, molecules] of Object.entries(api.qc_by_sample_type))
  for (const [molecule, counts] of Object.entries(molecules)) {
    const expected = Math.round((counts.Pass / (counts.Pass + counts.Fail)) * 100);
    const row = qcRows.find((r) => r.name === `${type} · ${molecule}`);
    if (!row) rateErrors.push(`${type}/${molecule} missing`);
    else if (row.pct !== `${expected}%`) rateErrors.push(`${type}/${molecule} ${row.pct}≠${expected}%`);
  }
check('every QC rate matches passed over resolved', rateErrors.length === 0,
      rateErrors.slice(0, 3).join(', '));

/* and nothing collides */
const boxes = await page.$$eval('svg text', (els) => els.map((e) => {
  const r = e.getBoundingClientRect();
  return { t: e.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height };
}).filter((b) => b.w > 0));
const collisions = [];
for (let i = 0; i < boxes.length; i++)
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
      collisions.push(`"${a.t}"/"${b.t}"`);
  }
/* The foot of the dashboard is space held open rather than filled in. An empty
   panel with a name on it asks the study team what belongs there far more
   directly than a filled one does. */
const reserved = await page.evaluate(() => ({
  panels: [...document.querySelectorAll('.reserved .slot')].map((s) => ({
    title: s.querySelector('h3')?.textContent.trim(),
    what: (s.querySelector('.what')?.textContent ?? '').trim().length,
    holder: !!s.querySelector('.placeholder'),
  })),
  oldList: document.querySelectorAll('.stuck').length,
}));
check('the dashboard reserves three named panels', reserved.panels.length === 3,
      reserved.panels.map((p) => p.title).join(' | '));
check('each one is named and says what it is for',
      reserved.panels.every((p) => p.title && p.what > 20),
      reserved.panels.map((p) => `${p.title}:${p.what}`).join(' | '));
check('and each shows it is deliberately empty rather than broken',
      reserved.panels.every((p) => p.holder));
check('the old attention list is gone', reserved.oldList === 0);

check('no overlapping labels', collisions.length === 0, collisions.slice(0, 3).join(', '));

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);

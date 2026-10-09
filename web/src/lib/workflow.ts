/**
 * The sample journey, exactly as v3 told it.
 *
 * Stage durations are the process description the team gave, not measurements —
 * the export cannot time a transport booking. Where a stage IS backed by a
 * REDCap field, that field is named, so the two kinds of claim stay distinguishable.
 */
export interface Stage {
  name: string; short: string; phase: Phase;
  loc: string; system: string; actor: string; id: string;
  dur: number; durnote?: string; desc: string; note?: string;
  field?: string;
  /** The custodian's row. Platform analysis has none: it is drawn once per platform lane. */
  lane?: string;
  /** A moment rather than a piece of work. It is drawn as a pin, not a bar. */
  event?: boolean;
}

export type Phase = 'preop' | 'logistics' | 'surgery' | 'pathology'
                  | 'pmsclab' | 'analysis' | 'decision';

export const PHASES: Record<Phase, [string, string]> = {
  preop: ['Pre-op', '#457b9d'], surgery: ['Surgery', '#e76f51'],
  pathology: ['Pathology', '#264653'], logistics: ['Logistics', '#8d99ae'],
  pmsclab: ['PMSC lab', '#2a9d8f'], analysis: ['Analysis', '#6a4c93'],
  decision: ['Decision', '#e9c46a'],
};

export const LANES: [string, string][] = [
  ['coord', 'Study coordination · K'], ['or', 'Surgery · OR'], ['path', 'Pathology'],
  ['log', 'Logistics · biobank'], ['pmsc', 'PMSC lab · CCK'],
  ['scDNA', 'SciLifeLab · DNA'], ['scRNA', 'SciLifeLab · RNA'],
  ['scProt', 'SciLifeLab · Protein'], ['mtb', 'Analysis & MTB'],
];

export const PLATFORM_LANES: [string, string][] = [
  ['scDNA', 'Clinical Genomics'], ['scRNA', 'Genomics Express'],
  ['scProt', 'Clinical Proteomics MS'],
];

export const STAGES: Stage[] = [
  { name: 'Patient consent', short: 'Consent', event: true, phase: 'preop', lane: 'coord', loc: 'Alltid Öppet / Nybesök LOC',
    system: '', actor: 'Enrolling oncologist', id: 'Study ID (pseudonymised)', dur: 0,
    durnote: 'patient visit', field: 'res_sub_consent',
    desc: 'The research subject signs informed consent and is enrolled in the study.' },
  { name: 'Register consent in TakeCare', short: 'TakeCare', phase: 'preop', lane: 'coord', loc: 'Karolinska (K)',
    system: 'TakeCare (EHR)', actor: 'Study staff', id: '', dur: 15,
    desc: 'Consent forms are registered in TakeCare against the Study ID.' },
  { name: 'Schedule in Orbit', short: 'Orbit', phase: 'preop', lane: 'coord', loc: 'K', system: 'Orbit',
    actor: 'Study staff', id: '', dur: 30,
    desc: 'Check the surgery schedule and mark the case in the Orbit system.' },
  { name: 'Book transport', short: 'Transport', phase: 'preop', lane: 'coord', loc: 'Transport company',
    system: '', actor: 'Coordinator', id: '', dur: 10,
    desc: 'Contact the transport company and inform them about ice bags for the pickup day.' },
  { name: 'Pack transport bag', short: 'CCK packing', phase: 'logistics', lane: 'log', loc: 'CCK',
    system: '', actor: 'CCK staff', id: '', dur: 15,
    desc: 'Pack the transport bags with ice and a temperature logger.' },
  { name: 'Surgery', short: 'Surgery', event: true, phase: 'surgery', lane: 'or', loc: 'Operating room', system: '',
    actor: 'Surgeon', id: '', dur: 0, durnote: 'not timed', field: 'sample_date',
    desc: 'The tumour is resected. The surgery is the reference point of the journey, and its date is recorded in REDCap. How long the operation itself takes is not part of the planned process.' },
  { name: 'Tissue handling in theatre', short: 'Tissue to can', phase: 'surgery', lane: 'or', loc: 'Operating room',
    system: '', actor: 'Surgeon', id: '', dur: 15,
    desc: 'Tumour tissue is placed in a designated can and into the transport bag.' },
  { name: 'Pathology — cut & rack', short: 'Cut and rack', phase: 'pathology', lane: 'path', loc: 'Pathology dept',
    system: '', actor: 'Pathologist', id: 'PAD number', dur: 15, field: 'pat_sample_date',
    desc: 'The pathologist cuts tissue pieces, marks the tubes, and places them in the PreDDLung tube rack (−80 °C).' },
  { name: 'Register in Labware', short: 'Labware', phase: 'pathology', lane: 'path', loc: 'Pathology dept',
    system: 'Labware (LIMS)', actor: 'Pathology staff', id: 'Biobank tube barcode', dur: 10,
    field: 'tube_label',
    desc: 'Samples are registered in Labware together with the remiss (referral).' },
  { name: 'Store at −80 °C', short: '−80 store', phase: 'pathology', lane: 'path', loc: 'Pathology −80 freezer',
    system: '', actor: '', id: '', dur: 5, field: 'rack_number',
    desc: 'Samples are placed in −80 °C in the marked PreDDLung rack.' },
  { name: 'Pickup & cleaning', short: 'Pickup', phase: 'logistics', lane: 'log', loc: 'Pathology / CCK',
    system: '', actor: 'CCK staff', id: '', dur: 30,
    desc: 'Pick up the Study Remiss and ice bag; clean the bag and temperature logger.' },
  { name: 'Move to CCK freezer', short: 'Fryshotellet', phase: 'logistics', lane: 'log', loc: '→ CCK freezer A0',
    system: '', actor: '', id: '', dur: 8, durnote: '5–10 min',
    desc: 'PreDDLung samples are moved from the Pathology freezer to CCK freezer A0.' },
  { name: 'Withdraw for prep (UTTAG)', short: 'UTTAG', phase: 'pmsclab', lane: 'pmsc', loc: 'CCK', system: '',
    actor: 'PMSC operator', id: '', dur: 20,
    desc: 'Withdraw tissue samples to be cryo-prepped (kept on dry ice).' },
  { name: 'Cryo prep', short: 'Cryo prep', phase: 'pmsclab', lane: 'pmsc', loc: 'CCK LAB', system: '',
    actor: 'Operator (HSA-ID)', id: 'PMSC ID', dur: 10, field: 'pmsc_cryoprep_date',
    desc: 'Cryopulverization — frozen tissue is ground to a fine powder to homogenise it before extraction.' },
  { name: 'AllPrep extraction', short: 'AllPrep', phase: 'pmsclab', lane: 'pmsc', loc: 'CCK LAB', system: '',
    actor: 'Operator (HSA-ID)', id: 'PMSC-ID-DNA / -RNA', dur: 135, durnote: '2–2.5 h',
    field: 'allprep_date_v2',
    desc: 'The Qiagen AllPrep kit co-extracts DNA, RNA and protein from the one sample, splitting it into three fractions.',
    note: '⎇ Branch point — the sample now splits into DNA / RNA / Protein fractions that proceed in parallel.' },
  { name: 'Concentration & QC', short: 'Conc + QC', phase: 'pmsclab', lane: 'pmsc', loc: 'CCK LAB', system: '',
    actor: 'Operator', id: '', dur: 60, field: 'qc_dna',
    desc: 'Concentration measured by Qubit (DNA/RNA) and Bradford/Qubit (protein); each fraction gets a QC Pass/Fail.',
    note: 'A failed RNA QC can trigger a repeat extraction (repeat_of), preserved in the graph.' },
  { name: 'Platform analysis', short: 'Platforms', phase: 'analysis', loc: 'SciLifeLab',
    system: 'Clinical Genomics · Genomics Express · Clinical Proteomics',
    actor: 'Platform staff', id: 'SciLL running number', dur: 3960, durnote: '60–72 h',
    field: 'send_dna',
    desc: 'DNA/RNA → Clinical Genomics / Genomics Express; Protein → Clinical Proteomics mass spec (TimsTOF / Astral).' },
  { name: 'Data analysis', short: 'Data analysis', phase: 'analysis', lane: 'mtb',
    loc: 'Bioinformatics / proteomics', system: '', actor: 'Analysts', id: '', dur: 2160,
    durnote: '24–48 h', field: 'datafrom_cg',
    desc: 'Sequencing and mass-spec data are processed and analysed.' },
  { name: 'Molecular Tumor Board', short: 'Tumour board', event: true, phase: 'decision', lane: 'mtb', loc: 'MTB Portal',
    system: 'MTBP', actor: 'Clinicians', id: '', dur: 0, durnote: 'meeting',
    field: 'order_date',
    desc: 'Results are reviewed in the Molecular Tumor Board Portal to guide the treatment decision — the end of the journey.' },
];

export function cumulative(): number[] {
  let running = 0;
  return STAGES.map((s) => (running += s.dur));
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return `${hours % 1 ? hours.toFixed(1) : hours} h`;
  }
  return `${(minutes / 1440).toFixed(1)} days`;
}

/**
 * sqrt so a two-day step does not make a fifteen-minute step invisible. A bar is
 * never narrower than its own label, because a step whose name is cut down to
 * one letter cannot be read without clicking it.
 */
export function barWidth(minutes: number, label: string): number {
  const scaled = minutes <= 0 ? 24 : Math.max(30, Math.min(150, 9 * Math.sqrt(minutes)));
  /* 16 px is the bar's horizontal padding, plus 4 px so the text never touches it */
  return Math.max(scaled, Math.ceil(labelWidth(label)) + 20);
}

let ctx: CanvasRenderingContext2D | null | undefined;

/** The label's width in the bar's own font, measured rather than guessed. */
function labelWidth(label: string): number {
  if (ctx === undefined && typeof document !== 'undefined') {
    ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
  }
  return ctx ? ctx.measureText(label).width : label.length * 8.5;
}

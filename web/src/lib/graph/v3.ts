/**
 * The visual and physical constants from mockups/index-v3.html.
 *
 * v3 is the design base: it was shaped by feedback, so its palette, node sizes,
 * ontology anchors and — most importantly — its edge-tier physics are carried
 * over verbatim rather than reinvented. Only the renderer changed.
 */
export type NodeType =
  | 'study' | 'patient' | 'identifier' | 'sample' | 'activity' | 'operator'
  | 'aliquot' | 'qc' | 'deviation' | 'platform' | 'storage' | 'mtb';

export const COLORS: Record<NodeType, string> = {
  study: '#b15dff', patient: '#ff6b9d', identifier: '#ff9f1c', sample: '#2ec4b6',
  activity: '#c98a5e', operator: '#b0bccb', aliquot: '#e9c46a', qc: '#7c6df2',
  deviation: '#e76f51', platform: '#4cc9f0', storage: '#94a7bd', mtb: '#b15dff',
};

/** v3's radii, doubled for Cytoscape which sizes by diameter. */
export const RADIUS: Record<NodeType, number> = {
  study: 13, patient: 9, identifier: 4, sample: 8, activity: 6, operator: 6.5,
  aliquot: 6, qc: 4.5, deviation: 5.5, platform: 11, storage: 7, mtb: 11,
};

export const ONTOLOGY: Record<NodeType, string> = {
  patient: 'OMOP Person', sample: 'CKG Biological_sample · MIABIS / SPREC',
  aliquot: 'CKG Analytical_sample', activity: 'PROV-O Activity',
  operator: 'PROV-O Agent · HSA-ID', identifier: 'Persistent identifier (PID)',
  platform: 'PROV-O Agent · facility', qc: 'QCResult node',
  deviation: 'Deviation node', storage: 'StorageLocation', mtb: 'MTB case',
  study: 'Study',
};

/**
 * What each kind of node is, in ordinary words.
 *
 * ONTOLOGY above holds the standard each type is anchored to, which matters for
 * the mapping work but means nothing on its own to a reader. "CKG
 * Analytical_sample" does not tell you that an aliquot is the DNA extracted
 * from a piece of tumour, so the plain sentence comes first and the standard
 * name second.
 */
export const DESCRIPTION: Record<NodeType, string> = {
  patient: 'A person enrolled in the study.',
  identifier: 'A name this thing is known by in one system. It gets a new one at '
            + 'each handover, and joining those names back together is the point of WP2.',
  sample: 'The material taken from the patient — a piece of tumour, or a blood draw.',
  activity: 'A step someone carried out: cutting, grinding, extracting, running a machine.',
  aliquot: 'A fraction extracted from a sample: DNA, RNA, protein or peptide.',
  qc: 'The pass or fail decision on one fraction.',
  deviation: 'Something recorded as having gone wrong: timing, temperature, handling '
           + 'or labelling.',
  platform: 'The lab that ran the analysis.',
  storage: 'A freezer, rack or box where material sits.',
  operator: 'The person who carried out a step, identified by their staff ID.',
  mtb: 'The tumour board meeting where the results are discussed.',
  study: 'The study everything belongs to.',
};

/* QC outcome and deviations are properties to filter on, not objects with
   anything downstream to traverse to. Activities are drawn, because which steps
   were run on a specimen — and by whom — is a question about the material. */
export const TYPE_ORDER: NodeType[] = [
  'patient', 'identifier', 'sample', 'activity', 'aliquot', 'platform',
  'storage', 'operator', 'mtb',
];

/** Processing steps, in the order they happen, with names a lab would use. */
export const ACTIVITY_LABEL: Record<string, string> = {
  collection: 'Collection · surgery',
  pathology: 'Pathology handling',
  sectioning: 'Sectioning (FFPE)',
  cryoprep: 'Cryoprep (fresh-frozen)',
  allprep: 'AllPrep co-extraction',
  protein_extraction: 'Protein extraction',
  sp3: 'SP3 digestion to peptide',
};
export const ACTIVITY_ORDER = ['collection', 'pathology', 'sectioning', 'cryoprep',
                               'allprep', 'protein_extraction', 'sp3'];

export const TYPE_LABEL: Record<NodeType, string> = {
  patient: 'Patient', identifier: 'Identifier (ID chain)', sample: 'Sample',
  activity: 'Activity', aliquot: 'Aliquot', qc: 'QC result', deviation: 'Deviation',
  platform: 'Platform', storage: 'Storage', operator: 'Operator', mtb: 'MTB case',
  study: 'Study',
};

/**
 * DISTANCE = TIGHTNESS OF RELATIONSHIP.
 *
 * The decision v3 exists to demonstrate. Every edge type gets its own rest
 * length L: how far apart the two ends want to sit. Uniform lengths would make
 * a node's position encode only how many edges it has, which says nothing about
 * the data.
 *
 *   TIGHT  — "is part of / is a fact about this object". Glues one specimen's
 *            own things onto it, so a sample family collapses into a small ball.
 *   FAMILY — the family root and its siblings: looser, still one clump.
 *   LOOSE  — shared context (platform, operator, freezer box). Long and weak, so
 *            a hub does not drag families around; because it has many weak
 *            springs it settles between the families it serves.
 *
 * What you read off the screen: one clump per patient's sample family, shared
 * hubs between the clumps, and a hub whose spokes all land in clumps containing
 * a red ring is a real finding — one operator, or one box, in every failure.
 */
export const SPRING: Record<string, { L: number; k: number }> = {
  /* TIGHT */
  has_qc: { L: 26, k: 0.095 },
  derived_from: { L: 30, k: 0.085 },
  identified_as: { L: 32, k: 0.080 },
  has_deviation: { L: 32, k: 0.080 },
  generated: { L: 36, k: 0.070 },
  used: { L: 36, k: 0.070 },
  /* FAMILY */
  repeat_of: { L: 48, k: 0.050 },
  has_sample: { L: 64, k: 0.035 },
  contains: { L: 70, k: 0.035 },
  /* LOOSE */
  stored_at: { L: 165, k: 0.012 },
  has_mtb: { L: 180, k: 0.012 },
  submitted_to: { L: 185, k: 0.012 },
  performed: { L: 190, k: 0.012 },
};
export const SPRING_DEFAULT = { L: 70, k: 0.030 };

/** Column per type in the layered ("pipeline") view — v3's left-to-right axis. */
export const LAYERED_COLUMN: Record<string, number> = {
  study: 0, patient: 1, identifier: 1, sample: 2, activity: 2, deviation: 2,
  aliquot: 3, qc: 3, platform: 4, storage: 4, mtb: 5,
};

export const LAYERED_HEADING: Record<number, string> = {
  1: 'PATIENT', 2: 'SAMPLE', 3: 'ALIQUOT', 4: 'PLATFORM', 5: 'MTB',
};

export function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

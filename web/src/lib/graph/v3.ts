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

/* One departure from v3. Its platform colour (#4cc9f0) sat only 20 degrees of
   hue from the sample teal, and on the dark canvas, at dot size and with the
   depth fading applied, the two could not be told apart. Platforms are now a
   deeper blue, which keeps them in the same family while reading as different. */
export const COLORS: Record<NodeType, string> = {
  study: '#b15dff', patient: '#ff6b9d', identifier: '#ff9f1c', sample: '#2ec4b6',
  activity: '#c98a5e', operator: '#b0bccb', aliquot: '#e9c46a', qc: '#7c6df2',
  deviation: '#e76f51', platform: '#3a86ff', storage: '#94a7bd', mtb: '#b15dff',
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

export function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * What each kind of relation means, in ordinary words.
 *
 * An edge in the store carries only its two ends and its type, so everything a
 * reader learns from clicking one comes from here and from the facts on its two
 * ends. `says` is written from the source end to the target end, which is the
 * direction the API stores the edge in. `standard` names a PROV-O property only
 * where the relation genuinely is one; the rest are this project's own terms and
 * are not dressed up as anything else.
 */
export interface Relation {
  name: string;
  says: (a: string, b: string) => string;
  standard: string | null;
}

export const RELATION: Record<string, Relation> = {
  has_sample: { name: 'Gave sample', standard: null,
    says: (a, b) => `${a} gave the sample ${b}.` },
  identified_as: { name: 'Known as', standard: null,
    says: (a, b) => `${a} is known by the identifier ${b}.` },
  used: { name: 'Step on material', standard: 'PROV-O used',
    says: (a, b) => `The step ${a} was carried out on ${b}.` },
  performed: { name: 'Carried out by', standard: 'PROV-O wasAssociatedWith (inverse)',
    says: (a, b) => `${a} carried out the step ${b}.` },
  generated: { name: 'Produced', standard: 'PROV-O wasGeneratedBy (inverse)',
    says: (a, b) => `The step ${a} produced ${b}.` },
  derived_from: { name: 'Derived from', standard: 'PROV-O wasDerivedFrom',
    says: (a, b) => `${a} was derived from ${b}.` },
  stored_at: { name: 'Stored in', standard: null,
    says: (a, b) => `${a} is stored in ${b}.` },
  contains: { name: 'Contains', standard: null,
    says: (a, b) => `${a} holds ${b}.` },
  submitted_to: { name: 'Sent for analysis', standard: null,
    says: (a, b) => `${a} was sent to ${b} for analysis.` },
  has_mtb: { name: 'Reached the tumour board', standard: null,
    says: (a, b) => `The results from ${a} reached ${b}.` },
  enrolled: { name: 'Enrolled by', standard: null,
    says: (a, b) => `${a} enrolled the patient ${b} in the study.` },
  repeat_of: { name: 'Repeat collection', standard: null,
    says: (a, b) => `${a} is a repeat collection of ${b}, recorded as a new REDCap record.` },
  BRIDGE: { name: 'Hidden steps', standard: null,
    says: (a, b) => `${a} leads to ${b} through steps whose layer is switched off.` },
};

/**
 * How tightly a relation holds its two ends together in the force view, read
 * from the rest length in SPRING so that the sentence and the physics cannot
 * drift apart.
 */
export function relationTier(type: string): { tier: string; meaning: string } | null {
  const spring = SPRING[type];
  if (!spring) return null;
  if (spring.L <= 40) return { tier: 'tight',
    meaning: 'This is a fact about one object, so the force view pulls its two ends close together.' };
  if (spring.L <= 100) return { tier: 'family',
    meaning: 'This joins members of one family, so its two ends sit a moderate distance apart.' };
  return { tier: 'loose',
    meaning: 'This links to shared context. The spring is long and weak, so the shared end '
           + 'settles between the families it serves rather than inside one.' };
}

/** Shapes returned by the API. Mirrors api/app/schemas.py. */

export type NodeType =
  | 'study' | 'patient' | 'identifier' | 'sample' | 'activity' | 'operator'
  | 'aliquot' | 'qc' | 'deviation' | 'lab' | 'system' | 'storage';

export interface GraphNode {
  id: number;
  type: NodeType;
  label: string;
  /* physics state, added client-side by the engine */
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /* projection cache */
  _sx?: number; _sy?: number; _sc?: number; _zc?: number;
  /* layout targets */
  lx?: number; ly?: number; lz?: number;
  gx?: number; gy?: number; gz?: number;

  sex?: 'F' | 'M';
  age?: number;
  consent?: boolean;
  stype?: string;
  reached?: number;
  box?: string | null;
  devType?: string | null;
  deviations?: string[];
  deviation_notes?: string[];
  stalled?: boolean;
  stalled_days?: number | null;
  record_id?: string;
  collected?: string | null;
  specimen_id?: number;
  mol?: string;
  molLabel?: string;
  qc?: 'pass' | 'fail' | 'pending';
  total?: number | null;
  conc?: number | null;
  elution?: number | null;
  buffer?: string | null;
  sent_on?: string | null;
  returned_on?: string | null;
  /** an identifier's kind, such as a PAD number */
  scheme?: string;
  /** the information system that issues an identifier, where a source names one */
  issued_by?: string | null;
  value?: string;
  /** a lab that analyses the extracted fractions, as opposed to an in-house one */
  analysis?: boolean;
  /** the information system the journey ends in: the tumour board portal */
  endpoint?: boolean;
  /** a short name for a row or a label, where the full one is long */
  short?: string | null;
  /** when a specimen's case was ordered in the tumour board portal */
  ordered_on?: string | null;
  outcome?: string;
  devtype?: string;
  note?: string | null;
  kind?: string;
  date?: string | null;
  /** clock time of the step, "HH:MM", where the export recorded one */
  time?: string | null;
  _psex?: 'F' | 'M';
  _page?: number;
  _alisIdx?: number[];
  _actIdx?: number | null;

  /* rollups computed once the payload lands */
  _alis?: GraphNode[];
  _act?: GraphNode | null;
  _num?: string;
  _hasFail?: boolean;
  _hasRepeat?: boolean;
  _pending?: boolean;
  _incomplete?: boolean;
  _stuck?: boolean;
}

export interface GraphEdge { a: number; b: number; type: string; }

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  labs: Record<string, number>;
  systems: number[];
  /** the Molecular Tumor Board Portal, where the journey ends */
  portal: number | null;
  sample_types: string[];
  activity_kinds: string[];
  counts: { patients: number; specimens: number; nodes: number; edges: number };
  patient_limit: number | null;
  patients_total: number;
}

export interface Meta {
  study: { name: string; as_of: string | null; description: string | null };
  counts: { patients: number; specimens: number; aliquots: number };
  stages: string[];
  molecules: string[];
  sample_types: string[];
  stall_threshold_days: number;
}

export type Phase = 'pre_analytical' | 'analytical' | 'post_analytical';

export interface TurnaroundSegment {
  key: string; label: string; owner: 'in_house' | 'analysis_lab'; phase: Phase;
  detail: string; parallel?: boolean;
  n: number; median_days: number | null; p90_days: number | null;
}

export interface AnalysisLabWait {
  name: string; n: number;
  median_days: number | null; p90_days: number | null; note?: string;
}

export interface Turnaround {
  end_to_end: { n: number; median_days: number | null; p90_days: number | null };
  segments: TurnaroundSegment[];
  analysis_labs: AnalysisLabWait[];
  phases: { key: Phase; label: string; where: string; days: number }[];
  in_house_days: number;
  analysis_lab_days: number;
  note: string;
}

export interface Overview {
  kpis: {
    patients_enrolled: number; specimens_collected: number; aliquots: number;
    aliquots_by_molecule: Record<string, number>;
    qc_pass_rate: number | null; qc_resolved: number;
    reached_data_back_pct: number | null; specimens_with_data_back: number;
    stalled: number; deviations: number; stall_threshold_days: number;
  };
  flow: {
    specimen_stages: { stage: string; count: number }[];
    streams: Record<string, {
      qc_fail: number; qc_position: string;
      submitted: number; returned: number;
      facility: string | null;
      chain: { stage: string; count: number }[];
    }>;
    analysis: { stage: string; count: number; unit: string };
    mtb: { stage: string; count: number; unit: string };
    stalled: number;
    stall_threshold_days: number;
    note: string;
  };
  qc_by_sample_type: Record<string, Record<string, { Pass: number; Fail: number }>>;
  sample_types: {
    type: string; specimens: number; specimen_share: number;
    aliquots: number; aliquot_share: number;
  }[];
  turnaround: Turnaround;
  stage_distribution: { stage: string; count: number }[];
  attention: {
    specimen_id: number; record_id: string; study_id: string;
    sample_type: string | null; stage_reached: string;
    days_since_last_step: number; waiting_on: string[]; failed: string[];
  }[];
}

export interface SpecimenDetail {
  id: number; label: string; record_id: string; sample_type: string | null;
  collected_on: string | null; stage_reached: string; stalled_days: number | null;
  is_repeat: boolean;
  patient: { label: string; sex: string; age: number } | null;
  storage: string | null;
  id_chain: { role: string; scheme: string; value: string | null;
              issued_by: string | null }[];
  steps: { kind: string; label: string; date: string | null;
           operator: string | null; facility: string | null }[];
  fractions: { label: string; molecule: string; qc: string | null;
               total: number | null; concentration: number | null;
               elution_ul: number | null; buffer: string | null;
               lab: string | null; sent_on: string | null;
               returned_on: string | null }[];
  deviations: { type: string; note: string | null }[];
}

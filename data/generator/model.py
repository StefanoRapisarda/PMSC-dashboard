"""Simulates the PM-SC cohort: patients, specimens, aliquots and their timeline.

The simulation produces one record per specimen (see data/README.md, "Record
grain"). Each specimen is given a complete ideal timeline first, then truncated
in two ways:

  * by the snapshot date  - anything scheduled after AS_OF has not happened yet,
    which is what spreads the cohort across pipeline stages;
  * by a forced stall     - a chosen specimen stops at a stage and stays there,
    which is what populates the stalled-samples count.

Failures are part of the data by design: the dashboard has a QC pass-rate tile,
a QC-by-type chart and a REPEAT_OF edge type, and none of them render without
failures to show.
"""

import random
from dataclasses import dataclass, field
from datetime import date, timedelta

import config as C

# Pipeline stages, in order. Used for truncation and for the stalled check.
STAGES = ["enrolled", "collected", "pathology", "pmsc_prep", "allprep",
          "qc", "submitted", "data_back", "mtb"]

DEVIATION_TEXT = {
    "timing": [
        "Collection to processing {m} min (target <60 min).",
        "Freezer withdrawal delayed {h} h by transport scheduling.",
        "Time from surgery to pathology registration {m} min.",
    ],
    "temperature": [
        "Transport bag {t} C on arrival (acceptable range 2-10 C).",
        "Temperature logger recorded {t} C excursion during transfer.",
        "Dry-ice level low on arrival; sample surface {t} C.",
    ],
    "handling": [
        "Tissue fragment partially crushed during dissection.",
        "Necrotic area noted; viable tissue dissected separately.",
        "Sample fragmented on withdrawal; pieces pooled.",
    ],
    "labelling": [
        "Tube label did not match remiss; corrected and re-registered.",
        "Rack position recorded as {p1}, physically found at {p2}.",
        "Handwritten PAD number illegible; confirmed against Sympathy.",
    ],
}


# --------------------------------------------------------------------------
# Identifiers. Deliberately dissimilar across systems: reconciling this chain
# is the WP2 deliverable, and a chain of lookalike IDs would not demonstrate it.
# --------------------------------------------------------------------------

def study_id(n: int) -> str:
    return f"PDL-{n:04d}"


def pad_number(rng, d: date) -> str:
    """Hospital pathology ID, Sympathy LIMS style, e.g. K2347-25 3C."""
    return (f"K{rng.randint(1000, 9999)}-{d.strftime('%y')} "
            f"{rng.randint(1, 9)}{rng.choice('ABCDEFG')}")


def tube_barcode(rng) -> str:
    """KI Biobank / SMB tube barcode: a flat 10-digit number."""
    return f"{rng.randint(1000000000, 9999999999)}"


def pmsc_id(n: int, d: date) -> str:
    return f"PMSC-{d.year}-{n:04d}"


def hsa_id(rng) -> str:
    """Swedish healthcare personnel identifier."""
    return f"SE2321000016-{rng.randint(1000, 9999)}"


# --------------------------------------------------------------------------

@dataclass
class Patient:
    n: int
    study_id: str
    dob: date
    sex: str
    consent: bool
    enroll_date: date
    oncologist: str
    email: str
    other_studies: bool

    @property
    def exact_age(self) -> float:
        days = (self.enroll_date - self.dob).days
        return round(days / 365.25, 1)


@dataclass
class Specimen:
    """One physical specimen, followed from collection to tumour board.

    Corresponds to exactly one REDCap record.
    """
    record_id: int
    patient: Patient
    kind: str                     # 'tissue_ff' | 'tissue_ffpe' | 'blood' | 'pending'
    collected_via_biopsy: bool
    to_pmsc: bool                 # blood only: continued past biobanking
    collected_on: date = None
    repeat_of: object = None      # Specimen this one re-runs, if any
    milestones: dict = field(default_factory=dict)
    values: dict = field(default_factory=dict)
    reached: str = "enrolled"
    stall_at: str = None

    @property
    def is_tissue(self) -> bool:
        return self.kind.startswith("tissue")

    @property
    def is_ffpe(self) -> bool:
        return self.kind == "tissue_ffpe"

    def has(self, stage: str) -> bool:
        return STAGES.index(stage) <= STAGES.index(self.reached)


class Simulation:
    def __init__(self, cfg=C):
        self.cfg = cfg
        self.rng = random.Random(cfg.SEED)
        self.patients = []
        self.specimens = []
        self._next_record = 1
        self._next_pmsc = 1
        self.oncologists = [hsa_id(self.rng) for _ in range(cfg.N_ONCOLOGISTS)]
        self.operators = [hsa_id(self.rng) for _ in range(cfg.N_OPERATORS)]

    # -- helpers ----------------------------------------------------------
    def _days(self, span):
        lo, hi = span
        return timedelta(days=self.rng.randint(lo, hi))

    def _time(self, lo_h=7, hi_h=17):
        return f"{self.rng.randint(lo_h, hi_h):02d}:{self.rng.choice(['00','05','10','15','20','25','30','35','40','45','50','55'])}"

    def _uniform(self, span, nd=1):
        return round(self.rng.uniform(*span), nd)

    def _weighted(self, options, weights):
        return self.rng.choices(options, weights=weights, k=1)[0]

    # -- cohort -----------------------------------------------------------
    def build_patients(self):
        cfg = self.cfg
        span = (cfg.ENROLL_END - cfg.ENROLL_START).days
        for i in range(1, cfg.N_PATIENTS + 1):
            # Enrollment spread evenly across the window, jittered, so the
            # cohort ends up distributed across pipeline stages.
            offset = int(span * (i - 1) / (cfg.N_PATIENTS - 1))
            enroll = cfg.ENROLL_START + timedelta(
                days=max(0, min(span, offset + self.rng.randint(-6, 6))))
            age = min(cfg.AGE_MAX, max(cfg.AGE_MIN,
                      self.rng.gauss(cfg.AGE_MEAN, cfg.AGE_SD)))
            dob = enroll - timedelta(days=int(age * 365.25))
            sex = "Male" if self.rng.random() < cfg.P_MALE else "Female"
            p = Patient(
                n=i,
                study_id=study_id(i),
                dob=dob,
                sex=sex,
                consent=True,
                enroll_date=enroll,
                oncologist=self.rng.choice(self.oncologists),
                email=f"coordinator.pdl{i:04d}@example.invalid",
                other_studies=self.rng.random() < cfg.P_OTHER_STUDIES,
            )
            self.patients.append(p)

    def build_specimens(self):
        """Create one specimen record per collected specimen.

        Composition is assigned by quota rather than by a coin flip per
        specimen. The cohort mix is a stated property of this dataset, so it
        should match config exactly rather than approximately.
        """
        cfg, rng = self.cfg, self.rng
        collecting = self.patients[: cfg.N_PATIENTS - cfg.N_ENROLLED_ONLY]

        scheduled = []
        for p in collecting:
            surgery = p.enroll_date + timedelta(days=rng.randint(3, 28))
            if surgery <= cfg.AS_OF:
                scheduled.append((p, surgery))
        n = len(scheduled)

        kinds = ["tissue_ffpe"] * round(n * cfg.P_TISSUE_FFPE)
        kinds += ["tissue_ff"] * (n - len(kinds))
        rng.shuffle(kinds)

        biopsy = [True] * round(n * cfg.P_BIOPSY_SOURCE)
        biopsy += [False] * (n - len(biopsy))
        rng.shuffle(biopsy)

        with_blood = [True] * round(n * cfg.P_BLOOD_WITH_TISSUE)
        with_blood += [False] * (n - len(with_blood))
        rng.shuffle(with_blood)

        blood_idx = [i for i, b in enumerate(with_blood) if b]
        to_pmsc = set(rng.sample(blood_idx, min(cfg.N_BLOOD_TO_PMSC, len(blood_idx))))

        collected_for = {p.study_id for p, _ in scheduled}
        for p in self.patients:
            if p.study_id in collected_for:
                continue
            # Consented and registered, no specimen yet. REDCap holds the
            # record with only the enrollment instrument filled in.
            self.specimens.append(Specimen(
                record_id=self._take_record(), patient=p, kind="pending",
                collected_via_biopsy=False, to_pmsc=False))

        for i, (p, surgery) in enumerate(scheduled):
            self.specimens.append(Specimen(
                record_id=self._take_record(), patient=p, kind=kinds[i],
                collected_via_biopsy=biopsy[i], to_pmsc=True,
                collected_on=surgery))
            if with_blood[i]:
                self.specimens.append(Specimen(
                    record_id=self._take_record(), patient=p, kind="blood",
                    collected_via_biopsy=False, to_pmsc=(i in to_pmsc),
                    collected_on=surgery))

    def _take_record(self) -> int:
        n = self._next_record
        self._next_record += 1
        return n

    def _take_pmsc(self, d: date) -> str:
        s = pmsc_id(self._next_pmsc, d)
        self._next_pmsc += 1
        return s

    def run(self):
        self.build_patients()
        self.build_specimens()
        for s in self.specimens:
            self._plan(s)
        self._assign_stalls()
        for s in self.specimens:
            self._truncate(s)
        self._make_repeats()
        for s in self.specimens:
            self._fill_values(s)
        return self

    # -- timeline ---------------------------------------------------------
    MILESTONE_STAGE = {
        "enrolled": "enrolled",
        "collected": "collected",
        "pathology_received": "pathology",
        "pathology_processed": "pathology",
        "pmsc_prep": "pmsc_prep",
        "allprep": "allprep",
        "protein_extr": "allprep",
        "qc": "qc",
        "send_dna": "submitted",
        "send_rna": "submitted",
        "sp3": "submitted",
        "ms": "submitted",
        "data_cg": "data_back",
        "data_ge": "data_back",
        "spectronaut": "data_back",
        "mtb": "mtb",
    }

    def expected_end(self, s: Specimen) -> str:
        """Where this specimen is supposed to stop if nothing goes wrong.
        Blood drawn for the biobank is finished at pathology; it is not stuck."""
        if s.kind == "blood" and not s.to_pmsc:
            return "pathology"
        return "mtb"

    def _plan(self, s: Specimen):
        """Lay out the complete ideal timeline, ignoring the snapshot date."""
        cfg, rng, m = self.cfg, self.rng, {}
        m["enrolled"] = s.patient.enroll_date

        if s.kind == "pending":
            s.milestones = m
            s.pmsc_id = None
            s.qc = {}
            return

        # A repeat re-runs material already at PM-SC; it does not re-collect.
        surgery = (s.repeat_of.collected_on if s.repeat_of is not None
                   else s.collected_on)
        m["collected"] = surgery
        m["pathology_received"] = surgery + self._days(cfg.T_PATHOLOGY_RECEIVE)
        m["pathology_processed"] = m["pathology_received"] + self._days(cfg.T_PATHOLOGY_PROCESS)

        if self.expected_end(s) == "pathology":
            s.milestones = m
            s.pmsc_id = None
            s.qc = {}
            return

        if s.repeat_of is not None:
            base = s.repeat_of.milestones.get("qc", m["pathology_processed"])
            m["pmsc_prep"] = base + timedelta(days=rng.randint(4, 21))
        else:
            m["pmsc_prep"] = m["pathology_processed"] + self._days(cfg.T_PMSC_PREP)

        m["allprep"] = m["pmsc_prep"] + self._days(cfg.T_ALLPREP)
        m["qc"] = m["allprep"] + self._days(cfg.T_QC)

        s.pmsc_id = self._take_pmsc(m["pmsc_prep"])
        s.qc = self._decide_qc(s)

        # DNA branch
        if s.qc["dna"] == "Pass":
            m["send_dna"] = m["qc"] + self._days(cfg.T_SEND_DNA)
            m["data_cg"] = m["send_dna"] + self._days(cfg.T_DATA_CG)
        # RNA branch (tissue only; blood at PM-SC yields DNA alone)
        if s.is_tissue and s.qc.get("rna") == "Pass":
            m["send_rna"] = m["qc"] + self._days(cfg.T_SEND_RNA)
            m["data_ge"] = m["send_rna"] + self._days(cfg.T_DATA_GE)
        # Protein / peptide / mass spec (tissue only)
        if s.is_tissue:
            m["protein_extr"] = m["allprep"] + self._days(cfg.T_PROTEIN_EXTR)
            m["sp3"] = m["protein_extr"] + self._days(cfg.T_SP3)
            m["ms"] = m["sp3"] + self._days(cfg.T_MS)
            if s.qc.get("ms") == "Pass":
                m["spectronaut"] = m["ms"] + self._days(cfg.T_SPECTRONAUT)

        back = [m[k] for k in ("data_cg", "data_ge", "spectronaut") if k in m]
        if back:
            m["mtb"] = max(back) + self._days(cfg.T_MTB)

        s.milestones = m

    def _decide_qc(self, s: Specimen) -> dict:
        """QC outcome per aliquot. Outcome and concentration are decided
        together so the two agree: a failed aliquot has a low yield."""
        cfg, rng = self.cfg, self.rng
        actions = ["Repeat analysis", "Exclude sample", "Investigate / troubleshooting"]
        q = {}

        q["dna"] = "Fail" if rng.random() < cfg.P_DNA_FAIL else "Pass"
        if q["dna"] == "Fail":
            q["dna_action"] = self._weighted(actions, cfg.FAIL_ACTION_WEIGHTS)

        if s.is_tissue:
            p_rna = cfg.P_RNA_FAIL_FFPE if s.is_ffpe else cfg.P_RNA_FAIL_FF
            q["rna"] = "Fail" if rng.random() < p_rna else "Pass"
            if q["rna"] == "Fail":
                q["rna_action"] = self._weighted(actions, cfg.FAIL_ACTION_WEIGHTS)
            q["ms"] = "Fail" if rng.random() < cfg.P_MS_FAIL else "Pass"

        return q

    # -- truncation -------------------------------------------------------
    def _stage_dates(self, s: Specimen) -> dict:
        out = {}
        for name, d in s.milestones.items():
            stage = self.MILESTONE_STAGE[name]
            out[stage] = max(out.get(stage, d), d)
        return out

    def _assign_stalls(self):
        """Pick specimens that stop and stay stopped. Candidates are drawn from
        the older part of the cohort so the last recorded event is genuinely old
        rather than merely recent-and-pending."""
        cfg = self.cfg
        newest = cfg.AS_OF - timedelta(days=cfg.STALL_MIN_DAYS)
        oldest = cfg.AS_OF - timedelta(days=cfg.STALL_MAX_DAYS)
        pool = [s for s in self.specimens if self.expected_end(s) == "mtb"]
        self.rng.shuffle(pool)

        stages = ["pathology", "pmsc_prep", "allprep", "qc", "submitted"]
        taken = set()
        for i in range(cfg.N_STALLED):
            stage = stages[i % len(stages)]
            for s in pool:
                if id(s) in taken:
                    continue
                # A blood specimen stalled before PM-SC registration is
                # indistinguishable in the export from one correctly sent to the
                # biobank: nothing records that a tube was earmarked for
                # extraction. Such a stall could not be detected downstream, so
                # it is not planted. (Worth raising -- it is a real gap in the
                # eCRF, not just a generator constraint.)
                if s.kind == "blood" and STAGES.index(stage) < STAGES.index("pmsc_prep"):
                    continue
                d = self._stage_dates(s).get(stage)
                # The last recorded step must be old enough to count as stalled
                # but recent enough to be a live problem.
                if d and oldest <= d <= newest:
                    s.stall_at = stage
                    taken.add(id(s))
                    break

    def _truncate(self, s: Specimen):
        """Keep only what has actually happened by AS_OF, and not past a stall."""
        stage_dates = self._stage_dates(s)
        limit = len(STAGES) - 1
        if s.stall_at:
            limit = min(limit, STAGES.index(s.stall_at))
        limit = min(limit, STAGES.index(self.expected_end(s)))

        reached_idx = 0
        for i, stage in enumerate(STAGES):
            if i > limit:
                break
            d = stage_dates.get(stage)
            if d is None:
                continue
            if d > self.cfg.AS_OF:
                break
            reached_idx = i

        s.reached = STAGES[reached_idx]
        s.milestones = {
            k: v for k, v in s.milestones.items()
            if STAGES.index(self.MILESTONE_STAGE[k]) <= reached_idx
        }

    # -- repeats ----------------------------------------------------------
    def _make_repeats(self):
        """A failed aliquot marked 'Repeat analysis' is re-run on leftover
        material, which is registered at PM-SC as a new record. The failing
        record's dna_repeat / rna_repeat points at that new record's PMSC ID:
        the schema's own REPEAT_OF edge."""
        originals = list(self.specimens)
        for s in originals:
            if not s.has("qc"):
                continue
            needs = (s.qc.get("dna_action") == "Repeat analysis"
                     or s.qc.get("rna_action") == "Repeat analysis")
            if not needs:
                continue
            r = Specimen(
                record_id=self._take_record(),
                patient=s.patient,
                kind=s.kind,
                collected_via_biopsy=s.collected_via_biopsy,
                to_pmsc=True,
                repeat_of=s,
                collected_on=s.collected_on,
            )
            self._plan(r)
            # A repeat usually succeeds; leave a few that do not. A repeat that
            # fails again is not repeated a second time, so its fail-action is
            # never 'Repeat analysis' -- that would point at a record that does
            # not exist.
            for mol in ("dna", "rna"):
                if r.qc.get(f"{mol}_action") == "Repeat analysis":
                    r.qc[f"{mol}_action"] = self._weighted(
                        ["Exclude sample", "Investigate / troubleshooting"], (0.6, 0.4))
            if self.rng.random() < 0.85:
                r.qc = {k: ("Pass" if k in ("dna", "rna", "ms") else v)
                        for k, v in r.qc.items()
                        if not k.endswith("_action")}
                self._plan_after_qc_fix(r)
            self._truncate(r)
            self.specimens.append(r)
            s.repeat_record = r

    def _plan_after_qc_fix(self, s: Specimen):
        """Re-lay the post-QC part of the timeline once a repeat is forced to
        pass, so its submission and data-return dates exist."""
        cfg, m = self.cfg, s.milestones
        if "qc" not in m:
            return
        m["send_dna"] = m["qc"] + self._days(cfg.T_SEND_DNA)
        m["data_cg"] = m["send_dna"] + self._days(cfg.T_DATA_CG)
        if s.is_tissue:
            m["send_rna"] = m["qc"] + self._days(cfg.T_SEND_RNA)
            m["data_ge"] = m["send_rna"] + self._days(cfg.T_DATA_GE)
            m.setdefault("protein_extr", m["allprep"])
            m["sp3"] = m["protein_extr"] + self._days(cfg.T_SP3)
            m["ms"] = m["sp3"] + self._days(cfg.T_MS)
            m["spectronaut"] = m["ms"] + self._days(cfg.T_SPECTRONAUT)
        back = [m[k] for k in ("data_cg", "data_ge", "spectronaut") if k in m]
        if back:
            m["mtb"] = max(back) + self._days(cfg.T_MTB)

    # -- field values -----------------------------------------------------
    FREEZERS = ["CCK-A0", "CCK-F1", "CCK-F2", "CCK-F3", "PAT-80-1", "PAT-80-2"]
    COLORS = ["Pale pink", "Dark red", "Greyish white", "Light brown",
              "Mottled red-brown", "Pale tan"]

    def _position(self):
        return f"{self.rng.choice('ABCDEFGH')}{self.rng.randint(1, 12)}"

    def _box(self, prefix, d: date):
        return f"{prefix}-{d.year}-{self.rng.randint(1, 24):02d}"

    def _iso(self, name, s: Specimen):
        d = s.milestones.get(name)
        return d.isoformat() if d else None

    def _deviations(self, s: Specimen) -> dict:
        """Deviation free-text fields. Most specimens have none."""
        out = {}
        if self.rng.random() >= self.cfg.P_DEVIATION:
            return out
        kind = self._weighted(
            ["timing", "temperature", "handling", "labelling"],
            self.cfg.DEVIATION_MIX)
        template = self.rng.choice(DEVIATION_TEXT[kind])
        text = template.format(
            m=self.rng.randint(65, 180),
            h=self.rng.randint(2, 9),
            t=self.rng.choice([-2, 0, 1, 11, 12, 14, 16]),
            p1=self._position(), p2=self._position())
        out[{"timing": "pat_sample_prep_dev1",
             "temperature": "pat_sample_prep_dev2",
             "handling": "pat_sample_prep_dev_3",
             "labelling": "pat_sample_prep_dev_4"}[kind]] = text
        return out

    def _fill_values(self, s: Specimen):
        rng, v = self.rng, {}
        p = s.patient

        # --- Form 1: enrollment. Denormalized onto every one of the patient's
        # records, which is what a record-per-sample project exports.
        v["record_id"] = str(s.record_id)
        v["study_id"] = p.study_id
        v["res_sub_consent"] = p.consent
        v["res_sub_date_birth"] = p.dob.isoformat()
        v["res_sub_enroll_date"] = p.enroll_date.isoformat()
        v["res_sub_name"] = p.oncologist
        v["res_sub_email"] = p.email
        v["res_sub_sex"] = p.sex
        v["res_sub_exactage"] = f"{p.exact_age:.1f}"
        v["other_studies"] = p.other_studies

        # --- Form 2: collection
        if not s.has("collected"):
            s.values = {k: val for k, val in v.items()
                        if val is not None and val != ""}
            return
        v["sample_date"] = self._iso("collected", s)
        v["sample_time"] = self._time(7, 15)
        if s.kind == "blood":
            v["sample_type"] = ["Blood"]
        elif s.is_ffpe:
            v["sample_type"] = ["FFPE"]
        else:
            v["sample_type"] = ["Biopsy"] if s.collected_via_biopsy else ["Tissue"]

        if s.kind == "blood":
            v["sample_blood_loc"] = [rng.choice(
                ["Vein arm", "Vein arm", "Vein hand", "Vein groin"])]
            v["sample_blood_ven_no"] = str(rng.randint(1, 3))
            v["sample_tube_loc"] = rng.choice(
                ["EDTA tube (purple cap)", "EDTA tube (purple cap)",
                 "Heparin tube (green cap)", "Citrate tube (blue cap)",
                 "Serum tube (yellow cap)"])
            v["sample_blood_ven_biob"] = True
            v["sample_blood_ven_biob_no"] = str(rng.randint(1, 3))
            v["sample_blood_ven_pat"] = rng.random() < 0.3
            v["centrifugation_time"] = self._time(8, 16)
            v["calc_centrifufation"] = f"0:{rng.randint(18, 58)}"
        if rng.random() < 0.12:
            v["sample_comments1"] = rng.choice([
                "Tumour resection, upper lobe.", "Lower lobe wedge resection.",
                "EBUS-guided biopsy.", "Second collection this admission."])

        # --- Form 3: pathology
        if s.has("pathology"):
            v["pat_sample_id_1"] = (s.repeat_of.values["pat_sample_id_1"]
                                    if s.repeat_of is not None
                                    else pad_number(rng, s.milestones["collected"]))
            v["pat_sample_date"] = self._iso("pathology_received", s)
            v["receive_time"] = self._time(8, 18)
            v["pat_sample_time"] = self._time(8, 19)
            v["prep_wash"] = rng.random() < 0.6
            v["tube_label"] = tube_barcode(rng)
            v["rack_number"] = f"R{rng.randint(1, 40):02d}"
            v["rack_position"] = self._position()
            v.update(self._deviations(s))

        # --- Form 4: PM-SC registration
        if s.has("pmsc_prep"):
            v["pmsc_id"] = s.pmsc_id
            if s.kind == "blood":
                v["sample_type1"] = ["Blood"]
            elif s.is_ffpe:
                v["sample_type1"] = ["FFPE"]
            else:
                v["sample_type1"] = ["Fresh-Frozen"]

            if s.is_ffpe:
                v["prep_sectioning"] = ["Yes"]
                v["prep_sectioning_date"] = self._iso("pmsc_prep", s)
                v["prep_sectioning_sign"] = rng.choice(self.operators)
                v["if_microdissection"] = rng.random() < 0.45
                v["number_sections"] = str(rng.randint(4, 20))
                v["misrodissection_thickness"] = str(rng.choice([5, 5, 10, 10, 20]))
                v["number_role"] = str(rng.randint(2, 8))
                v["tube_number"] = str(rng.randint(1, 3))
            elif s.is_tissue:
                v["transport_temp_range"] = [self._weighted(
                    ["2-10 °C", "Outside 2-10 °C", "Unknown"], (0.86, 0.10, 0.04))]
                v["prep_cryoprep_2"] = True
                v["pmsc_cryoprep_date"] = self._iso("pmsc_prep", s)
                v["prep_cryoprep_sign"] = rng.choice(self.operators)
                v["pieces_taken"] = str(rng.randint(1, 4))
                v["leftover_material"] = str(rng.randint(0, 3))
                v["sample_size_mm"] = str(rng.randint(15, 240))
                v["sample_color"] = rng.choice(self.COLORS)

        # --- Form 5: DNA / RNA
        if s.has("allprep"):
            v["pmsc_id_v2"] = s.pmsc_id
            v["allprep_date_v2"] = self._iso("allprep", s)
            v["allprep_operator"] = rng.choice(self.operators)
            all_used = rng.random() < 0.55
            v["cryopowder_all_used"] = all_used
            if not all_used:
                v["cryopowder_remain_am"] = f"{rng.randint(5, 60)} mg"
                v["cryopowder_storage_loc"] = (
                    f"{rng.choice(self.FREEZERS)} / "
                    f"{self._box('CRYO', s.milestones['allprep'])} / {self._position()}")
            self._fill_dna(s, v)
            if s.is_tissue:
                self._fill_rna(s, v)

        # --- Form 6: proteomics
        if s.has("allprep") and s.is_tissue:
            self._fill_proteomics(s, v)

        # --- Form 8: tumour board
        if s.has("mtb"):
            v["order_date"] = self._iso("mtb", s)

        self._order_same_day_times(v)
        s.values = {k: val for k, val in v.items() if val is not None and val != ""}

    # -- consistency -------------------------------------------------------
    #: Each clock time in the form, paired with the date field it belongs to,
    #: in the order the steps actually happen. A blood draw is spun after it is
    #: taken; pathology registers a sample after receiving it.
    TIMES_IN_ORDER = (
        ("sample_time", "sample_date"),
        ("centrifugation_time", "sample_date"),
        ("receive_time", "pat_sample_date"),
        ("pat_sample_time", "pat_sample_date"),
    )

    def _order_same_day_times(self, v: dict) -> None:
        """Make the clock agree with the order the steps happened in.

        Each time was drawn independently, so a sample could be collected at
        14:35 and registered at pathology at 09:55 on the same day. On separate
        days nobody notices, but collection and pathology receipt often land on
        the same date, and then the record says the sample reached pathology five
        hours before it was taken. The dashboard's own timeline showed exactly
        that, which is a defect in the data rather than in the view.

        The fix reorders the values already drawn rather than drawing new ones.
        The generator is seeded and its output is byte-identical between runs, so
        redrawing would shift every random value taken afterwards and change the
        whole cohort. Sorting what is already in hand changes these four fields
        and nothing else.

        One consequence worth naming: a value can end up outside the hourly
        window its own field was drawn from, because it swaps with a value drawn
        from a different window. The windows are arbitrary and overlapping; the
        ordering is not.
        """
        by_date: dict[str, list[str]] = {}
        for field, date_field in self.TIMES_IN_ORDER:
            when = v.get(date_field)
            if when and v.get(field):
                by_date.setdefault(when, []).append(field)

        for fields in by_date.values():
            if len(fields) < 2:
                continue
            for field, when in zip(fields, sorted(v[f] for f in fields)):
                v[field] = when

    def _fill_dna(self, s: Specimen, v: dict):
        rng, cfg = self.rng, self.cfg
        failed = s.qc.get("dna") == "Fail"
        v["pmscid_dna"] = f"{s.pmsc_id}-DNA"
        v["dna_elution"] = str(rng.randint(*cfg.DNA_ELUTION_UL))
        v["dna_elution_choice"] = self._weighted(
            ["EB buffer (Qiagen)", "AE buffer", "TE buffer", "Nuclease-free water"],
            (0.55, 0.20, 0.15, 0.10))
        v["dna_location"] = rng.choice(self.FREEZERS)
        v["dna_box"] = self._box("DNA", s.milestones["allprep"])
        v["dna_positon"] = self._position()
        if not s.has("qc"):
            return          # extracted, not yet measured
        conc = self._uniform(cfg.DNA_CONC_FAIL_NG_UL if failed else cfg.DNA_CONC_NG_UL)
        v["dna_conc"] = f"{conc}"
        v["dna_total"] = f"{round(float(v['dna_elution']) * conc, 1)}"
        v["qc_dna"] = ["Fail"] if failed else ["Pass"]
        if failed:
            v["qc_fail_action"] = [s.qc["dna_action"]]
            v["dnaqc_comment"] = rng.choice([
                "Concentration below threshold for library prep.",
                "Qubit reading inconsistent across replicates.",
                "Insufficient yield from available cryopowder."])
            r = getattr(s, "repeat_record", None)
            if r is not None and s.qc["dna_action"] == "Repeat analysis":
                v["dna_repeat"] = r.pmsc_id
        if s.has("submitted") and "send_dna" in s.milestones:
            v["send_dna"] = self._iso("send_dna", s)
            v["sub_dna"] = str(rng.randint(10, 40))
        if s.has("data_back") and "data_cg" in s.milestones:
            v["datafrom_cg"] = self._iso("data_cg", s)

    def _fill_rna(self, s: Specimen, v: dict):
        rng, cfg = self.rng, self.cfg
        failed = s.qc.get("rna") == "Fail"
        v["pmscid_rna"] = f"{s.pmsc_id}-RNA"
        v["rna_elution"] = str(rng.randint(*cfg.RNA_ELUTION_UL))
        v["rna_elution_choice"] = self._weighted(
            ["RNase-free water", "RNase-free Tris buffer", "Buffer RE (Qiagen)",
             "Low-EDTA TE buffer", "Other"], (0.50, 0.20, 0.15, 0.12, 0.03))
        v["rna_loc"] = rng.choice(self.FREEZERS)
        v["rna_box"] = self._box("RNA", s.milestones["allprep"])
        v["rna_pos"] = self._position()
        if not s.has("qc"):
            return          # extracted, not yet measured
        conc = self._uniform(cfg.RNA_CONC_FAIL_NG_UL if failed else cfg.RNA_CONC_NG_UL)
        v["rna_conc"] = f"{conc}"
        v["total_rna"] = f"{round(float(v['rna_elution']) * conc, 1)}"
        v["qc_rna"] = "Fail" if failed else "Pass"
        if failed:
            v["rna_fail"] = s.qc["rna_action"]
            v["rna_comment"] = rng.choice([
                "Degraded RNA; DV200 below 30%.",
                "RIN not measurable on FFPE-derived material.",
                "Yield too low for library preparation."])
            r = getattr(s, "repeat_record", None)
            if r is not None and s.qc["rna_action"] == "Repeat analysis":
                v["rna_repeat"] = r.pmsc_id
        if s.has("submitted") and "send_rna" in s.milestones:
            v["send_rna"] = self._iso("send_rna", s)
            v["sub_rna"] = str(rng.randint(8, 30))
        if s.has("data_back") and "data_ge" in s.milestones:
            v["receive_rna"] = self._iso("data_ge", s)

    def _fill_proteomics(self, s: Specimen, v: dict):
        rng, cfg = self.rng, self.cfg
        v["pmsc_id_v2_v2"] = s.pmsc_id
        v["prot_extr_operator"] = rng.choice(self.operators)
        v["protein_date"] = self._iso("protein_extr", s)
        pc = self._uniform(cfg.PROT_CONC_UG_UL, 2)
        pe = rng.randint(*cfg.PROT_ELUTION_UL)
        v["prot_conc"] = f"{pc}"
        v["prot_elution"] = str(pe)
        v["total_protein"] = f"{round(pc * pe, 1)}"
        if rng.random() < 0.18:
            v["comment_prot"] = rng.choice(
                ["Lysate slightly turbid.", "Clear lysate.", "Faint pink tinge."])

        if not s.has("submitted"):
            return
        v["sp3_digestion"] = self._iso("sp3", s)
        v["prot_extr_operator_2"] = rng.choice(self.operators)
        pep_e = rng.randint(*cfg.PEPTIDE_ELUTION_UL)
        pep_c = self._uniform(cfg.PEPTIDE_CONC_NG_UL)
        v["peptide_elution"] = str(pep_e)
        v["peptide_conc"] = f"{pep_c}"
        v["total_peptide"] = f"{round(pep_e * pep_c / 20, 1)}"
        v["injection_amount"] = str(rng.randint(*cfg.INJECTION_NG))
        v["prot_extr_operator_3"] = rng.choice(self.operators)
        instrument = self._weighted(["TimsTOF", "Astral", "Other"], (0.58, 0.38, 0.04))
        v["masspec_run"] = instrument
        if instrument == "Other":
            v["ms_other"] = rng.choice(["Orbitrap Exploris 480", "Q Exactive HF-X"])
        v["ms_qcheck"] = "Fail" if s.qc.get("ms") == "Fail" else "Pass"
        v["peptide_loc"] = rng.choice(self.FREEZERS)
        v["peptide_box"] = self._box("PEP", s.milestones["allprep"])
        v["peptide_pos"] = self._position()
        # Declared addition: the summary form pipes date_spec, which the
        # dictionary never defines. See data/README.md.
        if s.has("data_back") and "spectronaut" in s.milestones:
            v["date_spec"] = self._iso("spectronaut", s)

    # -- what is still expected to happen ---------------------------------
    def open_streams(self, s: Specimen) -> list:
        """The steps this record is still waiting for.

        A record is only stuck if something is still expected of it. An aliquot
        that failed QC and was repeated, excluded or sent for investigation is
        resolved, not stuck: the work moved elsewhere or stopped on purpose.
        Blood drawn for the biobank is likewise finished at pathology.
        """
        if s.reached == self.expected_end(s):
            return []

        # Not yet split into aliquots: the whole specimen is waiting.
        if not s.has("qc"):
            return ["processing"]

        open_ = []
        if s.qc.get("dna") == "Pass" and "data_cg" not in s.milestones:
            open_.append("dna")
        if s.qc.get("rna") == "Pass" and "data_ge" not in s.milestones:
            open_.append("rna")
        if s.qc.get("ms") == "Pass" and "spectronaut" not in s.milestones:
            open_.append("ms")

        # Every stream resolved but the case never reached the tumour board.
        if not open_ and any(s.qc.get(m) == "Pass" for m in ("dna", "rna", "ms")) \
                and "mtb" not in s.milestones:
            open_.append("mtb")
        return open_

    def is_stalled(self, s: Specimen) -> bool:
        if not self.open_streams(s):
            return False
        last = max(s.milestones.values())
        return (self.cfg.AS_OF - last).days > self.cfg.STALL_THRESHOLD_DAYS

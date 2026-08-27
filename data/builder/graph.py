"""Stage two: normalized tables become a labelled, directed provenance graph.

Twelve node types, per docs/design-decisions.md section 3. The promotion rule is
that a field becomes a node when it is shared, carries its own attributes, or is
traversed through; everything else stays a property.

The graph is derived and rebuildable. Nothing here is a system of record.
"""

from datetime import date, timedelta

STUDY = "PreDDLung"

NODE_TYPES = ["Study", "Patient", "Specimen", "AnalyticalSample", "QCResult",
              "Deviation", "Activity", "PlatformRun", "Facility", "Staff",
              "StorageLocation", "Identifier"]

STAGES = ["enrolled", "collected", "pathology", "pmsc_prep", "allprep",
          "qc", "submitted", "data_back", "mtb"]

FACILITIES = {
    "pathology": ("Pathology, Karolinska", "hospital pathology"),
    "pmsc": ("PM Sample Central", "sample central"),
    "cg": ("Clinical Genomics, SciLifeLab", "sequencing platform"),
    "ge": ("Genomics Express", "RNA sequencing service"),
    "cp": ("Clinical Proteomics, SciLifeLab", "mass spectrometry platform"),
    "mtb": ("Molecular Tumor Board Portal", "tumour board"),
}

DEVIATION_FIELDS = {
    "pat_sample_prep_dev1": "timing",
    "pat_sample_prep_dev2": "temperature",
    "pat_sample_prep_dev_3": "handling",
    "pat_sample_prep_dev_4": "labelling",
}

DATE_FIELDS = [
    "sample_date", "pat_sample_date", "prep_sectioning_date", "pmsc_cryoprep_date",
    "allprep_date_v2", "send_dna", "datafrom_cg", "send_rna", "receive_rna",
    "protein_date", "sp3_digestion", "date_spec", "order_date",
]


class GraphBuilder:
    def __init__(self, as_of: date, stall_threshold: int = 30):
        self.as_of = as_of
        self.stall_threshold = stall_threshold
        self.nodes = {}
        self.edges = []

    # -- primitives -------------------------------------------------------
    def node(self, nid, ntype, label, **props):
        if nid not in self.nodes:
            self.nodes[nid] = {"id": nid, "type": ntype, "label": label,
                               **{k: v for k, v in props.items() if v is not None}}
        return nid

    def edge(self, src, dst, etype, **props):
        if src is None or dst is None:
            return
        self.edges.append({"source": src, "target": dst, "type": etype,
                           **{k: v for k, v in props.items() if v is not None}})

    def identifier(self, value, system, owner):
        """Every cross-system ID becomes a node. Reconciling this chain is the
        point of the graph, so the IDs are objects, not string attributes."""
        if not value:
            return None
        nid = f"id:{system}:{value}"
        self.node(nid, "Identifier", value, system=system)
        self.edge(owner, nid, "IDENTIFIED_AS")
        return nid

    def staff(self, hsa, activity, role):
        if not hsa:
            return None
        nid = self.node(f"staff:{hsa}", "Staff", hsa, hsa_id=hsa)
        self.edge(nid, activity, "PERFORMED", role=role)
        return nid

    def facility(self, key):
        name, kind = FACILITIES[key]
        return self.node(f"facility:{key}", "Facility", name, kind=kind)

    def storage(self, freezer, box, position, owner, since=None):
        if not freezer:
            return None
        label = " / ".join(x for x in (freezer, box, position) if x)
        nid = self.node(f"loc:{label}", "StorageLocation", label,
                        freezer=freezer, box=box, position=position)
        self.edge(owner, nid, "STORED_AT", since=since)
        return nid

    def activity(self, key, record_id, label, on, facility_key=None, used=None,
                 generated=None, at=None):
        """One step in the chain.

        `at` is the clock time the export recorded for the step, where it
        recorded one. Only two steps carry a time in the REDCap form, and it
        matters because several steps routinely land on the same date: without
        it, a reader cannot tell which of two things that happened on the third
        of February happened first.
        """
        if not on:
            return None
        nid = self.node(f"act:{record_id}:{key}", "Activity", label,
                        activity=key, date=on, time=at)
        if facility_key:
            self.edge(nid, self.facility(facility_key), "AT_FACILITY")
        for u in (used or []):
            self.edge(nid, u, "USED")
        for g in (generated or []):
            self.edge(nid, g, "GENERATED")
        return nid

    # -- derived state ----------------------------------------------------
    @staticmethod
    def stage_of(s: dict) -> str:
        if s.get("order_date"):
            return "mtb"
        if s.get("datafrom_cg") or s.get("receive_rna") or s.get("date_spec"):
            return "data_back"
        if s.get("send_dna") or s.get("send_rna") or s.get("sp3_digestion"):
            return "submitted"
        if s.get("qc_dna") or s.get("qc_rna"):
            return "qc"
        if s.get("allprep_date_v2"):
            return "allprep"
        if s.get("pmsc_id"):
            return "pmsc_prep"
        if s.get("pat_sample_date"):
            return "pathology"
        if s.get("sample_date"):
            return "collected"
        return "enrolled"

    @staticmethod
    def is_biobank_only(s: dict) -> bool:
        """Blood drawn for the biobank finishes at pathology by design."""
        return ("Blood" in (s.get("sample_type") or [])
                and not s.get("pmsc_id")
                and bool(s.get("sample_blood_ven_biob")))

    def open_streams(self, s: dict) -> list:
        stage = self.stage_of(s)
        if stage == "mtb":
            return []
        if self.is_biobank_only(s):
            return []
        if stage in ("enrolled", "collected", "pathology", "pmsc_prep", "allprep"):
            return ["processing"]

        open_ = []
        if (s.get("qc_dna") or []) == ["Pass"] and not s.get("datafrom_cg"):
            open_.append("dna")
        if s.get("qc_rna") == "Pass" and not s.get("receive_rna"):
            open_.append("rna")
        if s.get("ms_qcheck") == "Pass" and not s.get("date_spec"):
            open_.append("ms")
        passed = ((s.get("qc_dna") or []) == ["Pass"] or s.get("qc_rna") == "Pass"
                  or s.get("ms_qcheck") == "Pass")
        if not open_ and passed and not s.get("order_date"):
            open_.append("mtb")
        return open_

    def last_event(self, s: dict, patient: dict):
        dates = [s[f] for f in DATE_FIELDS if s.get(f)]
        if not dates and patient.get("res_sub_enroll_date"):
            dates = [patient["res_sub_enroll_date"]]
        return max(dates) if dates else None

    def stalled_days(self, s: dict, patient: dict):
        """Days since the last recorded step, when something is still expected."""
        if not self.open_streams(s):
            return None
        last = self.last_event(s, patient)
        if not last:
            return None
        days = (self.as_of - date.fromisoformat(last)).days
        return days if days > self.stall_threshold else None

    # -- assembly ---------------------------------------------------------
    def build(self, patients: list, samples: list) -> dict:
        study = self.node(f"study:{STUDY}", "Study", STUDY,
                          description="Multimodal ICI precision medicine in NSCLC")
        by_study_id = {p["study_id"]: p for p in patients}

        for p in patients:
            pid = self.node(
                f"patient:{p['study_id']}", "Patient", p["study_id"],
                sex=p.get("res_sub_sex"),
                age=float(p["res_sub_exactage"]) if p.get("res_sub_exactage") else None,
                enrolled_on=p.get("res_sub_enroll_date"),
                consent=p.get("res_sub_consent"),
                other_studies=p.get("other_studies"))
            self.edge(study, pid, "HAS_PATIENT")
            self.identifier(p["study_id"], "eCRF study ID", pid)
            onc = p.get("res_sub_name")
            if onc:
                s_id = self.node(f"staff:{onc}", "Staff", onc, hsa_id=onc)
                self.edge(s_id, pid, "ENROLLED", role="enrolling oncologist")

        pmsc_to_record = {s["pmsc_id"]: s["record_id"] for s in samples if s.get("pmsc_id")}

        for s in samples:
            self._specimen(s, by_study_id.get(s["study_id"]), pmsc_to_record)

        return {
            "as_of": self.as_of.isoformat(),
            "study": STUDY,
            "node_types": NODE_TYPES,
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
        }

    def _specimen(self, s: dict, patient: dict, pmsc_to_record: dict):
        rid = s["record_id"]
        pid = f"patient:{s['study_id']}"

        if not s.get("sample_date"):
            return   # consented, nothing collected yet: no specimen exists

        types = s.get("sample_type") or []
        kind = ("Blood" if "Blood" in types else
                "FFPE" if "FFPE" in types else
                "Biopsy" if "Biopsy" in types else "Tissue")
        stage = self.stage_of(s)
        stalled = self.stalled_days(s, patient or {})

        spec = self.node(
            f"specimen:{rid}", "Specimen", f"Specimen {rid}",
            sample_type=kind, collected_on=s.get("sample_date"),
            stage_reached=stage, stalled_days=stalled,
            is_repeat=bool(s.get("_is_repeat")),
            record_id=rid)
        self.edge(pid, spec, "HAS_SPECIMEN")

        self.identifier(s.get("pat_sample_id_1"), "PAD (pathology)", spec)
        self.identifier(s.get("tube_label"), "biobank tube barcode", spec)
        self.identifier(s.get("pmsc_id"), "PMSC ID", spec)

        self.activity("collection", rid, "Sample collection", s.get("sample_date"),
                      generated=[spec], at=s.get("sample_time"))

        # --- pathology
        if s.get("pat_sample_date"):
            act = self.activity("pathology", rid, "Pathology registration",
                                s.get("pat_sample_date"), "pathology", used=[spec],
                                at=s.get("pat_sample_time"))
            for field, dev_type in DEVIATION_FIELDS.items():
                if s.get(field):
                    dnode = self.node(f"dev:{rid}:{dev_type}", "Deviation",
                                      f"{dev_type.title()} deviation",
                                      deviation_type=dev_type, note=s[field])
                    self.edge(spec, dnode, "HAS_DEVIATION")
            if s.get("rack_number"):
                self.storage(f"Pathology rack {s['rack_number']}", None,
                             s.get("rack_position"), spec, s.get("pat_sample_date"))

        # --- PM-SC preparation
        prep_date = s.get("prep_sectioning_date") or s.get("pmsc_cryoprep_date")
        if prep_date:
            is_ffpe = bool(s.get("prep_sectioning_date"))
            act = self.activity(
                "sectioning" if is_ffpe else "cryoprep", rid,
                "Sectioning" if is_ffpe else "Cryopreparation",
                prep_date, "pmsc", used=[spec])
            self.staff(s.get("prep_sectioning_sign") or s.get("prep_cryoprep_sign"),
                       act, "sectioning" if is_ffpe else "cryoprep")

        # --- AllPrep and the aliquots it generates
        if s.get("allprep_date_v2"):
            aliquots = self._aliquots(s, spec, stage)
            act = self.activity("allprep", rid, "AllPrep co-extraction",
                                s["allprep_date_v2"], "pmsc",
                                used=[spec], generated=aliquots)
            self.staff(s.get("allprep_operator"), act, "allprep")
            if s.get("cryopowder_storage_loc"):
                self.storage(s["cryopowder_storage_loc"], None, None, spec,
                             s["allprep_date_v2"])

        # --- tumour board
        if s.get("order_date"):
            self.activity("mtb", rid, "Tumour board order", s["order_date"],
                          "mtb", used=[spec])

        # --- repeat links: the failing record points at the record that re-ran it
        for field in ("dna_repeat", "rna_repeat"):
            target_pmsc = s.get(field)
            if target_pmsc and target_pmsc in pmsc_to_record:
                self.edge(f"specimen:{pmsc_to_record[target_pmsc]}", spec,
                          "REPEAT_OF", molecule=field.split("_")[0].upper())

    def _aliquots(self, s: dict, spec: str, stage: str) -> list:
        rid, pmsc = s["record_id"], s.get("pmsc_id")
        made = []

        made += self._aliquot(
            s, spec, rid, "DNA", s.get("pmscid_dna"),
            elution=s.get("dna_elution"), buffer=s.get("dna_elution_choice"),
            conc=s.get("dna_conc"), total=s.get("dna_total"),
            qc=(s.get("qc_dna") or [None])[0],
            fail_action=(s.get("qc_fail_action") or [None])[0],
            qc_comment=s.get("dnaqc_comment"),
            sent_on=s.get("send_dna"), volume=s.get("sub_dna"),
            returned_on=s.get("datafrom_cg"), facility_key="cg",
            loc=(s.get("dna_location"), s.get("dna_box"), s.get("dna_positon")))

        made += self._aliquot(
            s, spec, rid, "RNA", s.get("pmscid_rna"),
            elution=s.get("rna_elution"), buffer=s.get("rna_elution_choice"),
            conc=s.get("rna_conc"), total=s.get("total_rna"),
            qc=s.get("qc_rna"), fail_action=s.get("rna_fail"),
            qc_comment=s.get("rna_comment"),
            sent_on=s.get("send_rna"), volume=s.get("sub_rna"),
            returned_on=s.get("receive_rna"), facility_key="ge",
            loc=(s.get("rna_loc"), s.get("rna_box"), s.get("rna_pos")))

        # Protein and peptide carry no identifier field of their own in the
        # dictionary; they are addressed through the PMSC ID.
        if s.get("protein_date") and pmsc:
            prot = self._aliquot(
                s, spec, rid, "Protein", f"{pmsc}-PROT",
                elution=s.get("prot_elution"), conc=s.get("prot_conc"),
                total=s.get("total_protein"), derived_id=True)
            made += prot
            act = self.activity("protein_extraction", rid, "Protein extraction",
                                s["protein_date"], "pmsc", used=[spec],
                                generated=prot)
            self.staff(s.get("prot_extr_operator"), act, "protein extraction")

            if s.get("sp3_digestion"):
                pep = self._aliquot(
                    s, spec, rid, "Peptide", f"{pmsc}-PEP",
                    elution=s.get("peptide_elution"), conc=s.get("peptide_conc"),
                    total=s.get("total_peptide"), derived_id=True,
                    loc=(s.get("peptide_loc"), s.get("peptide_box"),
                         s.get("peptide_pos")))
                made += pep
                if prot and pep:
                    self.edge(pep[0], prot[0], "DERIVED_FROM")
                act = self.activity("sp3", rid, "SP3 peptide digestion",
                                    s["sp3_digestion"], "pmsc",
                                    used=prot, generated=pep)
                self.staff(s.get("prot_extr_operator_2"), act, "peptide digestion")

                if s.get("masspec_run") and pep:
                    self._mass_spec(s, rid, pep[0])
        return made

    def _aliquot(self, s, spec, rid, molecule, ident, elution=None, buffer=None,
                 conc=None, total=None, qc=None, fail_action=None, qc_comment=None,
                 sent_on=None, volume=None, returned_on=None, facility_key=None,
                 loc=None, derived_id=False):
        if not ident:
            return []
        nid = self.node(
            f"aliquot:{ident}", "AnalyticalSample", ident,
            molecule=molecule,
            elution_ul=_num(elution), buffer=buffer,
            concentration=_num(conc), total=_num(total),
            qc=qc, record_id=rid)
        self.edge(nid, spec, "DERIVED_FROM")
        if not derived_id:
            self.identifier(ident, f"PMSC {molecule} aliquot ID", nid)

        if qc:
            q = self.node(f"qc:{ident}", "QCResult", f"{molecule} QC: {qc}",
                          outcome=qc, molecule=molecule,
                          fail_action=fail_action, note=qc_comment)
            self.edge(nid, q, "HAS_QC")

        if loc and loc[0]:
            self.storage(loc[0], loc[1], loc[2], nid)

        if sent_on and facility_key:
            run = self.node(
                f"run:{ident}", "PlatformRun", f"{molecule} submission",
                molecule=molecule, sent_on=sent_on, returned_on=returned_on,
                volume_ul=_num(volume),
                turnaround_days=_days_between(sent_on, returned_on))
            self.edge(nid, run, "SUBMITTED_TO", sent_on=sent_on, volume_ul=_num(volume))
            self.edge(run, self.facility(facility_key), "RUN_AT")
            if returned_on:
                self.edge(run, nid, "RETURNED_DATA", returned_on=returned_on)
        return [nid]

    def _mass_spec(self, s, rid, peptide_node):
        instrument = s.get("masspec_run")
        if instrument == "Other":
            instrument = s.get("ms_other") or "Other"
        run = self.node(
            f"run:ms:{rid}", "PlatformRun", f"MS run ({instrument})",
            molecule="Peptide", instrument=instrument,
            injection_ng=_num(s.get("injection_amount")),
            qc=s.get("ms_qcheck"), returned_on=s.get("date_spec"))
        self.edge(peptide_node, run, "SUBMITTED_TO")
        self.edge(run, self.facility("cp"), "RUN_AT")
        if s.get("ms_qcheck"):
            q = self.node(f"qc:ms:{rid}", "QCResult",
                          f"MS QC: {s['ms_qcheck']}",
                          outcome=s["ms_qcheck"], molecule="Peptide")
            self.edge(run, q, "HAS_QC")
        if s.get("date_spec"):
            self.edge(run, peptide_node, "RETURNED_DATA", returned_on=s["date_spec"])
        self.staff(s.get("prot_extr_operator_3"), run, "mass spectrometry")


def _num(v):
    if v in (None, ""):
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 3)
    except (TypeError, ValueError):
        return v


def _days_between(a, b):
    if not a or not b:
        return None
    return (date.fromisoformat(b) - date.fromisoformat(a)).days

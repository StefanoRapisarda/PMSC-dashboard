"""Generate the PM-SC synthetic dataset.

    python3 generate.py [--out DIR]

Writes a REDCap-shaped CSV export plus a small manifest recording the snapshot
date, the seed and the cohort counts. The seed is fixed in config.py, so
repeated runs of the same config produce byte-identical output.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import config as C
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
import dictionary as D
import emit
from model import STAGES, Simulation

OUT_DIR = Path(__file__).resolve().parents[1] / "out"


def summarise(sim) -> dict:
    stages = Counter(s.reached for s in sim.specimens)
    kinds = Counter(s.kind for s in sim.specimens)
    stalled = [s for s in sim.specimens if _is_stalled(sim, s)]
    stalled_by_stage = Counter(s.reached for s in stalled)
    qc = Counter()
    for s in sim.specimens:
        if not s.has("qc"):
            continue
        for mol in ("dna", "rna", "ms"):
            if mol in s.qc:
                qc[f"{mol}_{s.qc[mol].lower()}"] += 1
    return {
        "as_of": C.AS_OF.isoformat(),
        "seed": C.SEED,
        "enrollment_window": [C.ENROLL_START.isoformat(), C.ENROLL_END.isoformat()],
        "stall_threshold_days": C.STALL_THRESHOLD_DAYS,
        "patients": len(sim.patients),
        "patients_in_export": len({s.patient.n for s in sim.specimens}),
        "patients_awaiting_collection": sum(
            1 for s in sim.specimens if s.kind == "pending"),
        "records": len(sim.specimens),
        "repeat_records": sum(1 for s in sim.specimens if s.repeat_of is not None),
        "specimens_by_kind": dict(kinds),
        "records_by_stage_reached": {k: stages.get(k, 0) for k in STAGES},
        "qc_outcomes": dict(qc),
        "stalled_records": len(stalled),
        "stalled_by_stage_reached": dict(stalled_by_stage),
    }


def _is_stalled(sim, s) -> bool:
    return sim.is_stalled(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    dic = D.load()
    sim = Simulation().run()

    export_path = args.out / "redcap_export.csv"
    header = emit.write_export(dic, sim.specimens, export_path)

    manifest = summarise(sim)
    manifest["export_columns"] = len(header)
    manifest["dictionary"] = D.DICTIONARY_PATH.name
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"wrote {export_path} ({len(sim.specimens)} records, {len(header)} columns)")
    for k, v in manifest.items():
        if k != "export_columns":
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()

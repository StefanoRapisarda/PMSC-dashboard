"""Build the dashboard's data from a REDCap export.

    python3 build.py [--export PATH] [--out DIR] [--web DIR]

Three stages, in order:
    normalize   export CSV        -> patients.csv + samples.csv
    graph       normalized tables -> graph.json
    aggregates  normalized tables -> aggregates.json

Intermediates stay in data/out. The two artifacts the frontend fetches are
written to web/static/data and committed, so a fresh clone runs the demo
without a Python toolchain.
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aggregates
import normalize
from graph import GraphBuilder

DATA_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = DATA_DIR / "out"
WEB_DIR = DATA_DIR.parent / "web" / "static" / "data"


def _read_manifest(out_dir: Path) -> dict:
    path = out_dir / "manifest.json"
    if not path.exists():
        raise SystemExit(
            f"{path} not found. Run data/generator/generate.py first, or pass "
            "--as-of explicitly when building from a real export.")
    return json.loads(path.read_text())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", type=Path, default=OUT_DIR / "redcap_export.csv")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--web", type=Path, default=WEB_DIR)
    ap.add_argument("--as-of", type=date.fromisoformat, default=None,
                    help="snapshot date; defaults to the generator manifest")
    ap.add_argument("--stall-threshold", type=int, default=None)
    args = ap.parse_args()

    manifest = _read_manifest(args.out) if args.as_of is None else {}
    as_of = args.as_of or date.fromisoformat(manifest["as_of"])
    threshold = args.stall_threshold or manifest.get("stall_threshold_days", 30)

    # --- stage 1
    patients, samples, conflicts = normalize.normalize(args.export)
    normalize.write_tables(patients, samples, args.out)
    if conflicts:
        print(f"  {len(conflicts)} patient(s) with conflicting enrollment fields:")
        for sid, c in conflicts[:10]:
            print(f"    {sid}: {c}")

    # Mark records created as a repeat of another, for the graph's facets.
    repeat_targets = {s.get("dna_repeat") for s in samples} | \
                     {s.get("rna_repeat") for s in samples}
    repeat_targets.discard(None)
    for s in samples:
        s["_is_repeat"] = s.get("pmsc_id") in repeat_targets

    # --- stage 2
    g = GraphBuilder(as_of, threshold).build(patients, samples)

    # --- stage 3
    agg = aggregates.build(patients, samples, as_of, threshold)

    args.out.mkdir(parents=True, exist_ok=True)
    args.web.mkdir(parents=True, exist_ok=True)
    for name, payload in (("graph.json", g), ("aggregates.json", agg)):
        # Readable copy for inspection, compact copy for the browser to fetch.
        (args.out / name).write_text(json.dumps(payload, indent=1) + "\n")
        (args.web / name).write_text(json.dumps(payload, separators=(",", ":")))

    _report(g, agg, args)


def _report(g, agg, args):
    from collections import Counter
    print(f"built from {args.export}")
    print(f"  as of {g['as_of']}")
    print(f"  nodes {len(g['nodes'])}  edges {len(g['edges'])}")
    print("  node types:", dict(Counter(n["type"] for n in g["nodes"])))
    print("  edge types:", dict(Counter(e["type"] for e in g["edges"])))
    print("  KPIs:", json.dumps(agg["kpis"]))
    print(f"  wrote {args.web / 'graph.json'} and aggregates.json")


if __name__ == "__main__":
    main()

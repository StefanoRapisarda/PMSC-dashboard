"""Where things live, and the few numbers that are policy rather than data."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # .../dashboard/api
DASHBOARD = ROOT.parent                                 # .../dashboard
SOURCE_DIR = DASHBOARD / "data" / "out"                 # the built synthetic export

DATABASE_PATH = ROOT / "pmsc.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# The showcase runs on a synthetic cohort. In production this seeder is replaced
# by the weekly REDCap pipeline; nothing above this line changes.
# The built front end, when there is one. In development there is not: the web
# app runs on its own port under Vite and talks to this service across origins.
# In a container both come from here, which is why the path is overridable.
WEB_DIR = Path(os.environ.get("PMSC_WEB_DIR", DASHBOARD / "web" / "build"))

GRAPH_JSON = SOURCE_DIR / "graph.json"
REDCAP_CSV = SOURCE_DIR / "redcap_export.csv"
MANIFEST_JSON = SOURCE_DIR / "manifest.json"

# A specimen or aliquot with no next step for this long is "stalled". Provisional:
# one flat number may not fit every stage — analysis at the labs legitimately takes
# weeks. Open question with the team.
STALL_THRESHOLD_DAYS = 30

# Order of the pipeline. Used for stage counts and for "how far did this get".
STAGES = ["enrolled", "collected", "pathology", "pmsc_prep", "allprep",
          "qc", "submitted", "data_back", "mtb"]

MOLECULES = ["DNA", "RNA", "Protein", "Peptide"]

CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

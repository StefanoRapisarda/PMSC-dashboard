"""Where things live, and the few numbers that are policy rather than data."""
import os
from datetime import date
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

# The study's own targets, which only the study team can set. No document in
# this repository states them, so the values below are ILLUSTRATIVE. They are
# chosen to resemble MEGALiT, the closest comparable trial in the domain brief
# (148 patients enrolled, a median of 28 days to the tumour board), so that the
# dashboard can show what judging progress against a target looks like.
#
# While TARGETS_ARE_ILLUSTRATIVE is True, every number on the dashboard that
# comes from these targets carries a "fac simile" stamp. Replace the values from
# the protocol and set it to False; any target set to None shows as "not set".
TARGETS_ARE_ILLUSTRATIVE = True
#
# TARGET_ENROLMENT is the planned number of patients, and RECRUITMENT_END the
# date recruitment is planned to close (a datetime.date). With both set, the
# dashboard says whether recruitment is on pace.
TARGET_ENROLMENT: int | None = 150
RECRUITMENT_END: date | None = date(2026, 12, 31)
# The share of collected samples that should yield results, and the share of
# enrolled patients whose case should reach the tumour board portal, in percent.
TARGET_RESULTS_PCT: float | None = 70
TARGET_PORTAL_PCT: float | None = 75
# The longest acceptable time from collection to the order in the portal, in
# days, and the share of samples that should meet it, in percent.
TURNAROUND_WINDOW_DAYS: int | None = 35
TARGET_WITHIN_WINDOW_PCT: float | None = 80

# How far behind plan recruitment may fall before the status turns amber, and
# then red, as a fraction of the enrolment expected by now. These are the bands
# one published accrual dashboard uses (at least 100% on pace, 80-99% at risk,
# below 80% behind); they are a starting point for the team to change.
PACE_AMBER = 0.8
PACE_GREEN = 1.0
# The recent pace used to project a completion date, in weeks.
PACE_WINDOW_WEEKS = 13

CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

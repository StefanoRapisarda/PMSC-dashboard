"""Generation parameters for the PM-SC synthetic dataset.

Every number the generator uses lives here, so the dataset can be re-shaped
without touching the simulation code. The seed is fixed: the same config
always produces byte-identical output.
"""

from datetime import date

# --- Reproducibility -------------------------------------------------------
SEED = 20260819

# --- Time ------------------------------------------------------------------
# The dataset is a snapshot. AS_OF is stamped into the build output and read by
# the frontend; it is never taken from the system clock. Anything that would
# happen after AS_OF simply has not happened yet.
AS_OF = date(2026, 8, 19)
ENROLL_START = date(2025, 1, 6)
ENROLL_END = date(2026, 8, 12)

# --- Cohort ----------------------------------------------------------------
N_PATIENTS = 100
N_ENROLLED_ONLY = 5           # consented, no specimen collected yet

P_BLOOD_WITH_TISSUE = 0.72    # patients giving blood alongside their tissue
P_TISSUE_FFPE = 0.40          # of tissue specimens; remainder fresh-frozen
P_BIOPSY_SOURCE = 0.30        # tissue arriving as a biopsy rather than resection
N_BLOOD_TO_PMSC = 15          # blood specimens continued to DNA extraction

# --- QC --------------------------------------------------------------------
P_DNA_FAIL = 0.08
P_RNA_FAIL_FF = 0.10
P_RNA_FAIL_FFPE = 0.24        # FFPE RNA is degraded; fails more often
P_MS_FAIL = 0.10

# Of failures: repeat / exclude / investigate
FAIL_ACTION_WEIGHTS = (0.70, 0.18, 0.12)

# --- Deviations ------------------------------------------------------------
P_DEVIATION = 0.15            # specimens carrying at least one deviation
DEVIATION_MIX = (0.50, 0.22, 0.16, 0.12)   # timing, temperature, handling, labelling

# --- Stalls ----------------------------------------------------------------
STALL_THRESHOLD_DAYS = 30
N_STALLED = 12                # objects forced to stop early and stay stopped
STALL_MIN_DAYS = 45           # a stalled object's last step is at least this old
STALL_MAX_DAYS = 210          # ...and at most this old, so it stays believable

# --- People ----------------------------------------------------------------
N_ONCOLOGISTS = 4
N_OPERATORS = 10

# --- Stage timings (days after the preceding step, inclusive range) ---------
# Derived from the PreDDLung journey in docs/domain-brief.md section 5.
T_PATHOLOGY_RECEIVE = (0, 0)      # same day as surgery
T_PATHOLOGY_PROCESS = (0, 0)
T_PMSC_PREP = (2, 14)             # withdrawal from freezer, then cryoprep/sectioning
T_ALLPREP = (0, 3)
T_QC = (0, 1)                     # Qubit concentration measurement
T_SEND_DNA = (1, 7)
T_DATA_CG = (10, 21)
T_SEND_RNA = (1, 7)
T_DATA_GE = (10, 21)
T_PROTEIN_EXTR = (0, 0)           # protein fraction comes off the same AllPrep
T_SP3 = (1, 5)
T_MS = (2, 10)
T_SPECTRONAUT = (1, 4)
T_MTB = (3, 14)

# --- Assay value ranges ----------------------------------------------------
# Concentrations are generated in ng/ul (DNA, RNA, peptide) and ug/ul (protein).
# The dictionary prints "ul/ug" for dna_conc and rna_conc, which is inverted
# for a concentration; see data/README.md, "Declared deviations".
DNA_ELUTION_UL = (50, 100)
DNA_CONC_NG_UL = (18.0, 145.0)
DNA_CONC_FAIL_NG_UL = (0.4, 9.0)

RNA_ELUTION_UL = (30, 80)
RNA_CONC_NG_UL = (25.0, 310.0)
RNA_CONC_FAIL_NG_UL = (0.5, 11.0)

PROT_ELUTION_UL = (30, 80)
PROT_CONC_UG_UL = (0.9, 7.5)

PEPTIDE_ELUTION_UL = (20, 50)
PEPTIDE_CONC_NG_UL = (110.0, 780.0)
INJECTION_NG = (200, 800)

# --- Patient demographics (NSCLC) ------------------------------------------
P_MALE = 0.55
AGE_MEAN = 68.0
AGE_SD = 9.0
AGE_MIN, AGE_MAX = 45, 88

P_OTHER_STUDIES = 0.18

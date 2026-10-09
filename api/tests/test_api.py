"""End-to-end checks over the seeded database.

These assert the things that were actually wrong at some point during the build,
which is the only reason to keep a test: unit discipline in the funnel, the
proteomics stream having a QC outcome at all, and turnaround being honest about
what it cannot measure.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_the_seeded_study():
    body = client.get("/healthz").json()
    assert body["ok"] is True
    assert body["study"] == "PreDDLung"


def test_meta_lists_the_value_sets_from_the_data():
    body = client.get("/api/meta").json()
    assert body["counts"]["patients"] == 100
    assert body["counts"]["specimens"] == 176
    # the export's own sample types, not the three the mockup guessed
    assert set(body["sample_types"]) == {"Biopsy", "Blood", "FFPE", "Tissue"}


def test_kpis_are_derived_not_stored():
    kpis = client.get("/api/overview").json()["kpis"]
    assert kpis["patients_enrolled"] == 100
    assert 0 < kpis["qc_pass_rate"] <= 100
    assert kpis["specimens_with_data_back"] <= kpis["specimens_collected"]


def test_funnel_never_grows_along_a_stream():
    flow = client.get("/api/overview").json()["flow"]
    for stream in flow["streams"].values():
        counts = [step["count"] for step in stream["chain"]]
        assert counts == sorted(counts, reverse=True), stream["chain"]


def test_analysis_column_counts_specimens_not_aliquots():
    """The unit flips back after the split; summing the three aliquot streams
    here would inflate the column roughly threefold."""
    overview = client.get("/api/overview").json()
    flow = overview["flow"]
    assert flow["analysis"]["unit"] == "specimens"
    assert flow["analysis"]["count"] == overview["kpis"]["specimens_with_data_back"]
    aliquot_sum = sum(s["chain"][-1]["count"] for s in flow["streams"].values())
    assert flow["analysis"]["count"] < aliquot_sum


def test_proteomics_stream_has_a_qc_outcome():
    """ms_qcheck is in the REDCap export but was missing from the graph artefact,
    so the whole protein stream once reported zero pass and zero fail."""
    protein = client.get("/api/overview").json()["flow"]["streams"]["Protein"]
    assert protein["qc_position"] == "after_run"
    assert protein["qc_fail"] > 0
    assert any(step["stage"] == "MS QC passed" and step["count"] > 0
               for step in protein["chain"])


def test_turnaround_says_when_it_cannot_measure():
    """The mass-spec run has a returned date but no sent date, so its wait time
    is genuinely unmeasurable — the row must still appear, and say so."""
    labs = client.get("/api/overview").json()["turnaround"]["analysis_labs"]
    proteomics = next(p for p in labs if "Proteomics" in p["name"])
    assert proteomics["median_days"] is None
    assert "no send date" in proteomics["note"]
    assert len([p for p in labs if p["median_days"] is not None]) >= 2


def test_turnaround_treats_the_analysis_labs_as_one_parallel_segment():
    """Three fractions are analysed at the same time, so the analysis labs are
    one segment of the path measured per specimen, not three waits to be added."""
    turnaround = client.get("/api/overview").json()["turnaround"]
    segment = next(s for s in turnaround["segments"] if s["key"] == "analysis_labs")
    assert segment["parallel"] is True
    assert segment["owner"] == "analysis_lab"
    # waiting for the slowest of three takes at least as long as any one of them
    slowest = max(p["median_days"] for p in turnaround["analysis_labs"]
                  if p["median_days"] is not None)
    assert segment["median_days"] >= slowest


def test_turnaround_segments_are_close_to_the_measured_whole():
    """Medians do not add exactly, but a critical path that is wildly off the
    end-to-end figure means the segments do not describe the same journey."""
    turnaround = client.get("/api/overview").json()["turnaround"]
    walked = turnaround["in_house_days"] + turnaround["analysis_lab_days"]
    measured = turnaround["end_to_end"]["median_days"]
    assert abs(walked - measured) < measured * 0.15, f"{walked} vs {measured}"


def test_turnaround_uses_the_conventional_laboratory_phases():
    """Pre-analytical, analytical, post-analytical is the vocabulary the field
    already uses for turnaround; every segment belongs to exactly one phase."""
    turnaround = client.get("/api/overview").json()["turnaround"]
    phases = {p["key"]: p for p in turnaround["phases"]}
    assert set(phases) == {"pre_analytical", "analytical", "post_analytical"}
    assert {s["phase"] for s in turnaround["segments"]} == set(phases)

    # the analytical phase belongs to the analysis labs and nothing else does
    analytical = [s for s in turnaround["segments"] if s["phase"] == "analytical"]
    assert all(s["owner"] == "analysis_lab" for s in analytical)
    assert all(s["owner"] == "in_house" for s in turnaround["segments"]
               if s["phase"] != "analytical")

    # and the phase totals account for the whole walked path
    walked = sum(p["days"] for p in turnaround["phases"])
    assert walked == pytest.approx(turnaround["in_house_days"]
                                   + turnaround["analysis_lab_days"], abs=0.05)


def test_graph_speaks_the_mockup_vocabulary():
    body = client.get("/api/graph").json()
    types = {n["type"] for n in body["nodes"]}
    assert {"patient", "sample", "aliquot", "lab", "system", "storage"} <= types
    assert "platform" not in types
    edge_types = {e["type"] for e in body["edges"]}
    assert {"has_sample", "derived_from", "identified_as"} <= edge_types


def test_peptide_hangs_off_protein_not_the_specimen():
    body = client.get("/api/graph").json()
    nodes = {n["id"]: n for n in body["nodes"]}
    peptides = [n for n in body["nodes"] if n.get("mol") == "Peptide"]
    assert peptides
    for edge in body["edges"]:
        if edge["type"] == "derived_from" and nodes[edge["a"]].get("mol") == "Peptide":
            assert nodes[edge["b"]].get("mol") == "Protein"


def test_patient_limit_shrinks_the_cohort():
    small = client.get("/api/graph?patients=20").json()
    assert small["counts"]["patients"] == 20
    assert small["counts"]["nodes"] < client.get("/api/graph").json()["counts"]["nodes"]
    assert small["patients_total"] == 100


def test_specimen_detail_carries_the_id_chain():
    detail = client.get("/api/specimens/1").json()
    assert detail["patient"]["label"].startswith("PDL-")
    schemes = {link["scheme"] for link in detail["id_chain"]}
    assert "PAD (pathology)" in schemes
    pad = next(link for link in detail["id_chain"] if link["scheme"] == "PAD (pathology)")
    assert pad["issued_by"] == "Sympathy"
    assert detail["fractions"]


def test_every_place_that_handles_material_is_a_lab():
    """Pathology and the PMSC lab do work on the sample, so they are labs too,
    and the steps carried out there point at them."""
    body = client.get("/api/graph").json()
    nodes = body["nodes"]
    labs = {n["label"] for n in nodes if n["type"] == "lab"}
    assert {"Pathology, Karolinska", "PM Sample Central", "Clinical Genomics, SciLifeLab",
            "Genomics Express", "Clinical Proteomics, SciLifeLab"} == labs
    performed_at = {nodes[e["b"]]["label"] for e in body["edges"] if e["type"] == "performed_at"}
    assert {"Pathology, Karolinska", "PM Sample Central"} <= performed_at
    for edge in body["edges"]:
        if edge["type"] == "performed_at":
            assert nodes[edge["a"]]["type"] == "activity"
            assert nodes[edge["b"]]["type"] == "lab"


def test_the_journey_ends_in_the_tumour_board_portal():
    """The order in the portal is the last thing recorded, so the portal is the
    endpoint: an information system, with no separate node for the board."""
    body = client.get("/api/graph").json()
    nodes = body["nodes"]
    portal = next(n for n in nodes if n["label"] == "Molecular Tumor Board Portal")
    assert portal["type"] == "system" and portal["endpoint"] is True
    assert body["portal"] == portal["id"]
    assert "mtb" not in {n["type"] for n in nodes}
    ordered = [e for e in body["edges"] if e["type"] == "ordered_in"]
    assert ordered and all(e["b"] == portal["id"] for e in ordered)
    # every specimen that reached the portal carries the date of its order
    assert all(nodes[e["a"]]["type"] == "sample" and nodes[e["a"]].get("ordered_on")
               for e in ordered)


def test_identifiers_are_linked_only_to_the_systems_a_source_names():
    """REDCap, Sympathy and Labware issue the study ID, the PAD number and the
    biobank barcode. No source names the system behind the PMSC IDs, so those
    identifiers must carry no issuing system rather than a guessed one."""
    body = client.get("/api/graph").json()
    nodes = body["nodes"]
    issuer: dict[str, set[str]] = {}
    for edge in body["edges"]:
        if edge["type"] == "issued_by":
            issuer.setdefault(nodes[edge["a"]]["scheme"], set()).add(nodes[edge["b"]]["label"])
    assert issuer == {"eCRF study ID": {"REDCap"}, "PAD (pathology)": {"Sympathy"},
                      "biobank tube barcode": {"Labware"}}
    pmsc = [n for n in nodes if n["type"] == "identifier" and n["scheme"].startswith("PMSC")]
    assert pmsc and all(n["issued_by"] is None for n in pmsc)


def test_search_finds_a_specimen_by_any_captured_id():
    value = client.get("/api/specimens/1").json()["id_chain"][1]["value"]
    hits = client.get(f"/api/search?q={value}").json()["hits"]
    assert hits and hits[0]["specimen_id"] == 1

"""Dataset verification, end-to-end run, reproducibility and the decision rule."""

import json

import pytest

from bgforecast.dataset import DatasetError, load_dataset, write_dataset
from bgforecast.pipeline import recommend, run
from bgforecast.synthetic import generate


def test_dataset_hash_mismatch_is_refused(tmp_path):
    generate(tmp_path, seed=3, leagues=1, teams_per_league=6)
    with open(tmp_path / "fixtures.jsonl", "a") as f:
        f.write("\n")
    with pytest.raises(DatasetError, match="hash"):
        load_dataset(tmp_path)


def test_unknown_schema_is_refused(tmp_path):
    write_dataset(tmp_path, {"schema_version": "bg-research-dataset/999"}, [], [])
    with pytest.raises(DatasetError, match="unsupported schema"):
        load_dataset(tmp_path)


def test_duplicate_fixture_ids_are_refused(tmp_path):
    f = {"fixture_id": 1, "status": "excluded"}
    write_dataset(tmp_path, {"schema_version": "bg-research-dataset/1"}, [f, dict(f)], [])
    with pytest.raises(DatasetError, match="more than once"):
        load_dataset(tmp_path)


def test_synthetic_generation_is_deterministic(tmp_path):
    generate(tmp_path / "a", seed=5, leagues=1, teams_per_league=8)
    generate(tmp_path / "b", seed=5, leagues=1, teams_per_league=8)
    for name in ("fixtures.jsonl", "observations.jsonl"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


@pytest.fixture(scope="module")
def runs(synthetic_dir, tmp_path_factory):
    a = run(synthetic_dir, tmp_path_factory.mktemp("run_a"), quick=True)
    b = run(synthetic_dir, tmp_path_factory.mktemp("run_b"), quick=True)
    return a, b


def _strip(r):
    r = json.loads(json.dumps(r, default=str))
    r.pop("resources", None)
    r["artifact"].pop("path", None)
    return r


def test_end_to_end_run_is_evaluated_and_flagged_synthetic(runs):
    r, _ = runs
    assert r["status"] == "evaluated"
    assert r["dataset"]["source"] == "synthetic"
    report = open(r["artifact"]["path"].replace("/model", "/report.md")).read()
    assert report.splitlines()[2].startswith("> **SYNTHETIC DATA — NOT A REAL-WORLD RESULT.**")
    assert "No real-world training or evaluation has occurred" in report


def test_probabilities_and_scores_are_sane(runs):
    r, _ = runs
    for k in ("base_rate", "poisson", "xgb_raw", "xgb_calibrated"):
        m = r["test"][k]
        assert sum(m["calibration"]["mean_p"]) == pytest.approx(1.0, abs=1e-6)
        assert 0 < m["log_loss"]["mean"] < 2 and m["log_loss"]["lo"] <= m["log_loss"]["mean"] <= m["log_loss"]["hi"]


def test_partitions_reported_disjoint(runs):
    r, _ = runs
    s = r["splits"]["final"]
    assert s["train"]["kickoff_max"] < s["eval"]["kickoff_min"]


def test_whole_pipeline_is_reproducible(runs):
    a, b = runs
    assert _strip(a) == _strip(b)


def test_insufficient_data_trains_nothing(tmp_path):
    generate(tmp_path / "d", seed=2, leagues=1, teams_per_league=6)
    r = run(tmp_path / "d", tmp_path / "o", quick=True)
    assert r["status"].startswith("insufficient data") and "test" not in r
    assert r["recommendation"]["decision"] == "improve data"
    assert not (tmp_path / "o" / "model").exists()


def _results(n=500, d_pois=(-0.03, -0.05, -0.01), d_base=(-0.04, -0.06, -0.02), ece=0.03, cov=90.0):
    ci = lambda t: {"mean": t[0], "lo": t[1], "hi": t[2], "n": n}
    return {"status": "evaluated", "coverage": {"features_all": {"both_history_pct": cov}},
            "test": {"xgb_calibrated": {"n": n, "calibration": {"top_label_ece": ece}},
                     "paired": {"xgb_calibrated_minus_poisson": {"log_loss": ci(d_pois)}, "xgb_calibrated_minus_base_rate": {"log_loss": ci(d_base)}}}}


class TestDecisionRule:
    def test_proceed_needs_everything(self):
        assert recommend(_results())["decision"] == "proceed"

    def test_small_test_period_cannot_proceed(self):
        assert recommend(_results(n=200))["decision"] == "improve data"

    def test_not_beating_poisson_is_not_proceed(self):
        assert recommend(_results(d_pois=(-0.01, -0.03, 0.01)))["decision"] == "improve data"

    def test_poor_calibration_is_not_proceed(self):
        assert recommend(_results(ece=0.09))["decision"] == "improve data"

    def test_no_signal_with_adequate_data_is_stop(self):
        assert recommend(_results(d_pois=(0.01, -0.01, 0.03), d_base=(0.01, -0.01, 0.03)))["decision"] == "stop"

    def test_no_signal_with_thin_coverage_is_improve_data(self):
        assert recommend(_results(d_pois=(0.01, -0.01, 0.03), d_base=(0.01, -0.01, 0.03), cov=40.0))["decision"] == "improve data"

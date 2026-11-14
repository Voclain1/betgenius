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
    a = run(synthetic_dir, tmp_path_factory.mktemp("run_a"), quick=True, boundary_fractions=(0.3,))
    b = run(synthetic_dir, tmp_path_factory.mktemp("run_b"), quick=True, boundary_fractions=(0.3,))
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


def _results(n=500, d_pois=(-0.03, -0.05, -0.01), d_base=(-0.04, -0.06, -0.02), ece=0.03, cov=90.0, cov_test=90.0):
    ci = lambda t: {"mean": t[0], "lo": t[1], "hi": t[2], "n": n}
    coverage = {"features_all": {"both_history_pct": cov}}
    if cov_test is not None:
        coverage["features_test"] = {"both_history_pct": cov_test}
    return {"status": "evaluated", "coverage": coverage,
            "test": {"xgb_calibrated": {"n": n, "calibration": {"top_label_ece": ece}},
                     "paired": {"xgb_calibrated_minus_poisson": {"log_loss": ci(d_pois)}, "xgb_calibrated_minus_base_rate": {"log_loss": ci(d_base)}}}}


def _failed(rec):
    return {g["gate"] for g in rec["gates"] if not g["passed"]}


class TestDecisionRule:
    def test_proceed_needs_everything(self):
        rec = recommend(_results())
        assert rec["decision"] == "proceed" and not _failed(rec) and len(rec["gates"]) == 8

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


class TestCoverageGate:
    """Regression for the defect found in review: low coverage with otherwise excellent results returned "proceed"."""

    def test_low_overall_coverage_blocks_proceed_even_with_excellent_results(self):
        rec = recommend(_results(n=2000, d_pois=(-0.08, -0.10, -0.06), d_base=(-0.12, -0.14, -0.10), ece=0.01, cov=69.9))
        assert rec["decision"] != "proceed"
        assert _failed(rec) == {"coverage_all"}

    def test_low_test_period_coverage_blocks_proceed_when_overall_is_fine(self):
        rec = recommend(_results(n=2000, d_pois=(-0.08, -0.10, -0.06), d_base=(-0.12, -0.14, -0.10), ece=0.01, cov=95.0, cov_test=55.0))
        assert rec["decision"] != "proceed"
        assert _failed(rec) == {"coverage_test"}

    def test_missing_test_coverage_fails_closed(self):
        rec = recommend(_results(cov_test=None))
        assert rec["decision"] != "proceed" and "coverage_test" in _failed(rec)

    def test_nan_coverage_fails_closed(self):
        assert recommend(_results(cov=float("nan")))["decision"] != "proceed"

    def test_low_coverage_without_signal_is_improve_data_not_stop(self):
        # A "stop" verdict needs adequate coverage; thin data cannot condemn the model either.
        assert recommend(_results(d_pois=(0.01, -0.01, 0.03), d_base=(0.01, -0.01, 0.03), cov_test=50.0))["decision"] == "improve data"

    def test_threshold_is_inclusive(self):
        assert recommend(_results(cov=70.0, cov_test=70.0))["decision"] == "proceed"


class TestPracticalMargin:
    def test_significant_but_negligible_gain_over_poisson_is_not_proceed(self):
        rec = recommend(_results(n=5000, d_pois=(-0.003, -0.005, -0.001)))
        assert rec["decision"] != "proceed" and _failed(rec) == {"beats_poisson_margin"}

    def test_margin_threshold_is_inclusive(self):
        assert recommend(_results(d_pois=(-0.005, -0.009, -0.001)))["decision"] == "proceed"

    def test_confidence_interval_is_still_required(self):
        rec = recommend(_results(d_pois=(-0.02, -0.05, 0.01)))
        assert rec["decision"] != "proceed" and _failed(rec) == {"beats_poisson_ci"}

    def test_margin_applies_to_base_rate_too(self):
        rec = recommend(_results(d_base=(-0.004, -0.006, -0.002)))
        assert rec["decision"] != "proceed" and "beats_base_margin" in _failed(rec)

    def test_missing_calibration_fails_closed(self):
        r = _results()
        r["test"]["xgb_calibrated"]["calibration"] = {}
        assert recommend(r)["decision"] != "proceed"


def test_proceed_implies_every_gate_passes_exhaustively():
    import itertools
    values = itertools.product([200, 300, 1000], [69.9, 70.0, 90.0], [None, 50.0, 70.0, 90.0],
                               [(-0.004, -0.006, -0.001), (-0.01, -0.02, 0.001), (-0.02, -0.03, -0.01)],
                               [(-0.004, -0.006, -0.001), (-0.03, -0.04, -0.02)], [0.03, 0.051])
    proceeds = 0
    for n, cov, cov_test, dp, db, e in values:
        rec = recommend(_results(n=n, cov=cov, cov_test=cov_test, d_pois=dp, d_base=db, ece=e))
        if rec["decision"] == "proceed":
            proceeds += 1
            assert n >= 300 and cov >= 70 and cov_test is not None and cov_test >= 70
            assert dp[2] < 0 and dp[0] <= -0.005 and db[2] < 0 and db[0] <= -0.005 and e <= 0.05
    assert proceeds > 0


def test_recommendation_ignores_sensitivity_results():
    base = recommend(_results())
    for alt in ({"boundaries": [{"status": "evaluated", "xgb_minus_poisson": {"mean": 0.5, "lo": 0.4, "hi": 0.6}}]},
                {"boundaries": [{"status": "evaluated", "xgb_minus_poisson": {"mean": -0.5, "lo": -0.6, "hi": -0.4}}]}):
        r = _results()
        r["boundary_sensitivity"] = alt
        r["sensitivity"] = {"xgb_calibrated_log_loss": 0.1}
        assert recommend(r) == base
    weak = _results(cov_test=40.0)
    weak["boundary_sensitivity"] = {"boundaries": [{"status": "evaluated", "coverage_test_both_history_pct": 99.0}]}
    assert recommend(weak)["decision"] != "proceed"


def test_boundary_sensitivity_never_touches_the_final_model(synthetic_dir, tmp_path):
    with_bs = run(synthetic_dir, tmp_path / "with", quick=True, boundary_sensitivity=True, boundary_fractions=(0.15, 0.3))
    without = run(synthetic_dir, tmp_path / "without", quick=True, boundary_sensitivity=False)
    assert with_bs["artifact"]["model_sha256"] == without["artifact"]["model_sha256"]
    assert json.dumps(with_bs["test"], sort_keys=True, default=str) == json.dumps(without["test"], sort_keys=True, default=str)
    assert with_bs["recommendation"] == without["recommendation"]
    rows = with_bs["boundary_sensitivity"]["boundaries"]
    assert [x["test_fraction"] for x in rows] == [0.15, 0.3]
    assert all(x["status"] == "evaluated" for x in rows)
    assert len({x["n_test"] for x in rows} | {with_bs["test"]["xgb_calibrated"]["n"]}) == 3
    assert "boundary_sensitivity" not in without
    report = (tmp_path / "with" / "report.md").read_text()
    assert "alternative test boundaries (reporting only)" in report and "Pre-registered gates" in report


def test_end_to_end_low_coverage_cannot_proceed(synthetic_dir, tmp_path):
    """No observations at all: zero history coverage. The pipeline still evaluates, but the gates must block proceed."""
    from bgforecast.dataset import load_dataset as _load
    ds = _load(synthetic_dir)
    write_dataset(tmp_path / "bare", ds.manifest, ds.fixtures, [])
    r = run(tmp_path / "bare", tmp_path / "out", quick=True, boundary_sensitivity=False)
    assert r["coverage"]["features_all"]["both_history_pct"] == 0.0
    assert r["recommendation"]["decision"] != "proceed"
    assert {"coverage_all", "coverage_test"} <= _failed(r["recommendation"])


def test_overridden_test_fraction_is_flagged(synthetic_dir, tmp_path):
    r = run(synthetic_dir, tmp_path / "o", quick=True, boundary_sensitivity=False, test_fraction=0.25)
    assert r["protocol"]["test_fraction_overridden"] is True
    assert "Protocol deviation" in (tmp_path / "o" / "report.md").read_text()

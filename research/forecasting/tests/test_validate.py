"""Dataset validation: every hard check fires on a planted defect, and the pipeline refuses to train on it."""

import copy

import pytest

from bgforecast.dataset import load_dataset, write_dataset
from bgforecast.pipeline import run
from bgforecast.validate import validate_dataset


@pytest.fixture(scope="module")
def ds(synthetic_dir):
    return load_dataset(synthetic_dir)


def _tampered(ds, tmp_path, fix=None, obs=None, manifest=None):
    fixtures, observations, m = copy.deepcopy(ds.fixtures), copy.deepcopy(ds.observations), copy.deepcopy(ds.manifest)
    if fix:
        fix(fixtures)
    if obs:
        obs(observations)
    if manifest:
        manifest(m)
    write_dataset(tmp_path / "t", m, fixtures, observations)
    return load_dataset(tmp_path / "t")


def _failed(res):
    return {c["check"] for c in res["checks"] if not c["passed"] and c["severity"] == "error"}


def _first_included(fixtures):
    return next(f for f in fixtures if f["status"] == "included")


def test_synthetic_dataset_is_valid(ds):
    res = validate_dataset(ds)
    assert res["valid"] and res["errors"] == 0
    assert any(c["check"] == "source" and c["severity"] == "warning" for c in res["checks"])


def test_require_real_rejects_synthetic(ds):
    res = validate_dataset(ds, require_real=True)
    assert not res["valid"] and _failed(res) == {"source"}


def test_generation_at_kickoff_is_caught(ds, tmp_path):
    def f(fx):
        x = _first_included(fx)
        x["generation"]["created_at"] = x["kickoff"]
    assert "included_fixture_integrity" in _failed(validate_dataset(_tampered(ds, tmp_path, fix=f)))


def test_settlement_before_kickoff_is_caught(ds, tmp_path):
    def f(fx):
        x = _first_included(fx)
        x["settled_at"] = x["generation"]["created_at"]
    res = validate_dataset(_tampered(ds, tmp_path, fix=f))
    assert "included_fixture_integrity" in _failed(res)
    assert "settlement_not_after_kickoff" in next(c["detail"] for c in res["checks"] if c["check"] == "included_fixture_integrity")


def test_engine_prediction_after_kickoff_is_caught(ds, tmp_path):
    def f(fx):
        x = next(f for f in fx if f["status"] == "included" and f["engine_predictions"])
        x["engine_predictions"][0]["created_at"] = x["settled_at"]
    assert "included_fixture_integrity" in _failed(validate_dataset(_tampered(ds, tmp_path, fix=f)))


def test_observation_after_as_of_is_caught(ds, tmp_path):
    def o(obs):
        obs[0]["observed_at"] = "2099-01-01T00:00:00.000Z"
    assert "observation_integrity" in _failed(validate_dataset(_tampered(ds, tmp_path, obs=o)))


def test_excluded_without_reason_is_caught(ds, tmp_path):
    def f(fx):
        next(x for x in fx if x["status"] == "excluded")["exclusion_reasons"] = []
    assert "excluded_have_reasons" in _failed(validate_dataset(_tampered(ds, tmp_path, fix=f)))


def test_count_mismatch_is_caught(ds, tmp_path):
    def m(man):
        man["counts"]["fixtures_included"] += 1
    assert "counts_reconcile" in _failed(validate_dataset(_tampered(ds, tmp_path, manifest=m)))


def test_real_extraction_must_be_from_a_verified_read_only_snapshot(ds, tmp_path):
    def m(man):
        man["source"] = "postgres"
        man["database"] = {"read_only_verified": False, "isolation": "read committed"}
    res = validate_dataset(_tampered(ds, tmp_path, manifest=m), require_real=True)
    assert _failed(res) == {"read_only_snapshot"}


def test_audit_comparison_is_informational(ds):
    res = validate_dataset(ds)
    assert res["audit_comparison"] and all("audit_reference" in a for a in res["audit_comparison"])


def test_pipeline_refuses_to_train_on_an_invalid_dataset(ds, tmp_path):
    def f(fx):
        x = _first_included(fx)
        x["generation"]["created_at"] = x["kickoff"]
    _tampered(ds, tmp_path, fix=f)
    r = run(tmp_path / "t", tmp_path / "out", quick=True, boundary_sensitivity=False)
    assert r["status"].startswith("invalid dataset") and "test" not in r
    assert r["recommendation"]["decision"] == "improve data"
    assert not (tmp_path / "out" / "model").exists()
    assert "Dataset validation: **FAILED**" in (tmp_path / "out" / "report.md").read_text()


def test_pipeline_require_real_refuses_synthetic(synthetic_dir, tmp_path):
    r = run(synthetic_dir, tmp_path / "o", quick=True, boundary_sensitivity=False, require_real=True)
    assert r["status"].startswith("invalid dataset") and "source" in r["status"]

"""Feature extraction: determinism, leakage invariance, smoothing, missing data, identifiers."""

import copy

import numpy as np
import pytest

from bgforecast.dataset import load_dataset
from bgforecast.features import FeatureConfig, build_feature_table, feature_columns, fixture_features
from bgforecast.ledger import Ledger, parse_ts
from conftest import obs


def _fixture(fid=999, home=1, away=2, gen="2026-03-20T10:00:00.000Z", ko="2026-03-20T15:00:00.000Z", hg=2, ag=1, league=10):
    return {"fixture_id": fid, "status": "included", "league_id": league, "league_name": "L", "home_id": home, "away_id": away,
            "kickoff": ko, "home_goals": hg, "away_goals": ag, "generation": {"created_at": gen, "context_version": 2}, "engine_predictions": []}


def test_feature_table_is_deterministic(synthetic_dir):
    ds = load_dataset(synthetic_dir)
    a, _ = build_feature_table(ds.fixtures, Ledger(ds.observations))
    b, _ = build_feature_table(list(reversed(ds.fixtures)), Ledger(list(reversed(ds.observations))))
    assert a.equals(b)


def test_features_are_invariant_to_anything_unavailable_at_generation(synthetic_dir):
    """The core leakage test: rewrite every result a fixture could not have known; its features must not move.

    Tampering is per MATCH, applied consistently to every sighting of it, so it cannot create score
    conflicts that would remove available history and make the comparison vacuous.
    """
    ds = load_dataset(synthetic_dir)
    led = Ledger(ds.observations)
    included = [f for f in ds.fixtures if f["status"] == "included"]
    compared = changed_matches = 0
    for f in included[100:130]:
        T = parse_ts(f["generation"]["created_at"])
        base, _ = fixture_features(f, led, FeatureConfig())
        unknowable = {(m.date, m.home_id, m.away_id) for m in led.matches if m.available_at("strict") > T}
        unknowable.add((f["kickoff"][:10], f["home_id"], f["away_id"]))  # the target itself
        tampered = []
        for o in ds.observations:
            o2 = copy.deepcopy(o)
            if (o["date"], o["home_id"], o["away_id"]) in unknowable and o2["home_goals"] is not None:
                o2["home_goals"], o2["away_goals"] = 9, 9
                changed_matches += 1
            tampered.append(o2)
        led2 = Ledger(tampered)
        assert not led2.match_rejections.get("score_conflict")
        after, _ = fixture_features(f, led2, FeatureConfig())
        assert after == base, f"fixture {f['fixture_id']} features changed after tampering with unavailable results"
        compared += 1
    assert compared == 30 and changed_matches > 1000


def test_the_target_result_never_reaches_its_own_features():
    f = _fixture()
    hist = [obs(date="2026-03-01", observed_at="2026-03-03T00:00:00Z", hg=1, ag=1)]
    own = obs(source="settlement", fixture_id=999, date="2026-03-20", kickoff="2026-03-20T15:00:00Z", observed_at="2026-03-20T18:00:00Z", hg=7, ag=0)
    a, _ = fixture_features(f, Ledger(hist, "completion"), FeatureConfig())
    b, diag = fixture_features(f, Ledger(hist + [own], "completion"), FeatureConfig())
    assert a == b and diag.get("target_fixture_present_in_ledger_withheld") == 2


def test_positive_control_available_results_do_change_features():
    f = _fixture()
    a, _ = fixture_features(f, Ledger([obs(date="2026-03-01", observed_at="2026-03-03T00:00:00Z", hg=0, ag=0)]), FeatureConfig())
    b, _ = fixture_features(f, Ledger([obs(date="2026-03-01", observed_at="2026-03-03T00:00:00Z", hg=5, ag=0)]), FeatureConfig())
    assert b["home_gf_pg"] > a["home_gf_pg"]


def test_no_history_gives_priors_and_missing_indicators():
    row, _ = fixture_features(_fixture(), Ledger([]), FeatureConfig())
    assert row["home_n"] == 0 and row["home_no_history"] == 1 and row["away_no_history"] == 1
    assert np.isnan(row["home_rest_days"]) and row["home_rest_missing"] == 1
    assert row["global_prior_conventional"] == 1
    assert row["home_gf_pg"] == pytest.approx((1.45 + 1.15) / 2)
    assert row["h2h_n"] == 0 and row["h2h_gd_pg"] == 0.0


def test_smoothing_shrinks_small_samples():
    # Another competition, so the league prior stays at the (conventional) global prior and only team shrinkage is tested.
    hist = [obs(date="2026-03-01", observed_at="2026-03-03T00:00:00Z", hg=5, ag=0, competition_id=77)]
    row, _ = fixture_features(_fixture(), Ledger(hist), FeatureConfig(team_k=4))
    prior = (1.45 + 1.15) / 2
    assert row["home_gf_pg"] == pytest.approx((5 + 4 * prior) / 5)
    assert row["home_n"] == 1 and row["home_venue_n"] == 1


def test_rest_days_from_latest_available_match():
    hist = [obs(date="2026-03-15", observed_at="2026-03-17T00:00:00Z"), obs(date="2026-03-08", observed_at="2026-03-10T00:00:00Z", home_id=3, away_id=1)]
    row, _ = fixture_features(_fixture(), Ledger(hist), FeatureConfig())
    assert row["home_rest_days"] == 5.0


def test_generation_at_or_after_kickoff_is_refused():
    with pytest.raises(ValueError):
        fixture_features(_fixture(gen="2026-03-20T15:00:00.000Z"), Ledger([]), FeatureConfig())


def test_identifiers_are_categorical_not_magnitudes(synthetic_dir):
    from bgforecast import xgb_model
    ds = load_dataset(synthetic_dir)
    df, _ = build_feature_table(ds.fixtures, Ledger(ds.observations))
    enc = xgb_model.CategoryEncoder().fit(df)
    X = enc.transform(df[feature_columns(df)])
    for c in ("league_id", "home_id", "away_id"):
        assert str(X[c].dtype) == "category"
    # An id never seen in training maps to "other", not to a number near its neighbours.
    probe = df.head(1).copy()
    probe["home_id"] = 123456789
    assert enc.transform(probe)["home_id"].iloc[0] == "other"


def test_excluded_fixtures_never_become_rows(synthetic_dir):
    ds = load_dataset(synthetic_dir)
    df, _ = build_feature_table(ds.fixtures, Ledger(ds.observations))
    excluded = {f["fixture_id"] for f in ds.fixtures if f["status"] != "included"}
    assert excluded and not excluded & set(df["fixture_id"])
    assert df["fixture_id"].is_unique

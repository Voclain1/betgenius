"""Model probability validity, calibration and reproducibility."""

import math

import numpy as np
import pytest

from bgforecast import xgb_model
from bgforecast.calibration import apply_temperature, fit_temperature
from bgforecast.dataset import load_dataset
from bgforecast.features import build_feature_table, feature_columns
from bgforecast.ledger import Ledger
from bgforecast.poisson import expected_goals, market_probabilities


class TestPoisson:
    @pytest.mark.parametrize("lh,la", [(0.2, 0.2), (1.4, 1.1), (3.0, 0.5), (0.5, 3.0), (5.0, 5.0)])
    def test_probabilities_are_valid(self, lh, la):
        p = market_probabilities(lh, la)
        assert p["p_home"] + p["p_draw"] + p["p_away"] == pytest.approx(1.0)
        assert all(0 <= v <= 1 for v in p.values())

    def test_symmetry_and_monotonicity(self):
        p = market_probabilities(1.3, 1.3)
        assert p["p_home"] == pytest.approx(p["p_away"])
        assert market_probabilities(2.0, 1.0)["p_home"] > market_probabilities(1.5, 1.0)["p_home"]

    def test_goals_markets_match_closed_forms(self):
        lh, la = 1.2, 0.9
        p = market_probabilities(lh, la)
        lt = lh + la
        under = math.exp(-lt) * (1 + lt + lt * lt / 2)
        assert p["p_over25"] == pytest.approx(1 - under, abs=1e-6)
        assert p["p_btts"] == pytest.approx((1 - math.exp(-lh)) * (1 - math.exp(-la)), abs=1e-6)

    def test_expected_goals_average_teams_get_league_means(self):
        lh, la = expected_goals(1.5, 1.1, 1.3, 1.3, 1.3, 1.3)
        assert lh == pytest.approx(1.5) and la == pytest.approx(1.1)


class TestTemperature:
    def test_identity_at_one(self):
        P = np.array([[0.6, 0.3, 0.1], [0.2, 0.5, 0.3]])
        assert np.allclose(apply_temperature(P, 1.0), P)

    def test_overconfident_forecasts_get_softened(self):
        rng = np.random.default_rng(1)
        y = rng.integers(0, 3, 600)
        P = np.full((600, 3), 0.05)
        P[np.arange(600), rng.integers(0, 3, 600)] = 0.9  # confident and random
        assert fit_temperature(P, y) > 1.5

    def test_ranking_is_preserved(self):
        P = np.array([[0.5, 0.3, 0.2], [0.1, 0.2, 0.7]])
        assert (apply_temperature(P, 2.5).argmax(1) == P.argmax(1)).all()


@pytest.fixture(scope="module")
def frame(synthetic_dir):
    ds = load_dataset(synthetic_dir)
    df, _ = build_feature_table(ds.fixtures, Ledger(ds.observations))
    return ds, df


PARAMS = {"max_depth": 2, "learning_rate": 0.1, "min_child_weight": 5.0, "reg_lambda": 1.0}


def test_xgb_probabilities_are_valid_and_handle_missing(frame):
    _, df = frame
    feats = feature_columns(df)
    b, enc = xgb_model.train_fixed(df, feats, PARAMS, 30)
    probe = df.head(20).copy()
    probe.loc[probe.index[:5], ["home_rest_days", "away_rest_days"]] = np.nan
    P = xgb_model.predict(b, enc, probe, feats)
    assert P.shape == (20, 3) and np.allclose(P.sum(1), 1.0, atol=1e-5) and (P >= 0).all()


def test_xgb_training_is_reproducible(frame, tmp_path):
    ds, df = frame
    feats = feature_columns(df)
    b1, e1 = xgb_model.train_fixed(df, feats, {**PARAMS, "learning_rate": 0.05}, 40)
    b2, e2 = xgb_model.train_fixed(df, feats, {**PARAMS, "learning_rate": 0.05}, 40)
    assert np.array_equal(xgb_model.predict(b1, e1, df, feats), xgb_model.predict(b2, e2, df, feats))
    m1 = xgb_model.save_artifact(tmp_path / "a", b1, e1, feats, PARAMS, 40, 1.1, ds.manifest, {})
    m2 = xgb_model.save_artifact(tmp_path / "b", b2, e2, feats, PARAMS, 40, 1.1, ds.manifest, {})
    assert m1["model_sha256"] == m2["model_sha256"] and m1["version"] == m2["version"]


def test_artifact_roundtrip_and_tamper_detection(frame, tmp_path):
    ds, df = frame
    feats = feature_columns(df)
    b, enc = xgb_model.train_fixed(df, feats, PARAMS, 25)
    meta = xgb_model.save_artifact(tmp_path / "m", b, enc, feats, PARAMS, 25, 1.2, ds.manifest, {})
    assert meta["research_only"] is True and meta["dataset"]["source"] == "synthetic"
    direct = apply_temperature(xgb_model.predict(b, enc, df, feats), 1.2)
    assert np.allclose(xgb_model.predict_calibrated(tmp_path / "m", df), direct)
    (tmp_path / "m" / "model.json").write_text((tmp_path / "m" / "model.json").read_text().replace("0", "1", 1))
    with pytest.raises(ValueError):
        xgb_model.load_artifact(tmp_path / "m")

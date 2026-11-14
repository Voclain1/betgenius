"""Chronological partitions and scoring rules."""

import math

import numpy as np
import pandas as pd
import pytest

from bgforecast.dataset import load_dataset
from bgforecast.features import build_feature_table
from bgforecast.ledger import Ledger
from bgforecast.metrics import bootstrap_mean, brier_rows, ece, logloss_rows, paired_difference
from bgforecast.splits import LABEL_DELAY, Split, assert_partition_integrity, final_split, split_at, walk_forward


@pytest.fixture(scope="module")
def frame(synthetic_dir):
    ds = load_dataset(synthetic_dir)
    df, _ = build_feature_table(ds.fixtures, Ledger(ds.observations))
    return df


def test_final_split_is_disjoint_and_label_safe(frame):
    s = final_split(frame, 0.2)
    assert_partition_integrity(frame, s)
    train, ev = frame.iloc[s.train], frame.iloc[s.eval]
    assert set(train["fixture_id"]).isdisjoint(ev["fixture_id"])
    assert (train["kickoff"] + LABEL_DELAY).max() <= ev["generated_at"].min()
    assert len(s.train) + len(s.eval) + len(s.embargoed) == len(frame)


def test_test_period_is_the_latest(frame):
    s = final_split(frame, 0.2)
    assert frame.iloc[s.eval]["kickoff"].min() > frame.iloc[s.train]["kickoff"].max()


def test_walk_forward_folds_expand_and_stay_inside_development(frame):
    s = final_split(frame, 0.2)
    dev = frame.iloc[s.train].reset_index(drop=True)
    folds = walk_forward(dev, 4)
    assert len(folds) == 4
    sizes = [len(f.train) for f in folds]
    assert sizes == sorted(sizes)
    for f in folds:
        assert_partition_integrity(dev, f)
    bounds = [f.boundary for f in folds]
    assert bounds == sorted(bounds)
    # Eval windows do not overlap.
    evals = [set(dev["fixture_id"].iloc[f.eval]) for f in folds]
    for i in range(len(evals)):
        for j in range(i + 1, len(evals)):
            assert evals[i].isdisjoint(evals[j])


def test_split_is_not_random(frame):
    a, b = final_split(frame, 0.2), final_split(frame.sample(frac=1, random_state=3).sort_values("kickoff").reset_index(drop=True), 0.2)
    assert a.boundary == b.boundary


def test_integrity_check_catches_a_violation(frame):
    s = final_split(frame, 0.2)
    bad = Split(boundary=s.boundary, train=np.append(s.train, s.eval[:1]), eval=s.eval, embargoed=s.embargoed)
    with pytest.raises(AssertionError):
        assert_partition_integrity(frame, bad)


def test_label_embargo_drops_fixtures_straddling_the_boundary():
    t = pd.Timestamp("2026-03-01T12:00:00Z")
    df = pd.DataFrame({"fixture_id": [1, 2, 3],
                       "kickoff": [t - pd.Timedelta(hours=5), t - pd.Timedelta(hours=1), t + pd.Timedelta(hours=10)],
                       "generated_at": [t - pd.Timedelta(hours=30), t - pd.Timedelta(hours=20), t + pd.Timedelta(hours=1)]})
    s = split_at(df, t)
    assert list(s.train) == [0] and list(s.eval) == [2] and list(s.embargoed) == [1]


def test_scoring_rules():
    y = np.array([0, 1, 2])
    U = np.full((3, 3), 1 / 3)
    assert logloss_rows(U, y).mean() == pytest.approx(math.log(3))
    assert brier_rows(np.eye(3), y).sum() == 0
    assert ece(np.array([0.7, 0.7]), np.array([1, 0])) == pytest.approx(0.2)


def test_bootstrap_is_reproducible_and_paired():
    v = np.random.default_rng(0).normal(size=200)
    assert bootstrap_mean(v) == bootstrap_mean(v)
    d = paired_difference(v, v)
    assert d["mean"] == 0 and d["lo"] == 0 and d["hi"] == 0
    g = bootstrap_mean(v, groups=np.repeat(np.arange(100), 2))
    assert g["lo"] <= g["mean"] <= g["hi"]

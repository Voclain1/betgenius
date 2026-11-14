"""Chronological partitions with a label-time embargo.

Every partition is one boundary B in time:

    train : kickoff + LABEL_DELAY <= B   (the result was known by B)
    eval  : generated_at >= B            (the forecast was made at or after B)
    otherwise: embargoed, used by neither side

so every training label existed before every evaluation forecast was made,
and since generated_at < kickoff, no fixture can satisfy both conditions: one
row per fixture means one fixture is never on both sides. Nothing is shuffled.

The final split reserves the latest ``test_fraction`` of fixtures (by kickoff)
as the untouched test period. Hyperparameter selection uses expanding-window
walk-forward folds inside the development period only; calibration is fitted
on the last slice of development, never on test.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

import numpy as np
import pandas as pd

LABEL_DELAY = timedelta(hours=3)


@dataclass(frozen=True)
class Split:
    boundary: pd.Timestamp
    train: np.ndarray
    eval: np.ndarray
    embargoed: np.ndarray


def split_at(df: pd.DataFrame, boundary: pd.Timestamp, eval_until: pd.Timestamp | None = None) -> Split:
    known = (df["kickoff"] + LABEL_DELAY) <= boundary
    forecast = df["generated_at"] >= boundary
    in_scope = df["kickoff"] < eval_until if eval_until is not None else pd.Series(True, index=df.index)
    forecast &= in_scope
    rest = ~known & ~forecast & in_scope
    return Split(boundary=boundary, train=np.flatnonzero(known.to_numpy()), eval=np.flatnonzero(forecast.to_numpy()), embargoed=np.flatnonzero(rest.to_numpy()))


def _kickoff_quantile(df: pd.DataFrame, q: float) -> pd.Timestamp:
    ks = df["kickoff"].sort_values().reset_index(drop=True)
    return ks.iloc[min(len(ks) - 1, max(0, int(np.floor(q * len(ks)))))]


def final_split(df: pd.DataFrame, test_fraction: float = 0.2) -> Split:
    if not 0 < test_fraction < 1:
        raise ValueError("test_fraction must be in (0, 1)")
    return split_at(df, _kickoff_quantile(df, 1 - test_fraction))


def walk_forward(dev: pd.DataFrame, n_folds: int = 4, min_train_fraction: float = 0.4) -> list[Split]:
    """Expanding-window folds over the development frame (indices are positions in `dev`)."""
    qs = np.linspace(min_train_fraction, 1.0, n_folds + 1)
    bounds = [_kickoff_quantile(dev, q) for q in qs[:-1]] + [None]
    folds = []
    for b, nxt in zip(bounds[:-1], bounds[1:]):
        folds.append(split_at(dev, b, eval_until=nxt))
    return [f for f in folds if len(f.train) and len(f.eval)]


def describe(df: pd.DataFrame, s: Split) -> dict:
    def span(ix):
        if not len(ix):
            return {"n": 0}
        k = df["kickoff"].iloc[ix]
        return {"n": int(len(ix)), "kickoff_min": k.min().isoformat(), "kickoff_max": k.max().isoformat()}
    return {"boundary": s.boundary.isoformat(), "train": span(s.train), "eval": span(s.eval), "embargoed": int(len(s.embargoed))}


def assert_partition_integrity(df: pd.DataFrame, s: Split) -> None:
    """Raise if any fixture is on both sides or any training label post-dates an evaluation forecast."""
    tr, ev = set(df["fixture_id"].iloc[s.train]), set(df["fixture_id"].iloc[s.eval])
    if tr & ev:
        raise AssertionError(f"{len(tr & ev)} fixture(s) in both partitions")
    if len(s.train) and len(s.eval):
        latest_label = (df["kickoff"].iloc[s.train] + LABEL_DELAY).max()
        earliest_forecast = df["generated_at"].iloc[s.eval].min()
        if latest_label > earliest_forecast:
            raise AssertionError("a training label post-dates an evaluation forecast")

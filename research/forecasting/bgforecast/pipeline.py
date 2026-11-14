"""End-to-end research run: dataset -> ledger -> features -> splits -> models -> evaluation -> report.

Everything this writes goes under ``out_dir`` (gitignored by default). Nothing
is published, nothing touches a database, and the model artifact is marked
research_only.
"""

from __future__ import annotations

import json
import os
import platform
import resource
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from .calibration import apply_temperature, fit_temperature
from .dataset import load_dataset
from .engine_compare import compare as engine_compare
from .features import FeatureConfig, build_feature_table, completeness, feature_columns
from .ledger import Ledger
from .metrics import (binary_brier_rows, binary_logloss_rows, brier_rows, logloss_rows, paired_difference, score_1x2,
                      score_binary)
from .poisson import predict_frame
from .validate import validate_dataset
from .splits import assert_partition_integrity, describe, final_split, split_at, walk_forward, _kickoff_quantile
from . import xgb_model

MIN_FIXTURES = 300          # below this, no models are trained at all
MIN_LEAGUE_N = 30
QUICK_GRID = [{"max_depth": 3, "learning_rate": 0.08, "min_child_weight": 5.0, "reg_lambda": 1.0},
              {"max_depth": 2, "learning_rate": 0.08, "min_child_weight": 20.0, "reg_lambda": 10.0}]

# ── Pre-registered decision rule ────────────────────────────────────────────
# Fixed before any real data is seen; documented in
# docs/research/XGBOOST_RESEARCH_ENGINE.md section 9. Changing a constant after
# looking at a real result invalidates that result.
PRIMARY_TEST_FRACTION = 0.2
MIN_TEST = 300              # fixtures in the untouched test period
COVERAGE_MIN = 70.0         # % of fixtures with history for both teams — on the whole dataset AND on the test period
MIN_LOGLOSS_GAIN = 0.005    # nats per match: the smallest improvement worth a shadow deployment (see docs)
ECE_MAX = 0.05              # top-label expected calibration error
BOUNDARY_SENSITIVITY_FRACTIONS = (0.15, 0.25, 0.30)


def _gate(name: str, passed: bool, detail: str) -> dict:
    return {"gate": name, "passed": bool(passed), "detail": detail}


def _num(x, default=float("nan")) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return v


def decision_gates(r: dict) -> list[dict]:
    """Every gate the primary test-period result must pass for "proceed". Missing values fail (fail closed)."""
    t = r.get("test") or {}
    n = int(_num((t.get("xgb_calibrated") or {}).get("n"), 0))
    paired = t.get("paired") or {}
    d_pois = (paired.get("xgb_calibrated_minus_poisson") or {}).get("log_loss") or {}
    d_base = (paired.get("xgb_calibrated_minus_base_rate") or {}).get("log_loss") or {}
    ece_ = _num(((t.get("xgb_calibrated") or {}).get("calibration") or {}).get("top_label_ece"))
    cov = r.get("coverage") or {}
    cov_all = _num((cov.get("features_all") or {}).get("both_history_pct"))
    cov_test = _num((cov.get("features_test") or {}).get("both_history_pct"))
    # NaN compares False, so an absent figure can never pass a gate.
    return [
        _gate("test_size", n >= MIN_TEST, f"{n} test fixtures (need >= {MIN_TEST})"),
        _gate("coverage_all", cov_all >= COVERAGE_MIN, f"{cov_all:.1f}% of all fixtures have history for both teams (need >= {COVERAGE_MIN:.0f}%)"),
        _gate("coverage_test", cov_test >= COVERAGE_MIN, f"{cov_test:.1f}% of test fixtures have history for both teams (need >= {COVERAGE_MIN:.0f}%)"),
        _gate("beats_poisson_ci", _num(d_pois.get("hi")) < 0, f"XGB − Poisson log loss 95% CI upper bound {_num(d_pois.get('hi')):+.4f} (need < 0)"),
        _gate("beats_poisson_margin", _num(d_pois.get("mean")) <= -MIN_LOGLOSS_GAIN, f"XGB − Poisson log loss {_num(d_pois.get('mean')):+.4f} (need <= {-MIN_LOGLOSS_GAIN:+.4f})"),
        _gate("beats_base_ci", _num(d_base.get("hi")) < 0, f"XGB − base rate log loss 95% CI upper bound {_num(d_base.get('hi')):+.4f} (need < 0)"),
        _gate("beats_base_margin", _num(d_base.get("mean")) <= -MIN_LOGLOSS_GAIN, f"XGB − base rate log loss {_num(d_base.get('mean')):+.4f} (need <= {-MIN_LOGLOSS_GAIN:+.4f})"),
        _gate("calibration", ece_ <= ECE_MAX, f"top-label ECE {ece_:.3f} (need <= {ECE_MAX})"),
    ]


ADEQUACY = ("test_size", "coverage_all", "coverage_test")


def recommend(r: dict) -> dict:
    """Apply the pre-registered rule to the PRIMARY result. Pure, so it is tested directly.

    Reads only r["status"], r["test"] and r["coverage"]. Boundary-sensitivity and
    ledger-mode sensitivity results are never consulted, so an alternative split
    cannot rescue or select a result.

      proceed       every gate passes (adequate data and coverage, CI and practical
                    margin against BOTH Poisson and the base rate, calibration)
      stop          data and coverage are adequate, but XGBoost does not beat the base rate
      improve data  anything else, with every failing gate listed
    """
    if r.get("status") != "evaluated":
        return {"decision": "improve data", "reasons": [r.get("status", "not evaluated")], "gates": []}
    gates = decision_gates(r)
    failed = [g for g in gates if not g["passed"]]
    if not failed:
        return {"decision": "proceed", "gates": gates, "reasons": [
            f"every pre-registered gate passed: XGBoost beats Poisson and the base rate on untouched test log loss by at least {MIN_LOGLOSS_GAIN} nats with 95% paired CIs below zero, on adequate data and coverage, with acceptable calibration",
            "proceed means a shadow-mode evaluation against live generation, never direct publication"]}
    by = {g["gate"]: g for g in gates}
    adequate = all(by[k]["passed"] for k in ADEQUACY)
    if adequate and not by["beats_base_ci"]["passed"]:
        return {"decision": "stop", "gates": gates, "reasons": ["XGBoost does not beat the base rate on the test period, with adequate data and coverage"]
                + [g["detail"] for g in failed]}
    reasons = [g["detail"] for g in failed]
    if by["beats_base_ci"]["passed"] and not (by["beats_poisson_ci"]["passed"] and by["beats_poisson_margin"]["passed"]):
        reasons.append("XGBoost beats the base rate but not the Poisson baseline by the required margin: the gain is not attributable to XGBoost")
    return {"decision": "improve data", "gates": gates, "reasons": reasons}


def _base_rate(y: np.ndarray, n: int) -> np.ndarray:
    freq = np.bincount(y, minlength=3).astype(float) + 1.0  # add-one so no class is ever 0
    return np.tile(freq / freq.sum(), (n, 1))


def _poisson(df: pd.DataFrame) -> np.ndarray:
    return predict_frame(df["pois_lambda_home"].to_numpy(), df["pois_lambda_away"].to_numpy())


def _peak_rss_mib() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0  # Linux reports KiB


def _score_suite(P: dict, y: np.ndarray) -> dict:
    return {name: score_1x2(p, y) for name, p in P.items()}


def _paired(P: dict, y: np.ndarray, a: str, b: str) -> dict:
    return {"log_loss": paired_difference(logloss_rows(P[a], y), logloss_rows(P[b], y)),
            "brier": paired_difference(brier_rows(P[a], y), brier_rows(P[b], y))}


def _fit_and_score(df: pd.DataFrame, test_fraction: float, n_folds: int, cal_fraction: float, quick: bool) -> dict:
    """Split, tune on walk-forward folds inside development, fit, calibrate and score the test period.

    Self-contained: everything is derived from `df` and `test_fraction` alone, so
    each boundary in the sensitivity analysis is tuned and calibrated
    independently, and nothing from one boundary reaches another.
    """
    final = final_split(df, test_fraction)
    assert_partition_integrity(df, final)
    dev = df.iloc[final.train].reset_index(drop=True)
    test = df.iloc[final.eval].reset_index(drop=True)
    folds = walk_forward(dev, n_folds)
    for f in folds:
        assert_partition_integrity(dev, f)
    cal = split_at(dev, _kickoff_quantile(dev, 1 - cal_fraction))
    assert_partition_integrity(dev, cal)
    dev_fit, dev_cal = dev.iloc[cal.train], dev.iloc[cal.eval]
    features = feature_columns(df)

    tuned = xgb_model.tune(dev, folds, features, QUICK_GRID if quick else None)
    params, rounds = tuned["best_params"], max(10, tuned["rounds"])
    booster, enc = xgb_model.train_fixed(dev_fit, features, params, rounds)
    T = fit_temperature(xgb_model.predict(booster, enc, dev_cal, features), dev_cal["y"].to_numpy())

    pois_test = _poisson(test)
    xgb_raw = xgb_model.predict(booster, enc, test, features)
    P = {"base_rate": _base_rate(dev["y"].to_numpy(), len(test)), "poisson": pois_test[:, :3], "xgb_raw": xgb_raw,
         "xgb_calibrated": apply_temperature(xgb_raw, T)}
    return {"final": final, "dev": dev, "test": test, "folds": folds, "cal": cal, "dev_fit": dev_fit, "dev_cal": dev_cal,
            "features": features, "tuned": tuned, "params": params, "rounds": rounds, "booster": booster, "enc": enc,
            "temperature": T, "P": P, "pois_test": pois_test}


def run(dataset_dir: str | Path, out_dir: str | Path, *, mode: str = "strict", test_fraction: float = PRIMARY_TEST_FRACTION, n_folds: int = 4,
        cal_fraction: float = 0.2, quick: bool = False, sensitivity: bool = False, boundary_sensitivity: bool = True,
        boundary_fractions: tuple = BOUNDARY_SENSITIVITY_FRACTIONS, threads: int | None = None,
        require_real: bool = False, feature_config: FeatureConfig = FeatureConfig()) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if threads is not None:
        xgb_model.set_threads(threads)
    timings: dict[str, float] = {}
    t0 = time.perf_counter()

    def lap(name: str, since: float) -> float:
        now = time.perf_counter()
        timings[name] = round(now - since, 3)
        return now

    ds = load_dataset(dataset_dir)
    validation = validate_dataset(ds, require_real=require_real)
    if not validation["valid"]:
        # Refuse before building anything: an invalid dataset is not evidence of anything.
        failed = [c["check"] for c in validation["checks"] if not c["passed"] and c["severity"] == "error"]
        r = {"engine_version": __version__, "validation": validation,
             "dataset": {"path": str(ds.path), "source": ds.source, "schema_version": ds.manifest.get("schema_version"),
                         "as_of": ds.manifest.get("as_of"), "counts": ds.manifest.get("counts")},
             "ledger": {"mode": mode, "matches": 0}, "features": {}, "coverage": {"features_all": {}},
             "status": f"invalid dataset: failed integrity check(s) {', '.join(failed)}; no model trained"}
        r["recommendation"] = recommend(r)
        return _finish(r, out, timings, t0)
    ledger = Ledger(ds.observations, mode=mode)
    t = lap("load_and_ledger", t0)
    df, featmeta = build_feature_table(ds.fixtures, ledger, feature_config)
    t = lap("features", t)

    r: dict = {
        "engine_version": __version__,
        "dataset": {"path": str(ds.path), "source": ds.source, "schema_version": ds.manifest["schema_version"], "as_of": ds.manifest.get("as_of"),
                    "generated_at": ds.manifest.get("generated_at"), "files": ds.manifest.get("files"), "counts": ds.manifest.get("counts"),
                    "fixture_exclusions": ds.manifest.get("fixture_exclusions"), "job_verdicts": ds.manifest.get("job_verdicts"),
                    "context_versions": ds.manifest.get("context_versions"), "audit": ds.manifest.get("audit"),
                    "source_timestamps": ds.manifest.get("source_timestamps")},
        "protocol": {"ledger_mode": mode, "test_fraction": test_fraction, "pre_registered_test_fraction": PRIMARY_TEST_FRACTION,
                     "test_fraction_overridden": test_fraction != PRIMARY_TEST_FRACTION, "n_folds": n_folds, "calibration_fraction": cal_fraction,
                     "quick_grid": quick, "gates": {"min_test": MIN_TEST, "coverage_min_pct": COVERAGE_MIN, "min_logloss_gain": MIN_LOGLOSS_GAIN, "ece_max": ECE_MAX}},
        "validation": validation,
        "ledger": ledger.summary(),
        "features": {**featmeta, "columns": feature_columns(df) if not df.empty else []},
        "coverage": {"features_all": completeness(df)},
        "distribution": {},
    }
    if not df.empty:
        r["distribution"] = {
            "by_league": df.groupby(["league_id", "league_name"], dropna=False).size().sort_values(ascending=False).head(30)
                           .reset_index().rename(columns={0: "n"}).to_dict(orient="records"),
            "by_season": df.groupby("season").size().to_dict(),
            "by_month": df.groupby(df["kickoff"].dt.strftime("%Y-%m")).size().to_dict(),
            "outcomes": {"home": int((df["y"] == 0).sum()), "draw": int((df["y"] == 1).sum()), "away": int((df["y"] == 2).sum())},
        }

    if len(df) < MIN_FIXTURES:
        r["status"] = f"insufficient data: {len(df)} usable fixtures (< {MIN_FIXTURES}); no model trained"
        r["recommendation"] = recommend(r)
        return _finish(r, out, timings, t0)

    # ── primary evaluation (the only one the decision rule reads) ──────────
    fs = _fit_and_score(df, test_fraction, n_folds, cal_fraction, quick)
    dev, test, folds, cal = fs["dev"], fs["test"], fs["folds"], fs["cal"]
    features, params, rounds, booster, enc, T, P, pois_test = (fs[k] for k in ("features", "params", "rounds", "booster", "enc", "temperature", "P", "pois_test"))
    r["splits"] = {"final": describe(df, fs["final"]), "folds": [describe(dev, f) for f in folds], "calibration": describe(dev, cal)}
    r["coverage"]["features_test"] = completeness(test)
    t = lap("primary_fit", t)

    wf = []
    for i, f in enumerate(folds):
        tr, ev = dev.iloc[f.train], dev.iloc[f.eval]
        b, e, best = xgb_model.train_with_early_stopping(tr, features, params)
        y = ev["y"].to_numpy()
        Pf = {"base_rate": _base_rate(tr["y"].to_numpy(), len(ev)), "poisson": _poisson(ev)[:, :3], "xgb": xgb_model.predict(b, e, ev, features, best)}
        wf.append({"fold": i, "n_train": int(len(tr)), "n_eval": int(len(ev)), **{k: float(logloss_rows(v, y).mean()) for k, v in Pf.items()}})
    r["walk_forward"] = {"folds": wf, "note": "XGBoost fold scores use the config selected on these same folds, so they are optimistic; the test period is the unbiased estimate.",
                         "tuning": {"best_params": params, "rounds": rounds, "grid_size": len(fs["tuned"]["results"]), "results": fs["tuned"]["results"]}}
    t = lap("walk_forward", t)

    y = test["y"].to_numpy()
    r["test"] = _score_suite(P, y)
    r["test"]["temperature"] = T
    r["test"]["paired"] = {
        "xgb_calibrated_minus_poisson": _paired(P, y, "xgb_calibrated", "poisson"),
        "xgb_calibrated_minus_base_rate": _paired(P, y, "xgb_calibrated", "base_rate"),
        "poisson_minus_base_rate": _paired(P, y, "poisson", "base_rate"),
        "xgb_calibrated_minus_xgb_raw": _paired(P, y, "xgb_calibrated", "xgb_raw"),
    }

    leagues = []
    for (lid, lname), g in test.groupby(["league_id", "league_name"], dropna=False):
        if len(g) < MIN_LEAGUE_N:
            continue
        ix, yy = g.index.to_numpy(), g["y"].to_numpy()
        leagues.append({"league_id": int(lid), "league_name": lname, "n": int(len(g)),
                        **{k: float(logloss_rows(v[ix], yy).mean()) for k, v in P.items()},
                        "xgb_minus_poisson": paired_difference(logloss_rows(P["xgb_calibrated"][ix], yy), logloss_rows(P["poisson"][ix], yy))})
    r["test"]["by_league"] = sorted(leagues, key=lambda x: -x["n"])

    goals = {}
    for name, col, target in (("over_2_5", 3, "y_over25"), ("btts", 4, "y_btts")):
        yy = test[target].to_numpy()
        base = np.full(len(test), (dev[target].sum() + 1) / (len(dev) + 2))
        goals[name] = {"poisson": score_binary(pois_test[:, col], yy), "base_rate": score_binary(base, yy),
                       "poisson_minus_base_rate": {"log_loss": paired_difference(binary_logloss_rows(pois_test[:, col], yy), binary_logloss_rows(base, yy)),
                                                   "brier": paired_difference(binary_brier_rows(pois_test[:, col], yy), binary_brier_rows(base, yy))}}
    r["test"]["goals_markets"] = goals

    fixtures_by_id = {f["fixture_id"]: f for f in ds.included}
    r["engine_comparison"] = engine_compare(test, fixtures_by_id, {"xgb": P["xgb_calibrated"], "poisson": pois_test})
    t = lap("evaluation", t)

    meta = xgb_model.save_artifact(out / "model", booster, enc, features, params, rounds, T, ds.manifest,
                                   {"feature_config": featmeta["config"], "ledger_mode": mode, "test_fraction": test_fraction,
                                    "train_rows": int(len(fs["dev_fit"])), "calibration_rows": int(len(fs["dev_cal"]))})
    r["artifact"] = {"path": str(out / "model"), "version": meta["version"], "model_sha256": meta["model_sha256"]}
    preds = test[["fixture_id", "kickoff", "league_id", "y"]].copy()
    for k, v in P.items():
        for c, lab in enumerate(("home", "draw", "away")):
            preds[f"{k}_{lab}"] = v[:, c]
    preds.to_csv(out / "test_predictions.csv", index=False)
    t = lap("artifacts", t)

    # Decided BEFORE any alternative boundary is evaluated, from the primary result only.
    r["status"] = "evaluated"
    r["recommendation"] = recommend(r)

    if boundary_sensitivity:
        r["boundary_sensitivity"] = _boundary_sensitivity(df, test_fraction, boundary_fractions, n_folds, cal_fraction, quick)
        t = lap("boundary_sensitivity", t)
    if sensitivity:
        r["sensitivity"] = _sensitivity(ds, mode, feature_config, params, rounds, test_fraction, cal_fraction)
        t = lap("ledger_mode_sensitivity", t)
    return _finish(r, out, timings, t0)


def _boundary_sensitivity(df: pd.DataFrame, primary: float, fractions, n_folds: int, cal_fraction: float, quick: bool) -> dict:
    """Re-run the whole protocol at other test boundaries — REPORTING ONLY.

    Each boundary is tuned, fitted and calibrated from scratch on its own
    development period (nothing is reused from the primary run, whose
    development period may overlap these test periods). Results never feed the
    final model, the artifact, or recommend(): they show how stable the primary
    conclusion is, and cannot be used to pick a favourable boundary.
    """
    rows = []
    for frac in sorted(set(fractions) - {primary}):
        try:
            fs = _fit_and_score(df, frac, n_folds, cal_fraction, quick)
        except Exception as e:  # e.g. too few rows for the folds at an extreme boundary
            rows.append({"test_fraction": frac, "status": f"not evaluated: {e}"})
            continue
        test, P = fs["test"], fs["P"]
        y = test["y"].to_numpy()
        d_pois = paired_difference(logloss_rows(P["xgb_calibrated"], y), logloss_rows(P["poisson"], y))
        d_base = paired_difference(logloss_rows(P["xgb_calibrated"], y), logloss_rows(P["base_rate"], y))
        rows.append({
            "test_fraction": frac, "status": "evaluated", "boundary": fs["final"].boundary.isoformat(), "n_test": int(len(test)),
            "test_kickoff_min": test["kickoff"].min().isoformat(), "test_kickoff_max": test["kickoff"].max().isoformat(),
            "coverage_test_both_history_pct": completeness(test).get("both_history_pct"),
            **{f"{k}_log_loss": float(logloss_rows(v, y).mean()) for k, v in P.items() if k != "xgb_raw"},
            "xgb_minus_poisson": d_pois, "xgb_minus_base_rate": d_base,
            "tuned_params": fs["params"], "rounds": fs["rounds"], "temperature": fs["temperature"],
        })
    evaluated = [x for x in rows if x["status"] == "evaluated"]
    signs = {("better" if x["xgb_minus_poisson"]["hi"] < 0 else "worse" if x["xgb_minus_poisson"]["lo"] > 0 else "inconclusive") for x in evaluated}
    return {"primary_test_fraction": primary, "boundaries": rows,
            "xgb_vs_poisson_verdicts": sorted(signs),
            "note": "Reporting only. Each boundary is tuned and calibrated independently; none is used to train the final model, choose parameters, or reach the recommendation."}


def _sensitivity(ds, mode, cfg, params, rounds, test_fraction, cal_fraction) -> dict:
    """Same params, the other ledger mode: how much does strict point-in-time availability cost?"""
    other = "completion" if mode == "strict" else "strict"
    df2, _ = build_feature_table(ds.fixtures, Ledger(ds.observations, mode=other), cfg)
    s = final_split(df2, test_fraction)
    dev, test = df2.iloc[s.train].reset_index(drop=True), df2.iloc[s.eval].reset_index(drop=True)
    c = split_at(dev, _kickoff_quantile(dev, 1 - cal_fraction))
    feats = feature_columns(df2)
    b, enc = xgb_model.train_fixed(dev.iloc[c.train], feats, params, rounds)
    T = fit_temperature(xgb_model.predict(b, enc, dev.iloc[c.eval], feats), dev.iloc[c.eval]["y"].to_numpy())
    y = test["y"].to_numpy()
    return {"mode": other, "n_test": int(len(test)), "both_history_pct": completeness(df2).get("both_history_pct"),
            "poisson_log_loss": float(logloss_rows(_poisson(test)[:, :3], y).mean()),
            "xgb_calibrated_log_loss": float(logloss_rows(apply_temperature(xgb_model.predict(b, enc, test, feats), T), y).mean()),
            "note": "Completion mode lets a fixture see results BetGenius only recorded after generation. It is an upper bound on what better data capture could buy, not a valid backtest."}


def _finish(r: dict, out: Path, timings: dict, t0: float) -> dict:
    timings["total"] = round(time.perf_counter() - t0, 3)
    r["resources"] = {"timings_s": timings, "peak_rss_mib": round(_peak_rss_mib(), 1), "cpu_count": os.cpu_count(),
                      "xgboost_nthread": xgb_model.NTHREAD, "python": platform.python_version(), "platform": platform.platform()}
    (out / "results.json").write_text(json.dumps(r, indent=2, default=_json_default) + "\n")
    from .report import render
    (out / "report.md").write_text(render(r))
    return r


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (pd.Timestamp,)):
        return o.isoformat()
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)

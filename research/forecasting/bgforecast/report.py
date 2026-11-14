"""Render results.json as a Markdown research report.

Every figure in the report is read from the results dict; nothing is typed in.
A synthetic dataset produces a report whose first line says so, and that
banner cannot be turned off.
"""

from __future__ import annotations


def _f(v, d=4):
    return "—" if v is None or v != v else f"{v:.{d}f}"


def _ci(m, d=4):
    if not m or m.get("n", 0) == 0:
        return "—"
    return f"{_f(m['mean'], d)} [{_f(m['lo'], d)}, {_f(m['hi'], d)}]"


def _table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def _kv(d: dict | None) -> str:
    if not d:
        return "_none_"
    return _table(["item", "count"], [[k, v] for k, v in d.items()])


LIMITATIONS = [
    "Features use only recent completed results reconstructed from stored contexts and settlements. Season aggregates, standings, player availability and odds are excluded because their point-in-time validity is not established.",
    "Last-5 lists hold five matches per team per context. A team's history in the ledger is the union of what any stored context sighted, so teams that BetGenius rarely covered have thin histories; coverage is reported above, not assumed.",
    "Strict mode only uses results that were on record in BetGenius by generation time. That is the honest backtest of what the engine could have known, and it is pessimistic relative to a system that ingests every result.",
    "Last-5 entries carry no match status. An abandoned match with a partial score would be read as a result if no h2h or settlement sighting contradicts it.",
    "The Poisson baseline assumes independent home and away goals (no Dixon–Coles adjustment) and ignores opponent strength within each team's recent window.",
    "The existing-engine comparison is selection-conditional: it scores the engine's own picks only, using raw uncalibrated confidence. It is not a comparison of full 1X2 distributions.",
    "No betting profitability is claimed or measured: no verified publication-time prices are used anywhere in this pipeline.",
    "Confidence intervals are 95% percentile bootstraps over fixtures with a fixed seed; they capture sampling variation in the test period, not drift beyond it.",
]


def render(r: dict) -> str:
    L: list[str] = []
    src = r["dataset"]["source"]
    L.append("# BetGenius forecasting research report\n")
    if src == "synthetic":
        L.append("> **SYNTHETIC DATA — NOT A REAL-WORLD RESULT.** This report was produced from generated test data to exercise the pipeline. "
                 "No production data was read, and no figure below describes BetGenius fixtures or performance.\n")
    else:
        L.append(f"> Source: `{src}` extraction, as_of `{r['dataset'].get('as_of')}`, schema `{r['dataset']['schema_version']}`.\n")
    rec = r.get("recommendation", {})
    L.append(f"## Recommendation: **{rec.get('decision', '—')}**\n")
    for x in rec.get("reasons", []):
        L.append(f"- {x}")
    if rec.get("gates"):
        L.append("\nPre-registered gates (all must pass for **proceed**; decided from the primary test period only):\n")
        L.append(_table(["gate", "result", "detail"], [[g["gate"], "pass" if g["passed"] else "**FAIL**", g["detail"]] for g in rec["gates"]]))
    proto = r.get("protocol") or {}
    if proto.get("test_fraction_overridden"):
        L.append(f"\n> **Protocol deviation:** test fraction {proto.get('test_fraction')} differs from the pre-registered {proto.get('pre_registered_test_fraction')}. "
                 "A boundary chosen after seeing results is not a valid basis for a decision.\n")
    L.append(f"\nStatus: {r.get('status')}\n")

    c = r["dataset"].get("counts") or {}
    L.append("## 1. Extracted dataset\n")
    L.append(_table(["measure", "count"], [[k, v] for k, v in c.items()]))
    L.append("\n### Fixture exclusions (a fixture can carry several reasons)\n")
    L.append(_kv(r["dataset"].get("fixture_exclusions")))
    L.append("\n### Candidate generation jobs by verdict\n")
    L.append(_kv(r["dataset"].get("job_verdicts")))
    L.append("\n### Context versions among included fixtures\n")
    L.append(_kv(r["dataset"].get("context_versions")))
    L.append("\n### Source timestamps\n")
    L.append(_kv(r["dataset"].get("source_timestamps")))

    L.append("\n## 2. Historical leakage findings\n")
    L.append("Audit of the selected pre-kickoff contexts (these fields are never used as features):\n")
    L.append(_kv(r["dataset"].get("audit")))
    lg = r["ledger"]
    L.append(f"\nLedger mode `{lg['mode']}`: {lg['matches']} distinct completed matches after merging sightings.\n")
    L.append("Sightings rejected:\n")
    L.append(_kv(lg.get("sighting_rejections")))
    L.append("\nMatches rejected:\n")
    L.append(_kv(lg.get("match_rejections")))
    L.append("\nMatches the ledger knew about but withheld from a fixture because they were not available at its generation time (summed over both teams of every fixture):\n")
    L.append(_kv(r["features"].get("withheld")))

    L.append("\n## 3. Feature completeness\n")
    for k in ("features_all", "features_test"):
        if r["coverage"].get(k):
            L.append(f"\n**{k.replace('_', ' ')}**\n")
            L.append(_kv(r["coverage"][k]))
    L.append(f"\nFeature columns ({len(r['features'].get('columns', []))}): `{', '.join(r['features'].get('columns', []))}`\n")
    L.append(f"Feature config: `{r['features'].get('config')}`\n")

    d = r.get("distribution") or {}
    if d:
        L.append("\n## 4. League and season distribution\n")
        L.append(_table(["league_id", "league", "fixtures"], [[x["league_id"], x["league_name"], x["n"]] for x in d.get("by_league", [])]))
        L.append("\n" + _kv(d.get("by_season")))
        L.append("\nOutcomes: " + ", ".join(f"{k} {v}" for k, v in d.get("outcomes", {}).items()) + "\n")

    if r.get("status") != "evaluated":
        L.append("\n## 5. Models\n\nNo model was trained: " + str(r.get("status")) + "\n")
        return _tail(L, r)

    s = r["splits"]
    L.append("\n## 5. Chronological splits\n")
    L.append("Training rows need kickoff + 3h <= boundary; evaluation rows need generation >= boundary; anything between is embargoed.\n")
    rows = [["final (test)", s["final"]["boundary"], s["final"]["train"].get("n"), s["final"]["eval"].get("n"), s["final"]["embargoed"],
             f"{s['final']['eval'].get('kickoff_min', '—')} → {s['final']['eval'].get('kickoff_max', '—')}"]]
    rows += [[f"fold {i}", f["boundary"], f["train"].get("n"), f["eval"].get("n"), f["embargoed"], f"{f['eval'].get('kickoff_min', '—')} → {f['eval'].get('kickoff_max', '—')}"] for i, f in enumerate(s["folds"])]
    rows += [["calibration", s["calibration"]["boundary"], s["calibration"]["train"].get("n"), s["calibration"]["eval"].get("n"), s["calibration"]["embargoed"], "—"]]
    L.append(_table(["split", "boundary", "train", "eval", "embargoed", "eval kickoffs"], rows))

    wf = r["walk_forward"]
    L.append("\n### Walk-forward (development period), mean log loss\n")
    L.append(_table(["fold", "train", "eval", "base rate", "Poisson", "XGBoost"], [[x["fold"], x["n_train"], x["n_eval"], _f(x["base_rate"]), _f(x["poisson"]), _f(x["xgb"])] for x in wf["folds"]]))
    L.append(f"\n{wf['note']}\n")
    L.append(f"Selected parameters: `{wf['tuning']['best_params']}`, {wf['tuning']['rounds']} rounds, from a grid of {wf['tuning']['grid_size']}.\n")

    te = r["test"]
    L.append("\n## 6. Untouched test period — 1X2\n")
    L.append("Mean with 95% bootstrap interval. Lower is better for log loss and Brier (multiclass Brier, range 0–2).\n")
    L.append(_table(["model", "n", "log loss", "Brier", "accuracy", "top-label ECE", "class-wise ECE"],
                    [[k, te[k]["n"], _ci(te[k]["log_loss"]), _ci(te[k]["brier"]), _ci(te[k]["accuracy"], 3), _f(te[k]["calibration"]["top_label_ece"], 3), _f(te[k]["calibration"]["classwise_ece_mean"], 3)]
                     for k in ("base_rate", "poisson", "xgb_raw", "xgb_calibrated")]))
    L.append(f"\nTemperature fitted on the calibration slice: {_f(te['temperature'], 3)}\n")
    L.append("\n### Paired differences (negative favours the first model)\n")
    L.append(_table(["comparison", "Δ log loss", "Δ Brier"], [[k, _ci(v["log_loss"]), _ci(v["brier"])] for k, v in te["paired"].items()]))
    L.append("\n### Mean forecast vs observed frequency (home, draw, away)\n")
    L.append(_table(["model", "mean p", "observed"], [[k, ", ".join(_f(x, 3) for x in te[k]["calibration"]["mean_p"]), ", ".join(_f(x, 3) for x in te[k]["calibration"]["observed"])] for k in ("base_rate", "poisson", "xgb_calibrated")]))

    L.append("\n### By league (test, leagues with ≥ 30 fixtures), mean log loss\n")
    if te["by_league"]:
        L.append(_table(["league", "n", "base rate", "Poisson", "XGB calibrated", "XGB − Poisson"],
                        [[f"{x['league_name']} ({x['league_id']})", x["n"], _f(x["base_rate"]), _f(x["poisson"]), _f(x["xgb_calibrated"]), _ci(x["xgb_minus_poisson"])] for x in te["by_league"]]))
    else:
        L.append("_No league reaches 30 test fixtures._")

    L.append("\n## 7. Goals markets (Poisson)\n")
    L.append(_table(["market", "model", "n", "log loss", "Brier", "ECE", "mean p", "observed"],
                    [[m, k, v[k]["n"], _ci(v[k]["log_loss"]), _ci(v[k]["brier"]), _f(v[k]["ece"], 3), _f(v[k]["mean_p"], 3), _f(v[k]["observed"], 3)]
                     for m, v in te["goals_markets"].items() for k in ("poisson", "base_rate")]))
    L.append("\n" + _table(["market", "Poisson − base rate, log loss"], [[m, _ci(v["poisson_minus_base_rate"]["log_loss"])] for m, v in te["goals_markets"].items()]))

    e = r["engine_comparison"]
    L.append("\n## 8. Existing-engine comparison (test period)\n")
    L.append(f"{e.get('status')}. Comparable engine picks: {e.get('rows', 0)}.\n")
    rows = []
    for mt, v in e.get("markets", {}).items():
        if "engine" not in v:
            rows.append([mt, v["n"], _f(v["engine_hit_rate"], 3), _f(v["engine_mean_confidence"], 3), "—", "—", v.get("status", "")])
            continue
        for name in ("xgb", "poisson"):
            if name in v:
                rows.append([mt, v["n"], _f(v["engine_hit_rate"], 3), _f(v["engine_mean_confidence"], 3), name,
                             _ci(v[name]["log_loss_minus_engine"]), _ci(v[name]["brier_minus_engine"])])
    if rows:
        L.append(_table(["market", "picks", "engine hit rate", "engine mean confidence", "model", "Δ log loss vs engine", "Δ Brier vs engine"], rows))
        L.append("\nNegative Δ means the model's probability for the engine's own pick scored better than the engine's stated confidence.\n")

    bs = r.get("boundary_sensitivity")
    if bs:
        L.append("\n## 9. Sensitivity: alternative test boundaries (reporting only)\n")
        L.append(f"{bs['note']} Primary test fraction: {bs['primary_test_fraction']}.\n")
        rows = []
        for x in bs["boundaries"]:
            if x.get("status") != "evaluated":
                rows.append([x["test_fraction"], "—", "—", "—", "—", "—", "—", "—", x.get("status")])
                continue
            rows.append([x["test_fraction"], x["boundary"], x["n_test"], _f(x.get("coverage_test_both_history_pct"), 1), _f(x["base_rate_log_loss"]),
                         _f(x["poisson_log_loss"]), _f(x["xgb_calibrated_log_loss"]), _ci(x["xgb_minus_poisson"]), _ci(x["xgb_minus_base_rate"])])
        L.append(_table(["test fraction", "boundary", "n test", "test coverage %", "base rate", "Poisson", "XGB calibrated", "XGB − Poisson", "XGB − base rate"], rows))
        L.append(f"\nXGBoost vs Poisson across alternative boundaries: {', '.join(bs['xgb_vs_poisson_verdicts']) or '—'}. "
                 "A primary 'proceed' that is contradicted here should be treated with caution in the shadow phase; these rows never change the decision.\n")
    if r.get("sensitivity"):
        L.append("\n## 10. Sensitivity: ledger mode\n")
        L.append(_kv(r["sensitivity"]))
    L.append(f"\n## Model artifact\n\n`{r['artifact']['version']}` at `{r['artifact']['path']}` (sha256 `{r['artifact']['model_sha256']}`), research only.\n")
    return _tail(L, r)


def _tail(L: list[str], r: dict) -> str:
    res = r.get("resources", {})
    L.append("\n## Training time and resources\n")
    L.append(_kv(res.get("timings_s")))
    L.append(f"\nPeak RSS {res.get('peak_rss_mib')} MiB; {res.get('cpu_count')} CPUs available; XGBoost threads {res.get('xgboost_nthread')}; Python {res.get('python')} on {res.get('platform')}.\n")
    L.append("\n## Limitations\n")
    L += [f"- {x}" for x in LIMITATIONS]
    if r["dataset"]["source"] == "synthetic":
        L.append("- **This run used synthetic data. No real-world training or evaluation has occurred.**")
    return "\n".join(L) + "\n"

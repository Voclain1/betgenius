"""Dataset integrity validation, run before any model is trained.

Hard checks (``error``) make the pipeline refuse to train: a dataset that
fails one is not evidence of anything. Soft checks (``warning``) are reported
for a human to read: they describe the data rather than invalidate it.

The reference figures below are the read-only AUDIT OBSERVATIONS quoted in the
research brief (November 2026). They are not certified counts and were taken
with different denominators and filters, so differences are reported as
information, never as failures. The extractor's own counts are the ones a
report cites.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from .dataset import Dataset
from .ledger import parse_ts

AUDIT_REFERENCE = {
    "prediction_rows_total": 7928,
    "distinct_fixture_ids": 4403,
    "completed_fixtures_with_context": 4264,
    "generation_jobs": 5163,
    "generation_jobs_with_context": 5149,
    "both_season_records_of_4262": 3512,
    "both_recent_matches_of_4262": 4217,
    "standings": 3141,
    "h2h": 3437,
    "availability": 1675,
    "future_availability_dates": 1154,
    "same_day_recent_entries": 4,
    "missing_score_recent_entries": 443,
}

# manifest key -> audit reference key, for the side-by-side table
AUDIT_MAP = {
    ("counts", "prediction_rows_total"): "prediction_rows_total",
    ("counts", "distinct_fixture_ids"): "distinct_fixture_ids",
    ("counts", "fixtures_included"): "completed_fixtures_with_context",
    ("counts", "generation_jobs"): "generation_jobs",
    ("counts", "generation_jobs_with_context"): "generation_jobs_with_context",
    ("audit", "included_both_season_records"): "both_season_records_of_4262",
    ("audit", "included_both_recent_matches"): "both_recent_matches_of_4262",
    ("audit", "included_standings"): "standings",
    ("audit", "included_h2h"): "h2h",
    ("audit", "included_availability"): "availability",
    ("audit", "included_availability_future_dated"): "future_availability_dates",
    ("audit", "included_with_same_day_last5"): "same_day_recent_entries",
    ("audit", "included_with_missing_score_last5"): "missing_score_recent_entries",
}

SOURCES = {"context_last5", "context_h2h", "settlement"}


def _ts(s):
    try:
        return parse_ts(s)
    except Exception:
        return None


def validate_dataset(ds: Dataset, require_real: bool = False) -> dict:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str, severity: str = "error"):
        checks.append({"check": name, "passed": bool(ok), "severity": severity, "detail": detail})

    m = ds.manifest
    as_of = _ts(m.get("as_of") or "")
    real = ds.source == "postgres"
    check("source", real or not require_real, f"source is {ds.source!r}" + ("" if real else " (not a real extraction)"),
          "error" if require_real else "warning")
    if real:
        db = m.get("database") or {}
        check("read_only_snapshot", db.get("read_only_verified") is True and db.get("isolation") == "repeatable read",
              f"read_only_verified={db.get('read_only_verified')}, isolation={db.get('isolation')}")
    check("as_of", as_of is not None, f"as_of={m.get('as_of')!r}")

    inc = [f for f in ds.fixtures if f["status"] == "included"]
    exc = [f for f in ds.fixtures if f["status"] != "included"]
    counts = m.get("counts") or {}
    check("counts_reconcile", counts.get("distinct_fixture_ids", len(ds.fixtures)) == len(ds.fixtures)
          and counts.get("fixtures_included", len(inc)) == len(inc),
          f"manifest distinct={counts.get('distinct_fixture_ids')} included={counts.get('fixtures_included')}; files hold {len(ds.fixtures)} / {len(inc)}")
    check("excluded_have_reasons", all(f.get("exclusion_reasons") for f in exc), f"{sum(1 for f in exc if not f.get('exclusion_reasons'))} excluded fixtures without a reason")
    check("included_have_no_reasons", all(not f.get("exclusion_reasons") for f in inc), "included fixtures must carry no exclusion reason")

    bad = Counter()
    for f in inc:
        ko, gen, st = _ts(f.get("kickoff") or ""), _ts((f.get("generation") or {}).get("created_at") or ""), _ts(f.get("settled_at") or "")
        if ko is None or gen is None:
            bad["unparseable_timestamp"] += 1
            continue
        if gen >= ko:
            bad["generation_not_before_kickoff"] += 1
        if st is None or st <= ko:
            bad["settlement_not_after_kickoff"] += 1
        if as_of and (ko > as_of or gen > as_of or (st and st > as_of)):
            bad["timestamp_after_as_of"] += 1
        if None in (f.get("league_id"), f.get("home_id"), f.get("away_id")) or f.get("home_id") == f.get("away_id"):
            bad["identity_invalid"] += 1
        hg, ag = f.get("home_goals"), f.get("away_goals")
        if not (isinstance(hg, int) and isinstance(ag, int) and hg >= 0 and ag >= 0):
            bad["score_invalid"] += 1
        for e in f.get("engine_predictions") or []:
            et = _ts(e.get("created_at") or "")
            if et is None or et >= ko:
                bad["engine_prediction_not_before_kickoff"] += 1
            if e.get("prediction_id") is None or not isinstance(e.get("confidence"), (int, float)):
                bad["engine_prediction_malformed"] += 1
    check("included_fixture_integrity", not bad, ", ".join(f"{k}: {v}" for k, v in sorted(bad.items())) or f"{len(inc)} included fixtures clean")

    ob = Counter()
    ids = {f["fixture_id"] for f in ds.fixtures}
    for o in ds.observations:
        t = _ts(o.get("observed_at") or "")
        if o.get("source") not in SOURCES:
            ob["unknown_source"] += 1
        if t is None:
            ob["unparseable_observed_at"] += 1
        elif as_of and t > as_of:
            ob["observed_after_as_of"] += 1
        try:
            datetime.fromisoformat(o["date"])
        except Exception:
            ob["unparseable_date"] += 1
        if o.get("source") == "settlement" and o.get("fixture_id") not in ids:
            ob["settlement_for_unknown_fixture"] += 1
    check("observation_integrity", not ob, ", ".join(f"{k}: {v}" for k, v in sorted(ob.items())) or f"{len(ds.observations)} observations clean")

    check("included_volume", len(inc) >= 300, f"{len(inc)} included fixtures (the pipeline trains nothing below 300)", "warning")
    ctx = m.get("context_versions") or {}
    check("context_versions", True, ", ".join(f"{k}: {v}" for k, v in sorted(ctx.items())) or "none", "warning")

    audit = []
    for (sect, key), ref in AUDIT_MAP.items():
        val = (m.get(sect) or {}).get(key)
        audit.append({"measure": f"{sect}.{key}", "extracted": val, "audit_reference": AUDIT_REFERENCE[ref],
                      "difference": None if val is None else val - AUDIT_REFERENCE[ref]})

    errors = [c for c in checks if not c["passed"] and c["severity"] == "error"]
    return {"valid": not errors, "errors": len(errors), "checks": checks, "audit_comparison": audit,
            "note": "Audit reference figures are observations from the research brief, not certified counts; differences are informational."}

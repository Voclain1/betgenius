"""Point-in-time ledger: same-day rules, completion proofs, dedupe, conflicts, target exclusion."""

from datetime import datetime, timezone

from bgforecast.ledger import Ledger, parse_ts
from conftest import obs

TARGET = {"fixture_id": 999, "home_id": 1, "away_id": 2, "kickoff": "2026-03-20T15:00:00.000Z"}


def at(s):
    return parse_ts(s)


class TestSameDay:
    def test_last5_recorded_on_its_own_day_is_rejected(self):
        led = Ledger([obs(date="2026-03-05", observed_at="2026-03-05T21:00:00Z")])
        assert led.matches == [] and led.sighting_rejections["unverifiable_completion"] == 1

    def test_last5_needs_28_hours_from_date_midnight(self):
        assert Ledger([obs(date="2026-03-05", observed_at="2026-03-06T03:59:59Z")]).matches == []
        assert len(Ledger([obs(date="2026-03-05", observed_at="2026-03-06T04:00:00Z")]).matches) == 1

    def test_same_day_match_verifiable_through_exact_kickoff_and_status(self):
        # h2h sighting: finished status, exact kickoff 12:00, recorded 16:00 — usable for a generation at 18:00 the same day.
        led = Ledger([obs(source="context_h2h", fixture_id=5, date="2026-03-19", kickoff="2026-03-19T12:00:00Z", observed_at="2026-03-19T16:00:00Z")])
        hist = led.team_history(1, at("2026-03-19T18:00:00Z"), TARGET, 10, 365)
        assert len(hist) == 1
        assert led.team_history(1, at("2026-03-19T15:59:00Z"), TARGET, 10, 365) == []

    def test_same_day_last5_never_reaches_a_same_day_generation(self):
        # The only sighting is a last-5 entry recorded at generation time on the match day: unverifiable.
        led = Ledger([obs(date="2026-03-19", observed_at="2026-03-19T18:00:00Z")])
        assert led.team_history(1, at("2026-03-19T18:00:00Z"), TARGET, 10, 365) == []


class TestAvailability:
    def test_strict_mode_needs_the_result_on_record(self):
        o = obs(source="settlement", fixture_id=7, date="2026-03-01", kickoff="2026-03-01T15:00:00Z", observed_at="2026-03-05T00:00:00Z")
        strict, comp = Ledger([o], "strict"), Ledger([o], "completion")
        t = at("2026-03-03T00:00:00Z")
        assert strict.team_history(1, t, TARGET, 10, 365) == []
        assert len(comp.team_history(1, t, TARGET, 10, 365)) == 1

    def test_future_matches_are_never_available(self):
        o = obs(source="settlement", fixture_id=7, date="2026-03-25", kickoff="2026-03-25T15:00:00Z", observed_at="2026-03-25T18:00:00Z")
        for mode in ("strict", "completion"):
            assert Ledger([o], mode).team_history(1, at("2026-03-20T10:00:00Z"), TARGET, 10, 365) == []

    def test_target_fixture_is_excluded_by_id_and_by_teams_and_day(self):
        by_id = obs(source="settlement", fixture_id=999, date="2026-03-20", kickoff="2026-03-20T15:00:00Z", observed_at="2026-03-20T18:00:00Z")
        by_day = obs(date="2026-03-20", observed_at="2026-03-22T12:00:00Z", home_id=2, away_id=1)
        led = Ledger([by_id, by_day], "completion")
        assert led.team_history(1, at("2026-04-01T00:00:00Z"), TARGET, 10, 365) == []

    def test_recorded_before_kickoff_is_rejected(self):
        led = Ledger([obs(source="context_h2h", fixture_id=8, date="2026-03-01", kickoff="2026-03-01T15:00:00Z", observed_at="2026-03-01T14:00:00Z")])
        assert led.matches == [] and led.sighting_rejections["recorded_before_kickoff"] == 1

    def test_max_age_bounds_history(self):
        led = Ledger([obs(date="2024-01-01", observed_at="2024-01-05T00:00:00Z")])
        assert led.team_history(1, at("2026-03-20T00:00:00Z"), TARGET, 10, 365) == []


class TestMissingAndInvalid:
    def test_incomplete_results_are_excluded(self):
        led = Ledger([obs(hg=None, ag=None)])
        assert led.matches == [] and led.sighting_rejections["incomplete_result"] == 1

    def test_unidentified_opponent_is_excluded(self):
        led = Ledger([obs(away_id=None)])
        assert led.matches == [] and led.sighting_rejections["team_unidentified"] == 1

    def test_kickoff_date_disagreement_is_rejected(self):
        led = Ledger([obs(source="context_h2h", fixture_id=3, date="2026-03-02", kickoff="2026-03-01T15:00:00Z")])
        assert led.sighting_rejections["date_kickoff_mismatch"] == 1


class TestDuplicates:
    def test_repeated_sightings_merge_and_keep_the_earliest_record(self):
        a = obs(observed_at="2026-03-10T12:00:00Z", ref="j1")
        b = obs(observed_at="2026-03-04T12:00:00Z", ref="j2")
        led = Ledger([a, b])
        assert len(led.matches) == 1
        assert led.matches[0].recorded_at == datetime(2026, 3, 4, 12, tzinfo=timezone.utc)

    def test_date_only_sighting_merges_into_id_keyed_match(self):
        a = obs(observed_at="2026-03-10T12:00:00Z")
        b = obs(source="settlement", fixture_id=55, date="2026-03-01", kickoff="2026-03-01T15:00:00Z", observed_at="2026-03-01T18:00:00Z")
        led = Ledger([a, b])
        assert len(led.matches) == 1 and led.matches[0].fixture_id == 55 and led.matches[0].sources == {"context_last5", "settlement"}

    def test_conflicting_scores_drop_the_match(self):
        led = Ledger([obs(hg=1, ag=0), obs(hg=2, ag=0, ref="j2")])
        assert led.matches == [] and led.match_rejections["score_conflict"] == 1


def test_aggregate_uses_only_available_matches():
    early = obs(date="2026-01-01", observed_at="2026-01-03T00:00:00Z", hg=4, ag=0)
    late = obs(date="2026-03-01", observed_at="2026-03-03T00:00:00Z", hg=0, ag=0, home_id=3, away_id=4)
    led = Ledger([early, late])
    a = led.aggregate(at("2026-02-01T00:00:00Z"), 10, 365)
    assert a["n"] == 1 and a["home_goals"] == 4.0

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bgforecast.synthetic import generate  # noqa: E402


@pytest.fixture(scope="session")
def synthetic_dir(tmp_path_factory):
    """A small synthetic dataset, generated once per session. Never real data."""
    d = tmp_path_factory.mktemp("synthetic")
    generate(d, seed=11, leagues=2, teams_per_league=12)
    return d


def obs(source="context_last5", observed_at="2026-03-10T12:00:00Z", date="2026-03-01", home_id=1, away_id=2, hg=1, ag=0,
        fixture_id=None, kickoff=None, competition_id=10, ref="job"):
    return {"source": source, "source_ref": ref, "observed_at": observed_at, "fixture_id": fixture_id, "date": date, "kickoff": kickoff,
            "home_id": home_id, "away_id": away_id, "home_goals": hg, "away_goals": ag, "competition_id": competition_id}

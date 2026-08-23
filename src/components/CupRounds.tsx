"use client";

import { useMemo, useState } from "react";
import { DateGroupedMatches, PillTabs, groupByDate, type MatchLinkIndex } from "@/components/MatchList";
import type { FixtureRow } from "@/lib/football/api-football";
import { classifyStatus } from "@/lib/matchStatus";

function defaultRound(rounds: string[], fixtures: FixtureRow[]): string {
  const active = rounds.find((round) => fixtures.some((fixture) =>
    fixture.league.round === round && classifyStatus(fixture.fixture.status.short) !== "finished",
  ));
  return active ?? rounds.at(-1) ?? "";
}

export function CupRounds({
  rounds,
  fixtures,
  linkIndex,
}: {
  rounds: string[];
  fixtures: FixtureRow[];
  linkIndex: MatchLinkIndex;
}) {
  const [round, setRound] = useState(() => defaultRound(rounds, fixtures));
  const selected = useMemo(
    () => fixtures.filter((fixture) => fixture.league.round === round),
    [fixtures, round],
  );
  const groups = useMemo(() => groupByDate(selected), [selected]);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto pb-1">
        <PillTabs
          options={rounds.map((value) => ({ key: value, label: value }))}
          active={round}
          onChange={setRound}
        />
      </div>
      <DateGroupedMatches groups={groups} linkIndex={linkIndex} />
    </div>
  );
}

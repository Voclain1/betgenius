"use client";

import { useState } from "react";
import { TeamCrest } from "@/components/TeamCrest";
import {
  FORM_WINDOWS,
  comparisonRows,
  formatComparisonValue,
  pct,
  scopeDescription,
  summarizeForm,
  type ComparisonValue,
  type FormSource,
  type FormScope,
  type FormSummary,
  type FormWindow,
} from "@/lib/matchCentre";

/**
 * Form and goals, both teams side by side, for a chosen window (last 5 / 10)
 * and scope (all competitions / at today's venue / this competition).
 *
 * The server verifies each team's matches (formSource) from the cached
 * fixture histories — the 10 most recent per scope — and the summaries for
 * the chosen window are pure arithmetic over a prefix of that list
 * (summarizeForm), so switching is instant and the browser never fetches. The figures are public
 * historical results; nothing here is premium or user-specific.
 */

const RESULT_TONE: Record<string, string> = { W: "text-emerald-300", D: "text-gray-300", L: "text-red-300" };
const RESULT_WORD: Record<string, string> = { W: "Win", D: "Draw", L: "Loss" };

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border border-brand-border bg-brand-bg p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-[10px] px-3 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
            o.value === value ? "bg-gray-100 text-brand-bg" : "text-gray-400 hover:text-gray-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function dateLabel(iso: string | null, timeZone: string, withYear = false): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone }).format(new Date(iso));
}

function SampleLine({ s, side, leagueName, timeZone }: { s: FormSummary; side: "home" | "away"; leagueName: string | null; timeZone: string }) {
  if (!s.played) return <p className="text-xs text-gray-500">No verified matches in this scope.</p>;
  const range = s.from === s.to ? dateLabel(s.to, timeZone, true) : `${dateLabel(s.from, timeZone)} – ${dateLabel(s.to, timeZone, true)}`;
  return (
    <p className="text-xs text-gray-500">
      <span className="font-semibold text-gray-300">{s.played} {s.played === 1 ? "match" : "matches"}</span> · {range} · {scopeDescription(s.scope, side, leagueName)}
      {s.played < s.window && <span className="block text-amber-300/90">Only {s.played} verified in this scope (window {s.window}).</span>}
    </p>
  );
}

function FormStrip({ s, timeZone }: { s: FormSummary; timeZone: string }) {
  if (!s.played) return null;
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Results, most recent first">
      {s.matches.map((m) => {
        const text = `${RESULT_WORD[m.result]} ${m.goalsFor}-${m.goalsAgainst} ${m.venue === "home" ? "v" : "at"} ${m.opponent}, ${dateLabel(m.date, timeZone, true)}, ${m.competition}`;
        return (
          <li key={m.fixtureApiId} title={text} className="flex w-11 flex-col items-center rounded-lg border border-brand-border bg-brand-bg py-1">
            <span aria-hidden className={`text-sm font-black ${RESULT_TONE[m.result]}`}>{m.result}</span>
            <span aria-hidden className="text-[10px] font-semibold tabular-nums text-gray-400">{m.goalsFor}-{m.goalsAgainst}</span>
            <span className="sr-only">{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SourceMatches({ s, timeZone }: { s: FormSummary; timeZone: string }) {
  if (!s.played) return null;
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-gray-400 hover:text-gray-100">Source matches ({s.played})</summary>
      <table className="mt-2 w-full text-xs">
        <caption className="sr-only">Matches used for these figures</caption>
        <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
          <tr>
            <th scope="col" className="py-1 text-left font-semibold">Date</th>
            <th scope="col" className="py-1 text-left font-semibold">Opponent</th>
            <th scope="col" className="py-1 text-center font-semibold">Score</th>
            <th scope="col" className="hidden py-1 text-left font-semibold sm:table-cell">Competition</th>
          </tr>
        </thead>
        <tbody>
          {s.matches.map((m) => (
            <tr key={m.fixtureApiId} className="border-t border-brand-border">
              <td className="whitespace-nowrap py-1.5 tabular-nums text-gray-400">{dateLabel(m.date, timeZone)}</td>
              <td className="max-w-[9rem] truncate py-1.5 text-gray-200">
                <span className="text-gray-500">{m.venue === "home" ? "v " : "@ "}</span>
                {m.opponent}
              </td>
              <td className={`py-1.5 text-center font-bold tabular-nums ${RESULT_TONE[m.result]}`}>
                {m.goalsFor}-{m.goalsAgainst}
              </td>
              <td className="hidden max-w-[10rem] truncate py-1.5 text-gray-500 sm:table-cell">{m.competition}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** A value as a headline (percentage / average / record) with its basis beside it ("7 of 10"), on one line. */
function ValueCell({ v, align }: { v: ComparisonValue; align: "left" | "right" }) {
  let head = formatComparisonValue(v);
  let sub: string | null = null;
  if (v.kind === "rate" && v.rate) {
    head = `${pct(v.rate)}%`;
    sub = `${v.rate.n}/${v.rate.d}`;
  }
  return (
    <div className={`flex items-baseline gap-1.5 ${align === "right" ? "justify-end" : "justify-start"}`}>
      {align === "right" && sub && <span className="text-[10px] tabular-nums text-gray-500">{sub}</span>}
      <span className="text-sm font-black tabular-nums text-gray-100">{head}</span>
      {align === "left" && sub && <span className="text-[10px] tabular-nums text-gray-500">{sub}</span>}
    </div>
  );
}

function Bar({ value, align }: { value: number | null; align: "left" | "right" }) {
  return (
    <div aria-hidden className={`mt-0.5 flex h-1 overflow-hidden rounded-full bg-brand-border ${align === "right" ? "justify-end" : "justify-start"}`}>
      {value != null && <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />}
    </div>
  );
}

export function FormGoalsBody({
  source,
  homeTeam,
  awayTeam,
  homeTeamApiId,
  awayTeamApiId,
  leagueName,
  timeZone,
}: {
  source: FormSource;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number;
  awayTeamApiId: number;
  leagueName: string | null;
  timeZone: string;
}) {
  const [size, setSize] = useState<FormWindow>(5);
  const [scope, setScope] = useState<FormScope>("ALL");
  const home = summarizeForm(source[scope].home, { teamApiId: homeTeamApiId, scope, window: size });
  const away = summarizeForm(source[scope].away, { teamApiId: awayTeamApiId, scope, window: size });
  const rows = comparisonRows(home, away);
  const scopeOptions: Array<{ value: FormScope; label: string }> = [
    { value: "ALL", label: "All" },
    { value: "VENUE", label: "Home / Away" },
    { value: "COMPETITION", label: leagueName ? "This competition" : "Competition" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Number of matches" value={size} options={FORM_WINDOWS.map((w) => ({ value: w, label: `Last ${w}` }))} onChange={setSize} />
        <Segmented label="Which matches" value={scope} options={scopeOptions} onChange={setScope} />
      </div>
      {scope === "VENUE" && (
        <p className="-mt-2 text-xs text-gray-500">
          {homeTeam}&apos;s home matches against {awayTeam}&apos;s away matches — each side as it plays today.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ["home", home, homeTeam, homeTeamApiId],
          ["away", away, awayTeam, awayTeamApiId],
        ] as const).map(([side, s, name, id]) => (
          <div key={side} className="min-w-0 space-y-2 rounded-2xl border border-brand-border bg-brand-bg/60 p-3.5">
            <div className="flex items-center gap-2">
              <TeamCrest teamApiId={id} name={name} size={18} />
              <h3 className="min-w-0 truncate text-sm font-black text-gray-100">{name}</h3>
            </div>
            <SampleLine s={s} side={side} leagueName={leagueName} timeZone={timeZone} />
            <FormStrip s={s} timeZone={timeZone} />
            <SourceMatches s={s} timeZone={timeZone} />
          </div>
        ))}
      </div>

      <table className="w-full table-fixed border-separate border-spacing-y-1.5">
        <caption className="sr-only">
          {homeTeam} and {awayTeam} compared over the same window and scope. Percentages are historical frequencies in these matches, not predictions.
        </caption>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
            <th scope="col" className="w-[36%] text-right font-bold">
              <span className="block truncate">{homeTeam}</span>
            </th>
            <th scope="col" className="w-[28%] font-bold"><span className="sr-only">Measure</span></th>
            <th scope="col" className="w-[36%] text-left font-bold">
              <span className="block truncate">{awayTeam}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="align-top">
                <ValueCell v={r.home} align="right" />
                <Bar value={r.homeBar} align="right" />
              </td>
              <th scope="row" className="px-1 text-center align-middle text-[11px] font-semibold leading-tight text-gray-400">
                {r.label}
              </th>
              <td className="align-top">
                <ValueCell v={r.away} align="left" />
                <Bar value={r.awayBar} align="left" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[11px] leading-relaxed text-gray-500">
        Historical results only — a percentage here is how often something happened in these matches, not a probability that it will happen again. Ninety-minute scores; friendlies and matches without a verified score are excluded; only matches before this fixture&apos;s kickoff count.
      </p>
    </div>
  );
}

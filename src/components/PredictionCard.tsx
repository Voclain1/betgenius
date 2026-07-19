import { Lock } from "lucide-react";
import { LeagueBadge } from "@/components/LeagueBadge";

export type PredictionRow = {
  id: string;
  category: string;
  market: string;
  pick: string;
  odds: number | null;
  confidence: number | null;
  reasoning: string;
  matchPreview?: string | null;
  locked?: boolean;
  leagueApiId?: number | null;
  leagueName?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  kickoff?: string | Date | null;
  fixture?: {
    kickoff: string | Date;
    league: { name: string };
    homeTeam: { name: string };
    awayTeam: { name: string };
  } | null;
};

const catStyles: Record<string, string> = {
  FEATURED: "bg-brand/20 text-brand",
  GENIUS: "bg-blue-500/20 text-blue-300",
  TODAY: "bg-emerald-500/20 text-emerald-300",
  BANKER: "bg-orange-500/20 text-orange-300",
  VIP: "bg-yellow-500/20 text-yellow-300",
  PREMIUM: "bg-purple-500/20 text-purple-300",
};

export function PredictionCard({ p }: { p: PredictionRow }) {
  const home = p.homeTeam ?? p.fixture?.homeTeam.name;
  const away = p.awayTeam ?? p.fixture?.awayTeam.name;
  const kickoff = p.kickoff ?? p.fixture?.kickoff;
  const leagueName = p.leagueName ?? p.fixture?.league.name;

  return (
    <article className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className={`chip ${catStyles[p.category] ?? "bg-gray-500/20"}`}>{p.category}</span>
        {kickoff && (
          <span className="text-xs text-gray-400">
            {new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {(home || leagueName) && (
        <div>
          <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} />
          {home && (
            <div className="text-lg font-semibold">
              {home} <span className="text-gray-500">vs</span> {away}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Market</div>
          <div className="text-sm font-medium">{p.market}</div>
        </div>
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Pick</div>
          <div className="text-sm font-semibold text-brand flex items-center justify-center gap-1">
            {p.locked ? <><Lock size={14} /> Locked</> : p.pick}
          </div>
        </div>
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Odds</div>
          <div className="text-sm font-medium">{p.odds ?? "—"}</div>
        </div>
      </div>
      {p.confidence !== null && p.confidence !== undefined && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>Confidence</span>
            <span>{p.confidence}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-brand-border">
            <div className="h-full rounded-full bg-brand" style={{ width: `${p.confidence}%` }} />
          </div>
        </div>
      )}
      <p className="text-sm text-gray-300 whitespace-pre-wrap">
        {p.reasoning}
      </p>
    </article>
  );
}

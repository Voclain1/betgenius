import { getGenerationStats, type WindowSummary } from "@/lib/generation/stats";

export const dynamic = "force-dynamic";

/**
 * Operational view of the scheduled generator.
 *
 * Every figure is read from rows the pipeline already writes — no separate
 * metrics store. The two numbers to watch day to day are the PENDING_REVIEW
 * backlog (nothing auto-publishes, so this is the real bottleneck) and the
 * dead-letter list (fixtures that gave up and will not retry).
 */

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md bg-brand-bg p-3">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

const ms = (v: number | null) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);
const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

function WindowCard({ title, s }: { title: string; s: WindowSummary }) {
  const providers = Object.entries(s.byProvider);
  return (
    <div className="card space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Model calls" value={s.jobs} hint={s.failedJobs > 0 ? `${s.failedJobs} failed` : undefined} />
        <Stat label="Est. cost" value={usd(s.costUsd)} hint="from stored token counts" />
        <Stat label="Fallback rate" value={s.fallbackPct == null ? "—" : `${s.fallbackPct}%`} hint="non-primary provider" />
        <Stat label="Input tokens" value={s.promptTokens.toLocaleString()} />
        <Stat label="Output tokens" value={s.outputTokens.toLocaleString()} />
        <Stat label="Latency p50 / p95" value={`${ms(s.latencyP50)} / ${ms(s.latencyP95)}`} />
      </div>
      {providers.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-400">
          {providers.map(([p, n]) => (
            <span key={p} className="chip bg-gray-500/20">{p}: {n}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function GenerationPage() {
  const stats = await getGenerationStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Generation</h1>
        <p className="text-sm text-gray-400">
          Scheduled runs produce candidates only — every prediction lands in review, nothing publishes itself.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting review" value={stats.pendingReview} hint="the real bottleneck" />
        <Stat label="Predictions created today" value={stats.predictionsCreatedToday} />
        <Stat label="Fixtures generated today" value={stats.attempts.succeededToday} />
        <Stat
          label="Football quota left"
          value={stats.usage.remaining.toLocaleString()}
          hint={`of ${(stats.usage.limit - stats.usage.reserve).toLocaleString()} today`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WindowCard title="Today" s={stats.today} />
        <WindowCard title="Last 7 days" s={stats.last7d} />
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">Attempt ledger</h2>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Pending" value={stats.attempts.pending} />
          <Stat label="Retrying" value={stats.attempts.failed} />
          <Stat label="Abandoned" value={stats.attempts.abandoned} hint="dead letter — will not retry" />
        </div>
      </div>

      {stats.retrying.length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold">Retrying</h2>
          <ul className="space-y-1 text-sm">
            {stats.retrying.map((a) => (
              <li key={a.matchKey} className="flex flex-wrap justify-between gap-2">
                <span className="text-gray-300">{a.homeTeam} vs {a.awayTeam}</span>
                <span className="text-xs text-gray-500">
                  attempt {a.attempts} · next {a.nextAttemptAt ? a.nextAttemptAt.toLocaleString() : "—"} · {a.lastError?.slice(0, 80)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.deadLetters.length > 0 && (
        <div className="card space-y-2 border-red-500/30">
          <h2 className="text-sm font-semibold text-red-300">Abandoned fixtures</h2>
          <p className="text-[11px] text-gray-500">Retries exhausted. These will not be attempted again — generate manually from the AI panel if still wanted.</p>
          <ul className="space-y-1 text-sm">
            {stats.deadLetters.map((a) => (
              <li key={a.matchKey} className="flex flex-wrap justify-between gap-2">
                <span className="text-gray-300">{a.homeTeam} vs {a.awayTeam}</span>
                <span className="text-xs text-gray-500">{a.attempts} attempts · {a.lastError?.slice(0, 90)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.enrichmentFailures.length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold">Enrichment failures</h2>
          <ul className="space-y-1 text-sm">
            {stats.enrichmentFailures.map((t) => (
              <li key={t.teamApiId} className="flex flex-wrap justify-between gap-2">
                <span className="text-gray-300">{t.teamName ?? `Team ${t.teamApiId}`}</span>
                <span className="text-xs text-gray-500">
                  {t.lastAttemptAt?.toLocaleString() ?? "never"} · {t.lastError?.slice(0, 90)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { loadFailureLists, type FailureGroup } from "@/lib/generationFailures";
import { FailureActions } from "./FailureActions";

export const dynamic = "force-dynamic";

/**
 * Every failed prediction generation, from every path (src/lib/generationFailures.ts).
 * Open failures first, with Retry and Dismiss; a match that kicked off before
 * anyone fixed it, and the week's resolved and dismissed ones, below.
 */

const when = (d: Date | null) =>
  d ? d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—";

// Provider names stay out of the admin view, as on the Generation page.
const safeDetail = (s: string | null) =>
  s?.replace(/gemini|groq/gi, "generation service").replace(/GROQ_API_KEY|GEMINI_API_KEY/gi, "provider configuration") ?? null;

function FailureRow({ g, actions, status }: { g: FailureGroup; actions: boolean; status?: string }) {
  return (
    <li className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="text-base font-bold text-gray-100">
          {g.homeTeam} <span className="font-normal text-gray-500">vs</span> {g.awayTeam}
        </div>
        <div className="text-xs text-gray-500">
          {[g.leagueName, `kick-off ${when(g.kickoff)}`, g.source].filter(Boolean).join(" · ")}
        </div>
        <p className="text-sm text-gray-200">{g.reason}</p>
        {g.detail && <p className="break-words text-xs text-gray-500">{safeDetail(g.detail)?.slice(0, 220)}</p>}
        <p className="text-xs text-gray-500">
          {g.failures === 1 ? `Failed ${when(g.lastAt)}` : `Failed ${g.failures} times, last ${when(g.lastAt)}`}
          {status ? ` · ${status}` : ""}
        </p>
      </div>
      {actions && <FailureActions id={g.id} />}
    </li>
  );
}

export default async function FailedGenerationsPage() {
  const { open, missed, closed } = await loadFailureLists();

  return (
    <div className="max-w-4xl space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Failed generations</h1>
        <p className="text-sm text-gray-400">
          Every match a prediction could not be generated for: scheduled runs, the{" "}
          <Link href="/admin/ai" className="text-brand hover:underline">generation panel</Link>, Goals, VIP/Premium and the
          other passes. A match leaves this list by itself when a later generation for it succeeds.
        </p>
      </div>

      <section>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {open.length > 0 && <AlertTriangle size={18} className="text-amber-400" aria-hidden />}
          Needs attention <span className="tabular-nums text-gray-500">{open.length}</span>
        </h2>
        {open.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">Nothing failed that is still to kick off.</p>
        ) : (
          <ul className="divide-y divide-brand-border">
            {open.map((g) => <FailureRow key={g.fixtureKey} g={g} actions />)}
          </ul>
        )}
      </section>

      {missed.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">
            Kicked off before it was fixed <span className="tabular-nums text-gray-500">{missed.length}</span>
          </h2>
          <p className="mt-1 text-xs text-gray-500">No longer actionable. Shown for a week.</p>
          <ul className="divide-y divide-brand-border">
            {missed.map((g) => <FailureRow key={g.fixtureKey} g={g} actions={false} />)}
          </ul>
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">
            Resolved or dismissed this week <span className="tabular-nums text-gray-500">{closed.length}</span>
          </h2>
          <ul className="divide-y divide-brand-border">
            {closed.map((g) => (
              <FailureRow
                key={g.fixtureKey}
                g={g}
                actions={false}
                status={g.resolvedAt ? `generated ${when(g.resolvedAt)}` : `dismissed ${when(g.dismissedAt)}`}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

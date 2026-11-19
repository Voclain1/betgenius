import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { rowViewable } from "@/lib/lockedPrediction";
import type { PredictionCategory } from "@/lib/enums";

export const dynamic = "force-dynamic";

const when = (date: Date) => new Intl.DateTimeFormat("en-NG", {
  timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short",
}).format(date);

/**
 * Stable public revision receipt. It works even if a recommendation is later
 * withdrawn; a user who saved the original receives a link to its history.
 * Never expose restricted subscribers' picks to unauthenticated visitors.
 */
export default async function PredictionUpdatePage({ params }: { params: { id: string } }) {
  const row = await prisma.prediction.findUnique({
    where: { id: params.id },
    include: {
      reassessment: true,
      revisions: { where: { publiclyVisible: true }, orderBy: { recordedAt: "desc" }, take: 30 },
      categories: true,
    },
  });
  if (!row || !row.publishedAt) notFound();
  const viewer = await getViewerEntitlement();
  const category = presentedCategory(row.category, row.categories);
  const visible = rowViewable(row,
    canViewCategory(category, viewer.tier, viewer.status, viewer.role),
    c => canViewCategory(c as PredictionCategory, viewer.tier, viewer.status, viewer.role));
  const title = [row.homeTeam, row.awayTeam].filter(Boolean).join(" vs ") || "Match prediction";
  const withdrawn = row.reassessment?.status === "WITHDRAWN";
  const flagged = row.reassessment?.status === "REVIEW_REQUIRED" && row.reassessment.publicHold;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-3">
        <Link href="/predictions" className="text-sm text-gray-400 hover:text-white">← All predictions</Link>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Prediction history</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-sm text-gray-400">
          First published {when(row.publishedAt)} · Times shown in Lagos time.
        </p>
      </div>

      {!visible ? (
        <section className="rounded-2xl border border-brand-border p-6">
          <h2 className="text-xl font-semibold">Restricted prediction</h2>
          <p className="mt-3 text-sm text-gray-400">
            This selection and its detailed review history require the appropriate
            account access. Original recommendations are preserved for authorized readers.
          </p>
          <Link href="/pricing" className="mt-4 inline-block text-sm font-semibold underline">View membership options</Link>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-brand-border p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Originally published selection</p>
            <h2 className="mt-3 text-2xl font-semibold">{row.pick}</h2>
            <p className="mt-2 text-sm text-gray-400">{row.market} · Published confidence: {row.confidence}%</p>
            {withdrawn ? (
              <p className="mt-5 font-medium text-amber-300">Withdrawn — this selection is no longer recommended.</p>
            ) : flagged ? (
              <p className="mt-5 font-medium text-amber-300">
                Reassessment required — important new information may affect this selection.
                The original prediction is preserved while the changes are reviewed.
              </p>
            ) : (
              <p className="mt-5 text-sm text-gray-400">
                A prediction is an assessment, not a guaranteed outcome.
              </p>
            )}
            {row.reassessment?.checkedAt && row.revisions.length > 0 && (
              <p className="mt-3 text-xs text-gray-500">Latest evidence check: {when(row.reassessment.checkedAt)}</p>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Update history</h2>
            {row.revisions.length ? (
              <div className="space-y-3">
                {row.revisions.map(revision => (
                  <article key={revision.id} className="rounded-2xl border border-brand-border p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-semibold">
                        {revision.kind === "WITHDRAWN" ? "Prediction withdrawn" : "New evidence identified"}
                      </h3>
                      <time className="text-xs text-gray-500">{when(revision.recordedAt)}</time>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-gray-400">{revision.reason}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No material revision has been recorded.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

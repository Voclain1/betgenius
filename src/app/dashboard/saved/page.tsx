import Link from "next/link";
import type { Metadata } from "next";
import { Bookmark } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { dashboardNavItems, loadDashboardContext } from "@/lib/dashboardContext";
import { getPersonalization, listSaved, SAVED_PAGE_SIZE } from "@/lib/personalizationData";
import { SAVED_FILTERS, parseSavedFilter, type SavedFilter } from "@/lib/personalization";
import { EmptyState, PickList, SavedRow } from "@/components/personal/DashboardParts";
import { RemoveSavedButton } from "@/components/personal/ClientBits";

export const metadata: Metadata = { title: "Saved predictions", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const FILTER_LABELS: Record<SavedFilter, string> = { all: "All", upcoming: "Upcoming", settled: "Settled", won: "Won", lost: "Lost" };

function href(filter: SavedFilter, page = 1) {
  const q = new URLSearchParams();
  if (filter !== "all") q.set("filter", filter);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return `/dashboard/saved${s ? `?${s}` : ""}`;
}

export default async function SavedPredictionsPage({ searchParams }: { searchParams: { filter?: string; page?: string } }) {
  const filter = parseSavedFilter(searchParams.filter);
  const page = Math.min(1000, Math.max(1, Math.floor(Number(searchParams.page)) || 1));
  const { session, userId, viewer, canViewMap } = await loadDashboardContext(href(filter, page));
  const [personal, { items, total, all }] = await Promise.all([getPersonalization(userId), listSaved(userId, viewer, filter, page)]);
  const tz = personal.timezone;
  const pages = Math.max(1, Math.ceil(total / SAVED_PAGE_SIZE));

  return (
    <DashboardShell items={dashboardNavItems(canViewMap)} activeKey="saved" title="Saved predictions" userEmail={session.user.email}>
      <div className="max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Saved predictions</h1>
          <p className="text-sm text-gray-400">
            Each pick is kept exactly as you saved it and settled against the final score. {all > 0 && <span className="tabular-nums">{all} saved.</span>}
          </p>
        </div>

        {all > 0 && (
          <nav aria-label="Filter saved predictions" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
            {SAVED_FILTERS.map((f) => (
              <Link
                key={f}
                href={href(f)}
                aria-current={f === filter ? "page" : undefined}
                className={`inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-sm font-semibold transition ${
                  f === filter ? "bg-gray-100 text-brand-bg" : "text-gray-400 hover:bg-brand-card hover:text-gray-100"
                }`}
              >
                {FILTER_LABELS[f]}
              </Link>
            ))}
          </nav>
        )}

        {items.length > 0 ? (
          <PickList>
            {items.map((i) => (
              <SavedRow key={i.id} item={i} timezone={tz} actions={<RemoveSavedButton predictionId={i.predictionId} savedId={i.id} />} />
            ))}
          </PickList>
        ) : all === 0 ? (
          <EmptyState
            icon={<Bookmark size={18} />}
            title="No saved predictions yet"
            body="Tap the bookmark on any prediction — on a feed, a match page or your dashboard — to keep it here. You'll see its result when the match settles."
            action={{ href: "/predictions/today", label: "Browse today's predictions" }}
          />
        ) : (
          <EmptyState title={`No ${FILTER_LABELS[filter].toLowerCase()} predictions`} body="Nothing you've saved matches this filter." action={{ href: href("all"), label: "Show all saved" }} />
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between text-sm">
            {page > 1 ? <Link className="font-semibold text-brand" href={href(filter, page - 1)}>← Newer</Link> : <span />}
            <span className="tabular-nums text-gray-500">Page {page} of {pages}</span>
            {page < pages ? <Link className="font-semibold text-brand" href={href(filter, page + 1)}>Older →</Link> : <span />}
          </div>
        )}

        <p className="text-xs text-gray-500">
          Predictions are statistical assessments, not guarantees. Please gamble responsibly — <Link href="/responsible-gambling" className="underline">get help and set limits</Link>.
        </p>
      </div>
    </DashboardShell>
  );
}

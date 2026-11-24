import Link from "next/link";
import { listIndexablePreviews } from "@/lib/matchPreview";

/**
 * Restrained crawlable list of upcoming match previews for one competition.
 * Lists ONLY previews the sitemap would list (same listIndexablePreviews), so
 * nothing noindex is ever linked as if it were indexable. Renders nothing when
 * there are none, or while MATCH_PREVIEW_MODE is not "on".
 */
export async function UpcomingPreviews({ leagueApiId, leagueName }: { leagueApiId: number | null; leagueName: string }) {
  if (leagueApiId == null) return null;
  const previews = await listIndexablePreviews({ leagueApiId, limit: 6 });
  if (previews.length === 0) return null;
  return (
    <section aria-labelledby="upcoming-previews" className="space-y-3">
      <h2 id="upcoming-previews" className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">Upcoming {leagueName} match previews</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {previews.map(({ slug, fixture }) => (
          <li key={slug}>
            <Link href={`/predictions/match/${slug}`} className="block rounded-xl border border-brand-border bg-brand-card px-4 py-3 text-sm text-gray-200 transition hover:border-brand/60">
              <span className="font-semibold">{fixture.homeTeam} vs {fixture.awayTeam}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{fixture.kickoff.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

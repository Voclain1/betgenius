import Link from "next/link";
import { matchSlug, teamSlug } from "@/lib/slug";

/**
 * Renders "Home vs Away" pointing at that fixture's match page — the single
 * place every published market for the match is collected.
 *
 * One link over the whole pairing rather than one per team: the match page is
 * the hub, and it carries prominent links onward to both team pages and the
 * league. When a row can't produce a match slug (no kickoff, or a name that
 * slugs to nothing) it falls back to the per-team links this replaced, so no
 * row loses its outbound links.
 */
export function MatchLink({
  homeTeam,
  awayTeam,
  kickoff,
  className = "hover:underline",
}: {
  homeTeam?: string | null;
  awayTeam?: string | null;
  kickoff?: string | Date | null;
  className?: string;
}) {
  if (!homeTeam) return <>—</>;

  const slug = matchSlug({ homeTeam, awayTeam, kickoff });
  if (slug) {
    return (
      <Link href={`/predictions/match/${slug}`} className={className}>
        {homeTeam} <span className="text-gray-500">vs</span> {awayTeam}
      </Link>
    );
  }

  return (
    <>
      <Link href={`/predictions/team/${teamSlug(homeTeam)}`} className={className}>
        {homeTeam}
      </Link>{" "}
      <span className="text-gray-500">vs</span>{" "}
      {awayTeam ? (
        <Link href={`/predictions/team/${teamSlug(awayTeam)}`} className={className}>
          {awayTeam}
        </Link>
      ) : (
        awayTeam
      )}
    </>
  );
}

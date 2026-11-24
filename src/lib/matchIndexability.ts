/**
 * The single indexability decision for /predictions/match/[slug] (issue #237).
 *
 * The page's `robots` metadata and the matches.xml sitemap BOTH call
 * matchPageIndexable with the same evidence result, so a URL is listed in the
 * sitemap exactly while its page says `index`. Nothing else may decide it.
 *
 * Pure: no I/O, so parity can be unit-tested without a database.
 */
import { generationTierOf } from "@/lib/leagues";

/**
 * MATCH_PREVIEW_MODE — rollout/rollback switch for pre-prediction match pages.
 *   off     today's behaviour: no published pick, no page (noindex empty shell).
 *   noindex previews render for readers but are always `noindex,follow` and
 *           never listed in the sitemap (safe soft launch, instant rollback).
 *   on      previews that clear the evidence gate ask to be indexed and are
 *           listed in matches.xml.
 * Default off; preserved across deploys by deploy/ops/merge-rollout-env.py.
 */
export type MatchPreviewMode = "off" | "noindex" | "on";

export function matchPreviewMode(value: string | undefined = process.env.MATCH_PREVIEW_MODE): MatchPreviewMode {
  return value === "on" || value === "noindex" ? value : "off";
}

/** A preview only asks for indexing inside this window before kickoff. */
export const PREVIEW_INDEX_MAX_DAYS = 14;

/** Only high-interest tiers qualify; fallback competitions render but never ask to be indexed. */
export function previewTierEligible(leagueApiId: number | null | undefined): boolean {
  const tier = generationTierOf(leagueApiId);
  return tier === "CORE" || tier === "SECONDARY";
}

export type MatchPageState = "published" | "preview" | "none";

export type MatchIndexInput = {
  state: MatchPageState;
  /** assessMatchEvidence(...).substantive for the content actually shown. */
  evidenceSubstantive: boolean;
  mode: MatchPreviewMode;
  kickoff: Date | null;
  now: Date;
  leagueApiId: number | null;
};

export function matchPageIndexable(input: MatchIndexInput): { indexable: boolean; reason: string } {
  if (input.state === "none") return { indexable: false, reason: "no-page" };
  if (!input.evidenceSubstantive) return { indexable: false, reason: "thin-evidence" };
  if (input.state === "published") return { indexable: true, reason: "published-substantive" };
  if (input.mode !== "on") return { indexable: false, reason: "preview-mode-" + input.mode };
  if (!previewTierEligible(input.leagueApiId)) return { indexable: false, reason: "preview-tier" };
  if (!input.kickoff) return { indexable: false, reason: "no-kickoff" };
  const ms = input.kickoff.getTime() - input.now.getTime();
  if (!(ms > 0) || ms > PREVIEW_INDEX_MAX_DAYS * 86_400_000) return { indexable: false, reason: "preview-outside-window" };
  return { indexable: true, reason: "preview-substantive" };
}

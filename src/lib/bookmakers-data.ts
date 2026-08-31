// Static bookmaker list behind /bookmakers. Deliberately a hand-maintained
// file rather than the Bookmaker table (prisma/schema.prisma): that table is
// the admin-managed source for the Bet Builder / combo "Join" buttons, keyed
// by whichever rows an admin has activated, while this page is a fixed
// editorial comparison of the four brands we cover. Reading it from the DB
// would make an SEO page's content depend on admin state it doesn't own.
//
// COMMERCIAL FIELDS ARE NOT POPULATED. bonusOffer, affiliateUrl, minDeposit
// and logoUrl all carry PLACEHOLDER_VALUE until real affiliate terms are
// supplied by the site owner. Nothing here may be replaced with a plausible-
// looking guess — a bonus amount or deposit minimum invented to fill a gap is
// a false commercial claim, and the affiliate-disclosure and editorial-policy
// pages both commit us against exactly that. The page renders placeholders
// visibly (see src/app/(public)/bookmakers/page.tsx) rather than hiding them,
// so an unfinished row cannot be mistaken for a finished one.
//
// When affiliateUrl is filled in, each value must be that bookmaker's own
// affiliate/referral tracking link from their programme — NOT the brand's
// generic homepage. A homepage URL renders and clicks through exactly like a
// real one, so nothing here or on the page will catch the mistake, and the
// referral simply earns nothing.
//
// Removing the placeholders is also what removes the temporary
// `robots: { index: false, follow: false }` in the page — same commit, both
// changes. See the comment on that key.

/** The single sentinel written into every field awaiting real supplied data. */
export const PLACEHOLDER_VALUE = "PLACEHOLDER — do not deploy until real data supplied";

/** True when a field still holds the sentinel rather than real supplied data. */
export function isPlaceholder(value: string | undefined): boolean {
  return value === PLACEHOLDER_VALUE;
}

export type Bookmaker = {
  name: string;
  /** URL segment / React key. Stable — it is the anchor id on the page. */
  slug: string;
  logoUrl: string;
  description: string;
  keyFeatures: string[];
  bonusOffer: string;
  affiliateUrl: string;
  minDeposit?: string;
};

// description/keyFeatures are editorial copy describing what each product is,
// written without figures, rankings or offer terms on purpose: those are the
// claims that would need sourcing, and none is available here.
export const BOOKMAKERS: Bookmaker[] = [
  {
    name: "Bet9ja",
    slug: "bet9ja",
    logoUrl: PLACEHOLDER_VALUE,
    description:
      "A Nigerian online sportsbook offering football betting alongside other sports, with pre-match and in-play markets on its web and mobile products.",
    keyFeatures: ["Football pre-match markets", "In-play betting", "Mobile web and app", "Nigerian Naira accounts"],
    bonusOffer: PLACEHOLDER_VALUE,
    affiliateUrl: PLACEHOLDER_VALUE,
    minDeposit: PLACEHOLDER_VALUE,
  },
  {
    name: "BetKing",
    slug: "betking",
    logoUrl: PLACEHOLDER_VALUE,
    description:
      "A sportsbook operating in Nigeria with football-led coverage across domestic and international competitions, available online and through retail agents.",
    keyFeatures: ["Football pre-match markets", "In-play betting", "Mobile web and app", "Nigerian Naira accounts"],
    bonusOffer: PLACEHOLDER_VALUE,
    affiliateUrl: PLACEHOLDER_VALUE,
    minDeposit: PLACEHOLDER_VALUE,
  },
  {
    name: "SportyBet",
    slug: "sportybet",
    logoUrl: PLACEHOLDER_VALUE,
    description:
      "A mobile-first sportsbook available in Nigeria, built around a lightweight app and web experience for football betting and multi-selection slips.",
    keyFeatures: ["Football pre-match markets", "In-play betting", "Mobile-first app", "Nigerian Naira accounts"],
    bonusOffer: PLACEHOLDER_VALUE,
    affiliateUrl: PLACEHOLDER_VALUE,
    minDeposit: PLACEHOLDER_VALUE,
  },
  {
    name: "1xBet",
    slug: "1xbet",
    logoUrl: PLACEHOLDER_VALUE,
    description:
      "An international sportsbook accepting Nigerian customers, with broad football coverage across leagues and cups plus a wide in-play offering.",
    keyFeatures: ["Wide football league coverage", "In-play betting", "Mobile web and app", "Nigerian Naira accounts"],
    bonusOffer: PLACEHOLDER_VALUE,
    affiliateUrl: PLACEHOLDER_VALUE,
    minDeposit: PLACEHOLDER_VALUE,
  },
];

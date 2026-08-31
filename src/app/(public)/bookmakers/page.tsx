import type { Metadata } from "next";
import Link from "next/link";
import { AffiliateDisclosure } from "@/components/AffiliateDisclosure";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { trustMetadata } from "@/lib/trustMetadata";
import { BOOKMAKERS, isPlaceholder, type Bookmaker } from "@/lib/bookmakers-data";

// Static comparison page — no DB read, no odds feed, no per-request data.
// generateMetadata rather than a `metadata` const only because the route is
// declared programmatic alongside the league/team/match pages; the title and
// description are fixed and go through trustMetadata so canonical/OG/Twitter
// match every other standalone public page.
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...trustMetadata(
      "Nigerian Bookmakers Compared",
      "Compare Nigerian bookmakers — Bet9ja, BetKing, SportyBet and 1xBet — side by side, with the features and account terms that matter before you sign up.",
      "/bookmakers",
    ),
    // Derived from the data, never hardcoded — do not "simplify" this back to
    // a literal. It has to close two opposite failures at once: shipping
    // placeholder commercial terms as indexable, and leaving the page
    // noindexed (invisible) long after real data landed. A hardcoded value
    // depends on someone editing this file in the same commit that edits
    // bookmakers-data.ts; this depends on nothing. The page becomes indexable
    // the moment the sentinels are gone, in whatever commit that happens.
    //
    // All four placeholder-bearing fields are checked, matching the set
    // bookmakers-data.ts populates with the sentinel. A partly-filled row —
    // real URL, placeholder bonus — is not publishable, so any one of them
    // still holding the sentinel keeps the whole page out of the index.
    // minDeposit is optional; isPlaceholder(undefined) is false, so a row that
    // legitimately omits it does not pin the page to noindex forever.
    //
    // follow:false travels with index:false, as before: while the page is
    // unpublishable its outbound internal links need no crawling, and every
    // page it links to is in the sitemap and the footer anyway.
    robots: BOOKMAKERS.some(
      (b) =>
        isPlaceholder(b.affiliateUrl) ||
        isPlaceholder(b.bonusOffer) ||
        isPlaceholder(b.minDeposit) ||
        isPlaceholder(b.logoUrl),
    )
      ? { index: false, follow: false }
      : undefined,
  };
}

/**
 * The page's only outbound commercial link.
 *
 * rel carries `sponsored` (this is a paid placement) and `nofollow` (belt and
 * braces: `sponsored` alone is the modern signal, but `nofollow` is what older
 * crawlers understand), plus noopener/noreferrer for the same reason
 * BookmakerJoinButton carries them on a target="_blank" link.
 *
 * While affiliateUrl is still the placeholder sentinel the anchor is rendered
 * inert — the href would otherwise be a sentence of prose, and a click would
 * open a broken tab. The attributes stay on the element either way, so what
 * ships with real URLs is the markup reviewed here.
 */
function AffiliateCta({ bookmaker }: { bookmaker: Bookmaker }) {
  const pending = isPlaceholder(bookmaker.affiliateUrl);
  return (
    <a
      href={pending ? undefined : bookmaker.affiliateUrl}
      target="_blank"
      rel="nofollow sponsored noopener noreferrer"
      aria-disabled={pending}
      className={`btn btn-primary w-full justify-center ${pending ? "pointer-events-none opacity-50" : ""}`}
    >
      {pending ? `Link pending — ${bookmaker.name}` : `Visit ${bookmaker.name}`}
    </a>
  );
}

/** One labelled row of a card's terms block; placeholder values are shown as such, never hidden. */
function Term({ label, value }: { label: string; value: string }) {
  const pending = isPlaceholder(value);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`text-sm ${pending ? "italic text-gray-500" : "text-gray-200"}`}>{value}</dd>
    </div>
  );
}

function BookmakerCard({ bookmaker }: { bookmaker: Bookmaker }) {
  return (
    <article id={bookmaker.slug} className="card flex flex-col gap-4">
      <header className="flex items-center gap-3">
        {/* No <img> while logoUrl is the sentinel — a placeholder string as a
            src is a guaranteed broken image. The monogram is the fallback. */}
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-border bg-brand-card text-sm font-bold text-gray-300"
        >
          {bookmaker.name.slice(0, 2).toUpperCase()}
        </span>
        <h2 className="text-lg font-bold">{bookmaker.name}</h2>
      </header>

      <p className="text-sm leading-6 text-gray-300">{bookmaker.description}</p>

      <ul className="space-y-1.5 text-sm text-gray-300">
        {bookmaker.keyFeatures.map((feature) => (
          <li key={feature} className="flex gap-2">
            <span aria-hidden className="text-brand">•</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <dl className="space-y-1.5 border-t border-brand-border pt-3">
        <Term label="Welcome offer" value={bookmaker.bonusOffer} />
        {bookmaker.minDeposit ? <Term label="Min deposit" value={bookmaker.minDeposit} /> : null}
      </dl>

      <div className="mt-auto pt-1">
        <AffiliateCta bookmaker={bookmaker} />
      </div>
    </article>
  );
}

export default function BookmakersPage() {
  const anyPending = BOOKMAKERS.some(
    (b) => isPlaceholder(b.affiliateUrl) || isPlaceholder(b.bonusOffer) || isPlaceholder(b.minDeposit),
  );

  return (
    <div className="space-y-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Bookmakers", path: "/bookmakers" },
        ])}
      />

      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">Bookmakers</p>
        <h1 className="text-2xl font-bold">Nigerian bookmakers compared</h1>
        <p className="max-w-3xl text-sm leading-6 text-gray-300">
          The sportsbooks Nigerian bettors most often ask us about, side by side. We list what each product is and how
          accounts work; we do not rank them, score them or claim one is better than another, because we hold no data
          that would support that. Offers and account terms change — always confirm them on the bookmaker&apos;s own site
          before depositing.
        </p>
      </header>

      {/* Visible, deliberately unmissable: commercial fields are unpopulated.
          Removing this banner is not the fix — supplying the real values in
          src/lib/bookmakers-data.ts is, and the banner disappears on its own. */}
      {anyPending ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6 text-amber-200"
        >
          <strong className="font-semibold">Not ready to publish.</strong> Welcome offers, minimum deposits, logos and
          affiliate links on this page are unpopulated placeholders. No bonus figures, deposit minimums or ratings have
          been invented to fill them. This page must not go live until real affiliate terms are supplied.
        </div>
      ) : null}

      <AffiliateDisclosure />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BOOKMAKERS.map((bookmaker) => (
          <BookmakerCard key={bookmaker.slug} bookmaker={bookmaker} />
        ))}
      </div>

      <p className="text-xs leading-6 text-gray-400">
        18+ only. Betting involves risk and you can lose your stake — never bet money you cannot afford to lose. See our{" "}
        <Link href="/responsible-gambling" className="text-brand hover:underline">responsible gambling</Link> guidance and{" "}
        <Link href="/betting-disclaimer" className="text-brand hover:underline">betting disclaimer</Link>.
      </p>
    </div>
  );
}

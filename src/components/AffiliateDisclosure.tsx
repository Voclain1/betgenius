import Link from "next/link";

export function AffiliateDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`rounded-lg border border-brand-border bg-brand-card ${compact ? "px-3 py-2" : "p-4"}`} aria-label="Affiliate disclosure">
      <p className="text-sm leading-6 text-gray-300">
        Some bookmaker links may be affiliate links. If you register or transact through one, BetGenius may receive a commission at no extra charge to you. This does not determine our analysis or prediction conclusions.{" "}
        <Link href="/affiliate-disclosure" className="font-medium text-brand hover:underline">Read our affiliate disclosure.</Link>
      </p>
    </aside>
  );
}

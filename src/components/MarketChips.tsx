import Link from "next/link";
import { MARKET_HUBS, type MarketHubKey } from "@/lib/marketHubs";

/**
 * One compact line of links to the market pages (src/lib/marketHubs.ts):
 * "Browse by market  Straight Wins · Double Chance · BTTS · Over 2.5".
 *
 * A single row that scrolls sideways on a narrow phone rather than wrapping,
 * so it never costs more than one line of height wherever it sits. `active`
 * marks the market page the reader is on.
 */
export function MarketChips({ active, className = "" }: { active?: MarketHubKey; className?: string }) {
  return (
    <nav aria-label="Browse tips by market" className={`flex items-center gap-1.5 overflow-x-auto sm:gap-2 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 sm:inline">By market</span>
      {MARKET_HUBS.map((m) => {
        const on = m.key === active;
        return (
          <Link
            key={m.key}
            href={m.href}
            prefetch={false}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${
              on ? "border-brand bg-brand text-on-brand" : "border-brand-border text-gray-300 hover:border-brand hover:text-brand"
            }`}
          >
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}

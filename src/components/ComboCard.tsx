import Link from "next/link";
import { Lock } from "lucide-react";
import { catStyles } from "@/components/PredictionCard";
import { BookmakerJoinButton, type BookmakerOption } from "@/components/BookmakerJoinButton";

export type ComboLegView = {
  id: string;
  matchLabel: string;
  market: string;
  pick: string;
  /** Real assembled price. Null on hand-built Multi Bets, which never had one. */
  odds?: number | null;
};
export type ComboView = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  /** Set only on curated odds-tier accumulators; null on manual combos. */
  oddsTier?: number | null;
  legs: ComboLegView[];
};

export function ComboCard({
  combo,
  locked,
  categoryLabel,
  bookmakers,
}: {
  combo: ComboView;
  locked: boolean;
  categoryLabel: string;
  bookmakers: BookmakerOption[];
}) {
  // Only a curated accumulator has real prices to show. A hand-built Multi Bet
  // stores the legacy placeholder, so it renders exactly as it always has.
  const isTiered = combo.oddsTier != null && combo.legs.every((l) => typeof l.odds === "number" && l.odds > 1);
  const product = isTiered ? combo.legs.reduce((p, l) => p * (l.odds as number), 1) : null;
  // The market's own price restated as a percentage, overround included. NOT a
  // confidence: no joint probability is computed or displayed anywhere here,
  // because across six legs it is not a quantity we can honestly claim.
  const implied = product ? (1 / product) * 100 : null;

  return (
    <article className="card flex flex-col gap-4">
      <div>
        <span className={`chip ${catStyles[combo.category] ?? "bg-gray-500/20"}`}>{categoryLabel}</span>
        <h2 className="mt-2 text-lg font-semibold">{combo.title}</h2>
        {combo.description && <p className="mt-1 text-sm text-gray-400">{combo.description}</p>}
      </div>

      {locked ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-brand-border bg-brand-bg py-8 text-center">
          <Lock size={22} className="text-gray-500" />
          <p className="text-sm text-gray-400">Subscribe to unlock {categoryLabel}.</p>
          <Link href="/pricing" className="btn btn-primary text-sm">Upgrade</Link>
        </div>
      ) : (
        <>
          {product !== null && (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-brand-border bg-brand-bg px-3 py-2">
              <span className="text-2xl font-bold text-brand">&times;{product.toFixed(2)}</span>
              <span className="text-xs text-gray-400">
                combined odds from {combo.legs.length} legs, at best available prices
              </span>
              {/* The counterweight to the multiple. Labelled as the MARKET's
                  number, because that is exactly what it is — the books'
                  own price, not our estimate of the chance. */}
              <span className="text-xs text-gray-500">
                Market prices this at ~{implied!.toFixed(implied! < 1 ? 2 : 1)}%
              </span>
            </div>
          )}

          <ul className="divide-y divide-brand-border rounded-lg border border-brand-border">
            {combo.legs.map((l, i) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{i + 1}. {l.matchLabel}</div>
                  <div className="truncate text-gray-400">{l.market} — {l.pick}</div>
                </div>
                {isTiered && (
                  <span className="shrink-0 font-mono text-sm text-gray-200">{(l.odds as number).toFixed(2)}</span>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link href={`/bet-builder?combo=${combo.id}`} className="btn btn-ghost flex-1 justify-center">
              Add to slip
            </Link>
            {bookmakers.map((b) => (
              <BookmakerJoinButton key={b.id} bookmaker={b} className="flex-1" />
            ))}
          </div>
        </>
      )}
    </article>
  );
}

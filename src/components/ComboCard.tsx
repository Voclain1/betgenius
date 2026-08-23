import Link from "next/link";
import { Lock } from "lucide-react";
import { catStyles } from "@/components/PredictionCard";
import { BookmakerJoinButton, type BookmakerOption } from "@/components/BookmakerJoinButton";

export type ComboLegView = { id: string; matchLabel: string; market: string; pick: string };
export type ComboView = {
  id: string;
  title: string;
  description: string | null;
  category: string;
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
          <ul className="divide-y divide-brand-border rounded-lg border border-brand-border">
            {combo.legs.map((l, i) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{i + 1}. {l.matchLabel}</div>
                  <div className="truncate text-gray-400">{l.market} — {l.pick}</div>
                </div>
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

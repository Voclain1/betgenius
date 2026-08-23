"use client";
import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { lagosTodayBounds } from "@/lib/lagosDate";

export type TipDateScope = "today-only" | "today-and-future";
export type TipOption = { id: string; label: string; market: string; pick: string; kickoff: string | null };
export type TipCategory = { key: string; label: string; locked: boolean; options: TipOption[] };

export function tipMatchesDateScope(kickoff: string | null, scope: TipDateScope, now: Date = new Date()): boolean {
  if (!kickoff) return false;
  const value = new Date(kickoff);
  if (Number.isNaN(value.getTime())) return false;
  const today = lagosTodayBounds(now);
  return scope === "today-only"
    ? value >= today.start && value < today.end
    : value >= today.start;
}

// The "pick from our tips" UI — shared between Bet Builder's manual slip
// builder and the admin Combo editor's leg picker so both stay pixel-for-
// pixel identical instead of drifting into two versions of the same list.
export function TipsPicker({
  categories,
  addedIds,
  onAdd,
  dateScope,
}: {
  categories: TipCategory[];
  addedIds: Set<string>;
  onAdd: (opt: TipOption) => void;
  dateScope: TipDateScope;
}) {
  const [activeCategory, setActiveCategory] = useState(
    () => categories.find((c) => !c.locked)?.key ?? categories[0]?.key,
  );
  const category = categories.find((c) => c.key === activeCategory);
  const visibleOptions = category?.options.filter((option) => tipMatchesDateScope(option.kickoff, dateScope)) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActiveCategory(c.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              activeCategory === c.key
                ? "bg-brand text-black"
                : c.locked
                  ? "bg-brand-bg text-gray-500 hover:bg-brand-border"
                  : "bg-brand-bg text-gray-300 hover:bg-brand-border"
            }`}
          >
            {c.label}
            {c.locked && <Lock size={11} className="shrink-0" />}
          </button>
        ))}
      </div>

      {category?.locked ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-brand-border bg-brand-bg py-8 text-center">
          <Lock size={22} className="text-gray-500" />
          <p className="text-sm text-gray-400">Subscribe to unlock {category.label}.</p>
          <Link href="/pricing" className="btn btn-primary text-sm">Upgrade</Link>
        </div>
      ) : category && visibleOptions.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">No published tips in this category yet.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-brand-border overflow-y-auto rounded-lg border border-brand-border">
          {visibleOptions.map((opt) => {
            const added = addedIds.has(opt.id);
            return (
              <li key={opt.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{opt.label}</div>
                  <div className="truncate text-gray-400">{opt.market} — {opt.pick}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => onAdd(opt)}
                    disabled={added}
                    className={`text-xs ${added ? "text-gray-500" : "text-brand hover:underline"}`}
                  >
                    {added ? "Added" : "Add"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

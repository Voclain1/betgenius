"use client";

import { useState } from "react";
import { MC_MIN_MODEL_CONFIDENCE, MC_MIN_MARKET_PROBABILITY, MC_MAX_GAP_PP, MC_MIN_BOOKMAKERS } from "@/lib/marketConfirmed";

/**
 * The Market-Confirmed badge.
 *
 * DELIBERATELY UNDERSTATED. No shield, no padlock, no checkmark, no green: all
 * four read as "verified" or "safe", and this badge means neither. It means the
 * betting market independently arrived at a similar probability — which is
 * evidence, not a guarantee, and a pick carrying it can lose. The styling
 * borrows the neutral border-and-muted-text treatment the rest of the site uses
 * for metadata rather than the emphasis it reserves for outcomes.
 *
 * Both figures are always shown together. "Model 78%" alone invites reading the
 * badge as the site vouching for itself; the whole claim is that a second,
 * independent source agrees, so the second number is the point.
 */

export type MarketConfirmation = {
  modelProbability: number;
  marketProbability: number | null;
  gapPP: number | null;
  bookmakers: number | null;
  market?: string | null;
  value?: string | null;
  quoteFetchedAt?: string | null;
};

/** Human quote age. Coarse on purpose — minute-precision implies a live feed. */
function quoteAgeLabel(fetchedAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!fetchedAt) return null;
  const t = new Date(fetchedAt);
  if (Number.isNaN(t.getTime())) return null;
  const mins = Math.max(0, Math.round((now.getTime() - t.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function MarketConfirmedBadge({ confirmation }: { confirmation: MarketConfirmation }) {
  const [open, setOpen] = useState(false);
  const age = quoteAgeLabel(confirmation.quoteFetchedAt);

  return (
    <div className="rounded-md border border-brand-border bg-brand-bg p-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-gray-200">Market-Confirmed</span>
        <span className="text-gray-400">
          Model {Math.round(confirmation.modelProbability)}%
          {confirmation.marketProbability != null && <> · Market {confirmation.marketProbability.toFixed(0)}%</>}
        </span>
        {confirmation.bookmakers != null && (
          <span className="text-gray-500">{confirmation.bookmakers} bookmakers</span>
        )}
        {age && <span className="text-gray-500">quote {age}</span>}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto rounded px-1.5 py-0.5 text-gray-400 underline underline-offset-2 hover:text-gray-200"
        >
          {open ? "Hide" : "What does this mean?"}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2 border-t border-brand-border pt-2 text-gray-400">
          <p>
            This pick was kept only because our model and the betting market independently
            reached a similar probability. It is not a guarantee, and it can lose.
          </p>
          <p>All four of these had to hold:</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Our model was at least {MC_MIN_MODEL_CONFIDENCE}% confident.</li>
            <li>
              The market priced it at {MC_MIN_MARKET_PROBABILITY}% or better, after removing the
              bookmakers&rsquo; built-in margin — raw prices add up to more than 100%, and that
              excess is their profit, not their opinion.
            </li>
            <li>The two were within {MC_MAX_GAP_PP} percentage points of each other.</li>
            <li>
              At least {MC_MIN_BOOKMAKERS} bookmakers were quoting this exact selection, on a
              price no more than two hours old.
            </li>
          </ul>
          <p>
            The figures above are what the market showed when the pick was made. Prices move
            afterwards; we do not restate them.
          </p>
        </div>
      )}
    </div>
  );
}

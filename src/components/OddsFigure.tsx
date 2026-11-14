import { formatOdds } from "@/lib/oddsFormat";

/**
 * One decimal price, the same way everywhere.
 *
 * Renders nothing when the value is missing or not a valid decimal quote, so a
 * caller can never print a made-up or broken number: it either has a price to
 * show or it shows its own "not available" wording. Screen readers hear
 * "Decimal odds 1.85" — the visual lead ("Odds ", "@ ", "×") is decoration and
 * is hidden from them, as symbols read poorly aloud. `tail` is real text that
 * is read ("when saved").
 *
 * A server component with no state: it adds no client JavaScript.
 */
export function OddsFigure({ value, lead, tail, className }: { value: unknown; lead?: string; tail?: string; className?: string }) {
  const text = formatOdds(value);
  if (text === null) return null;
  return (
    <span className={className}>
      {lead ? <span aria-hidden="true">{lead}</span> : null}
      <span className="sr-only">Decimal odds </span>
      {text}
      {tail ? <span> {tail}</span> : null}
    </span>
  );
}

import Image from "next/image";
import Link from "next/link";
import type { TrendCard as TrendCardData } from "@/lib/topTrends";
import type { TrendTone } from "@/lib/trendCards";

const TONE_CLASSES: Record<TrendTone, string> = {
  positive: "bg-brand text-on-brand",
  negative: "bg-orange-500 text-white",
  goals: "bg-sky-600 text-white",
};

/** One trend, laid out as crest-and-badge tile beside the sentence, fixture and matching price. */
export function TrendCard({ card }: { card: TrendCardData }) {
  return (
    <article className="flex gap-3 rounded-lg bg-brand-card/60 p-2">
      <div className="flex w-24 shrink-0 flex-col overflow-hidden rounded-md bg-brand-bg text-center">
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2">
          {card.crestUrl ? (
            <Image src={card.crestUrl} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
          ) : (
            <span aria-hidden className="h-9 w-9 rounded-full bg-brand-border" />
          )}
          <span className="line-clamp-2 text-xs font-semibold leading-tight">{card.teamName}</span>
        </div>
        <div className={`px-1 py-1.5 text-sm font-bold leading-tight ${TONE_CLASSES[card.badge.tone]}`}>
          {card.badge.title}
          <br />
          {card.badge.figure}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5 py-1">
        <p className="leading-snug">
          {card.sentence.map((part, i) =>
            part.figure ? (
              <strong key={i} className="font-bold text-red-500">{part.text}</strong>
            ) : part.strong ? (
              <strong key={i} className="font-bold">{part.text}</strong>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
        {card.href ? (
          <Link href={card.href} prefetch={false} className="block truncate text-sm font-semibold text-gray-400 hover:text-brand">{card.match}</Link>
        ) : (
          <p className="truncate text-sm font-semibold text-gray-400">{card.match}</p>
        )}
        <p className="text-xs text-gray-500">{card.kickoff}</p>
        {card.price && (
          <p className="text-sm leading-7" title="The bet this trend describes, at the best price from at least five bookmakers">
            {/* Non-breaking, so the last word of the bet wraps together with its price. */}
            {card.price.label}{" "}
            <span className="whitespace-nowrap">
              @ <span className="rounded border border-brand-border bg-brand-bg px-2 py-0.5 font-semibold tabular-nums">{card.price.odds.toFixed(2)}</span>
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

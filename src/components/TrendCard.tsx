import Image from "next/image";
import Link from "next/link";
import type { TrendCard as TrendCardData } from "@/lib/topTrends";
import type { TrendTone } from "@/lib/trendCards";

/** The badge's figure in its tone's colour, on the card itself: no coloured block behind status text. */
const TONE_TEXT: Record<TrendTone, string> = {
  positive: "text-brand",
  negative: "text-orange-300",
  goals: "text-blue-300",
};

export function TrendCard({ card }: { card: TrendCardData }) {
  return (
    <article className="flex gap-4 rounded-3xl border border-brand-border bg-brand-card p-4">
      <div className="flex w-20 shrink-0 flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-bg ring-1 ring-brand-border">
          {card.crestUrl ? (
            <Image src={card.crestUrl} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
          ) : (
            <span aria-hidden className="h-9 w-9 rounded-full bg-brand-border" />
          )}
        </span>
        <span className="line-clamp-2 text-xs font-bold leading-tight text-gray-100">{card.teamName}</span>
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-3xl font-black leading-none tabular-nums tracking-tight ${TONE_TEXT[card.badge.tone]}`}>{card.badge.figure}</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{card.badge.title}</span>
        </div>
        <p className="text-sm leading-snug text-gray-200">
          {card.sentence.map((part, i) =>
            part.figure ? (
              <strong key={i} className={`font-black ${TONE_TEXT[card.badge.tone]}`}>{part.text}</strong>
            ) : part.strong ? (
              <strong key={i} className="font-bold text-gray-100">{part.text}</strong>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
        <div className="border-t border-brand-border pt-2">
          {card.href ? (
            <Link href={card.href} prefetch={false} className="block truncate text-sm font-bold text-gray-300 hover:text-brand">{card.match}</Link>
          ) : (
            <p className="truncate text-sm font-bold text-gray-300">{card.match}</p>
          )}
          <p className="text-xs text-gray-500">{card.kickoff}</p>
        </div>
        {card.price && (
          <p className="text-sm leading-7 text-gray-300" title="The bet this trend describes, at the best price from at least five bookmakers">
            {/* Non-breaking, so the last word of the bet wraps together with its price. */}
            {card.price.label}{" "}
            <span className="whitespace-nowrap">
              @ <span className="rounded-lg bg-brand-bg px-2 py-0.5 font-black tabular-nums text-gray-100 ring-1 ring-brand-border">{card.price.odds.toFixed(2)}</span>
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

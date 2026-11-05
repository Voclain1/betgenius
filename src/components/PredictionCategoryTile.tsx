import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Crown,
  Flame,
  Goal,
  Layers,
  ListChecks,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const icons = {
  today: CalendarDays,
  featured: ListChecks,
  genius: Sparkles,
  banker: ShieldCheck,
  "bet-of-the-day": Flame,
  "combo-bets": Layers,
  goals: Goal,
  vip: Crown,
  premium: Crown,
};
export function PredictionCategoryTile({
  slug,
  name,
  desc,
}: {
  slug: string;
  name: string;
  desc: string;
}) {
  const Icon = icons[slug as keyof typeof icons] ?? CalendarDays;
  const paid = slug === "vip" || slug === "premium";
  return (
    <Link
      href={`/predictions/${slug}`}
      className={`category-tile ${paid ? "category-tile-member" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="category-tile-icon">
          <Icon size={21} strokeWidth={1.7} aria-hidden />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {paid ? "Members" : slug === "banker" ? "Free account" : "Explore"}
        </span>
      </div>
      <h3 className="mt-5 text-lg font-bold tracking-tight text-gray-100">
        {name}
      </h3>
      <p className="mt-2 text-sm leading-6 text-gray-400">{desc}</p>
      <span className="mt-5 flex items-center justify-between border-t border-brand-border pt-4 text-xs font-semibold text-brand">
        View predictions <ArrowUpRight size={16} aria-hidden />
      </span>
    </Link>
  );
}

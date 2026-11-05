import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  HOME_CATEGORY_LINKS,
  HOME_PERIOD_LINKS,
} from "@/lib/homeCategoryLinks";
import { MarketChips } from "@/components/MarketChips";

const descriptions = [
  "A focused shortlist",
  "The complete daily card",
  "Extra member selections",
  "Member predictions",
  "The goals perspective",
  "Selections, combined",
];
export function HomeCategoryNav() {
  return (
    <nav
      aria-label="Prediction categories"
      className="home-shortcuts editorial-shortcuts"
    >
      <div className="shortcut-heading">
        <span>FIND YOUR ANGLE</span>
        <Link href="/predictions">
          All predictions <ArrowUpRight size={15} aria-hidden />
        </Link>
      </div>
      <div className="shortcut-categories">
        {HOME_CATEGORY_LINKS.map((c, i) => (
          <Link key={c.href} href={c.href} className="shortcut-category">
            <span className="shortcut-number">
              {String(i + 1).padStart(2, "0")}
              <ArrowUpRight size={17} aria-hidden />
            </span>
            <strong>{c.label}</strong>
            <span className="shortcut-description">{descriptions[i]}</span>
          </Link>
        ))}
      </div>
      <div className="shortcut-bottom">
        <MarketChips />
        <div className="shortcut-periods">
          <span>PLAN AHEAD</span>
          {HOME_PERIOD_LINKS.map((c) => (
            <Link key={c.href} href={c.href}>
              {c.label}
              <ArrowUpRight size={13} aria-hidden />
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

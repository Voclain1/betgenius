import Link from "next/link";
import { ArrowDown, ArrowUpRight, ArrowRight } from "lucide-react";
import { HeroSlider } from "@/components/HeroSlider";
import { AnswerSummary } from "@/components/AnswerSummary";
import type { HeroSlideData } from "@/lib/heroSlides";

export function HomeMasthead({
  headline,
  summary,
  heroSlides,
}: {
  headline: string;
  summary: string;
  heroSlides: HeroSlideData[];
}) {
  const [primary, qualifier] = headline.split(" — ");
  const words = primary.split(" ");
  const last = words.pop();
  return (
    <section
      className={`home-masthead editorial-hero ${heroSlides.length ? "has-picks" : ""}`}
    >
      <div className="editorial-intro">
        <div className="editorial-eyebrow">
          <span aria-hidden>✳</span> THE FOOTBALL PERSPECTIVE
        </div>
        <h1 className="editorial-title">
          <span>{words.join(" ")}</span> <em>{last}</em>
          {qualifier && (
            <span className="editorial-qualifier"> — {qualifier}</span>
          )}
        </h1>
        <div className="editorial-summary">
          <AnswerSummary text={summary} />
        </div>
        <p className="editorial-description">
          Data-driven football predictions across every major league — banker
          picks, match winner, double chance, over/under and combo bets — each
          with a confidence rating and the reasoning behind it.
        </p>
        <div className="editorial-actions">
          <Link href="/predictions/today" className="editorial-primary">
            Explore today&apos;s tips <ArrowUpRight size={20} aria-hidden />
          </Link>
          <Link href="/pricing" className="editorial-secondary">
            Go VIP <ArrowRight size={17} aria-hidden />
          </Link>
        </div>
        <div className="editorial-footnote">
          <Link href="/methodology">
            The reasoning behind every pick{" "}
            <ArrowUpRight size={13} aria-hidden />
          </Link>
          <Link href="/track-record">
            The full results record <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>
      </div>
      {heroSlides.length > 0 && (
        <div className="editorial-spotlight">
          <div className="spotlight-label">
            <span>THE MATCHDAY EDIT</span>
            <span>
              Selected predictions <ArrowDown size={13} aria-hidden />
            </span>
          </div>
          <HeroSlider slides={heroSlides} />
        </div>
      )}
    </section>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import { ScoreCell } from "@/components/LiveScores";
import { matchSlug } from "@/lib/slug";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { textTone } from "@/lib/tone";
import type { HeroSlideData } from "@/lib/heroSlides";

/**
 * The hero's top picks of the day, one per slide (selection: lib/heroSlides).
 *
 * A native scroll-snap track, so swiping works with no gesture code and the
 * slides are ordinary links. It advances on its own every AUTOPLAY_MS, and
 * stops for good once the reader touches it (swipe, dot, hover or focus), or
 * when they prefer reduced motion. Every slide is in the markup, so the server
 * render and search engines see all the picks, not just the first.
 */
const AUTOPLAY_MS = 6000;

export function HeroSlider({ slides }: { slides: HeroSlideData[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const goTo = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const el = track.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      goTo(next);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(t);
  }, [paused, slides.length, goTo]);

  const stop = () => setPaused(true);

  return (
    // min-w-0: as a grid item the track would otherwise size to all its slides side by side.
    <div
      className="relative w-full min-w-0"
      aria-roledescription="carousel"
      aria-label="Top picks today"
      onPointerEnter={stop}
      onTouchStart={stop}
      onFocusCapture={stop}
    >
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[28px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => (
          <Slide key={s.id} slide={s} index={i} total={slides.length} />
        ))}
      </div>

      {slides.length > 1 && (
        <div className="pointer-events-none absolute bottom-5 left-5 z-10 sm:bottom-6 sm:left-7">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-2 backdrop-blur">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Show pick ${i + 1} of ${slides.length}`}
                aria-current={i === active}
                onClick={() => {
                  stop();
                  goTo(i);
                }}
                className={`h-2 rounded-full transition-all duration-300 ${i === active ? "w-5 bg-white" : "w-2 bg-white/40 hover:bg-white/70"}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Slide({ slide: s, index, total }: { slide: HeroSlideData; index: number; total: number }) {
  const slug = matchSlug(s);
  const settled = !!s.outcome && s.outcome !== "PENDING";
  const kickoff = s.kickoff ? new Date(s.kickoff) : null;

  const body = (
    <div className="relative isolate flex h-full min-h-[300px] flex-col overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,rgb(var(--card))_0%,rgb(var(--bg))_100%)] p-5 ring-1 ring-inset ring-brand-border sm:min-h-[320px] sm:p-7">
      {/* Light from the top right, as in a studio shot of the two crests. */}
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.16),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 right-10 -z-10 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.22),transparent)]" />

      <div className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.18em]">
        <span className="text-brand">Top pick {total > 1 ? `${index + 1}/${total}` : "today"}</span>
        <span className="tabular-nums tracking-[0.08em] text-gray-400" suppressHydrationWarning>
          {kickoff ? kickoff.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : ""}
        </span>
      </div>

      <div className="mt-4 flex flex-1 items-start gap-4">
        <div className="min-w-0 flex-1">
          <LeagueBadge leagueApiId={s.leagueApiId} leagueName={s.leagueName} />
          <div className="mt-2 space-y-0.5 text-[21px] font-black leading-[1.15] tracking-tight text-gray-100 [overflow-wrap:anywhere] sm:text-[26px]">
            <div className="line-clamp-2">{s.homeTeam}</div>
            <div className="line-clamp-2">
              <span className="text-gray-500">vs </span>
              {s.awayTeam}
            </div>
          </div>
        </div>

        {/* The picture: both crests on a lit tile, like the artwork on a promo slide.
            Shown at every width (it was hidden under 380px, so 360px phones had no
            crests); a little smaller there so the team names keep their room. */}
        <div
          aria-hidden
          className="relative block h-[96px] w-[96px] shrink-0 rotate-[-4deg] rounded-[26px] bg-[linear-gradient(160deg,rgba(255,255,255,0.14),rgba(255,255,255,0.02))] shadow-[0_24px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/15 min-[380px]:h-[112px] min-[380px]:w-[112px] sm:h-[150px] sm:w-[150px]"
        >
          <div className="absolute left-3 top-3 drop-shadow-[0_8px_16px_rgba(0,0,0,0.55)] sm:left-4 sm:top-4">
            <TeamCrest teamApiId={s.homeTeamApiId} name={s.homeTeam} size={56} className="max-[379px]:!h-[46px] max-[379px]:!w-[46px] sm:!h-16 sm:!w-16" />
          </div>
          <div className="absolute bottom-3 right-3 drop-shadow-[0_8px_16px_rgba(0,0,0,0.55)] sm:bottom-4 sm:right-4">
            <TeamCrest teamApiId={s.awayTeamApiId} name={s.awayTeam} size={56} className="max-[379px]:!h-[46px] max-[379px]:!w-[46px] sm:!h-16 sm:!w-16" />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4 pb-9 sm:pb-10">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">{s.market}</div>
          <div className="mt-1 break-words text-xl font-black leading-tight text-brand sm:text-2xl">{s.pick}</div>
        </div>
        <div className="shrink-0 text-right">
          {settled ? (
            <>
              <div className="text-2xl font-black leading-none tabular-nums text-gray-100">
                {s.finalHomeScore ?? "–"}–{s.finalAwayScore ?? "–"}
              </div>
              <div className={`mt-1 text-[11px] font-black uppercase tracking-[0.14em] ${textTone(OUTCOME_STYLES[s.outcome!] ?? "text-gray-400")}`}>{s.outcome}</div>
            </>
          ) : (
            <>
              <div className="text-3xl font-black leading-none tabular-nums text-gray-100">
                {s.confidence}
                <span className="text-base text-gray-500">%</span>
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Confidence</div>
              <div className="mt-1 flex justify-end">
                <ScoreCell
                  homeTeamApiId={s.homeTeamApiId}
                  awayTeamApiId={s.awayTeamApiId}
                  kickoff={s.kickoff}
                  align="right"
                  hideWhenEmpty
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full shrink-0 snap-center" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${total}`}>
      {slug ? (
        <Link href={`/predictions/match/${slug}`} className="block h-full transition hover:brightness-110">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

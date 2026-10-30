"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The match page's table of contents: one horizontal, scrollable row pinned
 * under the site header, so it costs a single line of height above the verdict
 * instead of a wrapped block of links. The section in view is marked by the
 * link's own solid background, and the row scrolls to keep it visible.
 * Small arrows at either end show which way there is more to swipe, and
 * scroll the row when tapped; each disappears once that end is reached.
 */
export function MatchSectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => setMore({ left: row.scrollLeft > 4, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 4 });
    update();
    row.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { row.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [sections]);

  const nudge = (dir: 1 | -1) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.6, behavior: "smooth" });
  const arrow = "grid h-8 w-8 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-brand-bg hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
        // First section in page order that is in the reading band.
        const first = sections.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    if (!active || !rowRef.current) return;
    const link = rowRef.current.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!link) return;
    const row = rowRef.current;
    const left = link.offsetLeft - row.clientWidth / 2 + link.clientWidth / 2;
    row.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  return (
    <nav aria-label="Match page sections" className="sticky top-16 z-30 -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="flex items-center gap-1 rounded-full border border-brand-border surface-blur p-1.5 shadow-lg shadow-black/20 backdrop-blur">
        <span className="hidden shrink-0 pl-2.5 pr-2 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 sm:block">On this page</span>
        {more.left && (
          <button type="button" aria-label="Scroll sections left" onClick={() => nudge(-1)} className={arrow}>
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div
          ref={rowRef}
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sections.map((s) => {
            const on = s.id === active;
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                data-section={s.id}
                aria-current={on ? "location" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-bold tracking-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  on ? "bg-brand text-on-brand" : "text-gray-400 hover:bg-brand-bg hover:text-gray-100"
                }`}
              >
                {s.label}
              </a>
            );
          })}
        </div>
        {more.right && (
          <button type="button" aria-label="Scroll sections right" onClick={() => nudge(1)} className={arrow}>
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </nav>
  );
}

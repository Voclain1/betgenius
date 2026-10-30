"use client";
import { useEffect, useId, useState } from "react";

type Tab = "lineups" | "news";

/**
 * The match page's "who is playing" section: starting lineups first, team
 * news one tap away, in one place instead of two panels a long scroll apart.
 *
 * Both bodies are server-rendered and stay in the HTML (the inactive one is
 * `hidden`), so crawlers and a no-JS read get both. A link to #team-news —
 * the section nav's, or an old one — opens the team-news tab; the empty
 * anchor below keeps that id on the page.
 */
export function LineupsNewsTabs({ lineups, news }: { lineups: React.ReactNode; news: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("lineups");
  const base = useId();

  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#team-news") setTab("news");
      else if (window.location.hash === "#lineups") setTab("lineups");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "lineups", label: "Lineups" },
    { id: "news", label: "Team news" },
  ];

  return (
    <div>
      <span id="team-news" aria-hidden className="block" />
      <div role="tablist" aria-label="Lineups and team news" className="mb-4 inline-flex rounded-full border border-brand-border bg-brand-card p-1">
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${base}-${t.id}-tab`}
              aria-selected={on}
              aria-controls={`${base}-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const next = tab === "lineups" ? "news" : "lineups";
                  setTab(next);
                  document.getElementById(`${base}-${next}-tab`)?.focus();
                }
              }}
              className={`rounded-full px-5 py-2 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                on ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-lineups`} aria-labelledby={`${base}-lineups-tab`} hidden={tab !== "lineups"}>
        {lineups}
      </div>
      <div role="tabpanel" id={`${base}-news`} aria-labelledby={`${base}-news-tab`} hidden={tab !== "news"}>
        <div className="rounded-3xl border border-brand-border bg-brand-card p-5">{news}</div>
      </div>
    </div>
  );
}

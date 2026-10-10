"use client";
import { useState } from "react";

/**
 * Tabs for the team page's reference sections (fixtures, squad, top players).
 *
 * Every panel is rendered into the HTML and only hidden, so crawlers read all
 * of them and switching is instant. Panels arrive as server-rendered nodes.
 */
export function TeamTabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  if (!tabs.length) return null;
  return (
    <div className="overflow-hidden rounded-3xl border border-brand-border bg-brand-card">
      <div className="border-b border-brand-border p-2">
        <div role="tablist" aria-label="Team sections" className="flex gap-1 overflow-x-auto rounded-2xl bg-brand-bg/70 p-1">
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={on}
                aria-controls={`panel-${t.id}`}
                onClick={() => setActive(t.id)}
                className={`flex-1 shrink-0 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                  on ? "bg-brand-card text-gray-100 shadow ring-1 ring-brand-border" : "text-gray-500 hover:text-gray-200"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== active} className="p-4">
          {t.content}
        </div>
      ))}
    </div>
  );
}

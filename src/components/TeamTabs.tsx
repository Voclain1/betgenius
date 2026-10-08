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
    <div className="card p-0">
      <div role="tablist" aria-label="Team sections" className="flex overflow-x-auto border-b border-brand-border">
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
              className={`relative shrink-0 px-4 py-3 text-sm font-semibold transition ${on ? "text-brand" : "text-gray-400 hover:text-gray-200"}`}
            >
              {t.label}
              {on && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" />}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== active} className="p-4">
          {t.content}
        </div>
      ))}
    </div>
  );
}

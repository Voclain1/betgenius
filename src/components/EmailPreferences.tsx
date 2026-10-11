"use client";

import { useEffect, useState } from "react";

type Prefs = { dailyPicks: boolean; announcements: boolean };

const TOGGLES: [keyof Prefs, string, string][] = [
  ["dailyPicks", "Daily picks email", "Your VIP or Premium picks each morning, while your plan is active."],
  ["announcements", "Announcements", "Occasional news about BetGenius for subscribers."],
];

/**
 * The optional emails. Receipts, payment problems and renewal reminders are
 * not listed: they are about the account itself and always sent.
 */
export function EmailPreferences() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/email-preferences")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { preferences: Prefs }) => setPrefs(j.preferences))
      .catch(() => setMessage("Email preferences couldn't be loaded."));
  }, []);

  const save = async (patch: Partial<Prefs>) => {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    const res = await fetch("/api/email-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) {
      setPrefs(previous);
      setMessage("That change wasn't saved. Please try again.");
    } else {
      setMessage(null);
    }
  };

  if (!prefs) return <section className="card text-sm text-gray-400">{message || "Loading email preferences…"}</section>;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="section-heading">Email</h2>
        <p className="text-xs text-gray-500">Receipts, payment problems and reminders before your plan ends are always sent.</p>
      </div>
      <div className="space-y-2">
        {TOGGLES.map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-2">
            <input className="mt-1" type="checkbox" checked={prefs[key]} onChange={(e) => save({ [key]: e.target.checked })} />
            <span>
              <span className="block">{label}</span>
              <span className="block text-xs text-gray-500">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      {message && <p className="text-sm text-red-400">{message}</p>}
    </section>
  );
}

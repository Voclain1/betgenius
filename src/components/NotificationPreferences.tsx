"use client";

import { useEffect, useState } from "react";

type Preferences = {
  newPredictions: boolean;
  followedAlerts: boolean;
  editorialAlerts: boolean;
  kickoffReminders: boolean;
  tipChanges: boolean;
  results: boolean;
  kickoffMinutes: number;
  timezone: string;
  quietStartMinutes: number | null;
  quietEndMinutes: number | null;
  dailyCap: number;
};

/**
 * The three independent audience controls, rendered above the finer per-kind
 * flags because they govern them. `followedAlerts` is a master switch over
 * newPredictions / tipChanges / results; `editorialAlerts` and
 * `kickoffReminders` stand on their own. Their descriptions say which, so the
 * relationship is visible rather than something a reader has to discover by
 * toggling.
 */
const AUDIENCE_TOGGLES = [
  ["followedAlerts", "Teams, leagues and matches I follow", "Covers the three settings below."],
  ["editorialAlerts", "Top predictions", "Bet of the Day and featured picks. Independent of your follows."],
  ["kickoffReminders", "Kickoff reminders", "When a match you follow is about to start."],
] as const;

const TOGGLES = [
  ["newPredictions", "New predictions"],
  ["tipChanges", "Tip changes"],
  ["results", "Results"],
] as const;

const toTime = (minutes: number | null) => (minutes == null ? "" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
const fromTime = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const inputClass = "mt-1 w-full rounded border border-brand-border bg-brand-bg px-2 py-1";

export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  // Number and text fields are edited as drafts and saved on blur, so typing
  // "30" does not first submit an invalid "3".
  const [draft, setDraft] = useState({ kickoffMinutes: "", dailyCap: "", timezone: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/notification-preferences")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((x) => {
        setPrefs(x.preferences);
        setDraft({ kickoffMinutes: String(x.preferences.kickoffMinutes), dailyCap: String(x.preferences.dailyCap), timezone: x.preferences.timezone });
      })
      .catch(() => setMessage("Could not load preferences."));
  }, []);

  if (!prefs) return <section className="card text-sm text-gray-400">{message || "Loading notification preferences…"}</section>;

  async function save(patch: Partial<Preferences>) {
    const previous = prefs;
    setPrefs({ ...prefs!, ...patch });
    const r = await fetch("/api/notification-preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (r.ok) {
      setMessage("Preferences saved.");
    } else {
      setPrefs(previous);
      setMessage("Could not save that change.");
    }
  }

  function saveNumber(field: "kickoffMinutes" | "dailyCap", min: number, max: number) {
    const value = Number(draft[field]);
    if (!Number.isInteger(value) || value < min || value > max) {
      setMessage(`Enter a whole number from ${min} to ${max}.`);
      setDraft({ ...draft, [field]: String(prefs![field]) });
      return;
    }
    if (value !== prefs![field]) save({ [field]: value });
  }

  const quietOn = prefs.quietStartMinutes != null && prefs.quietEndMinutes != null;

  return (
    <section className="card space-y-4">
      <h2 className="section-heading">Notification preferences</h2>

      <div className="space-y-2">
        {AUDIENCE_TOGGLES.map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-2">
            <input className="mt-1" type="checkbox" checked={prefs[key]} onChange={(e) => save({ [key]: e.target.checked })} />
            <span>
              <span className="block">{label}</span>
              <span className="block text-xs text-gray-500">{hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="grid gap-3 border-t border-brand-border pt-3 sm:grid-cols-2">
        {/* Visibly subordinate to "Teams, leagues and matches I follow": these
            refine what a followed alert is about, and have no effect while that
            switch is off — which is what the disabled state says. */}
        {TOGGLES.map(([key, label]) => (
          <label key={key} className={`flex items-center gap-2 ${prefs.followedAlerts ? "" : "opacity-50"}`}>
            <input type="checkbox" checked={prefs[key]} disabled={!prefs.followedAlerts} onChange={(e) => save({ [key]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Remind me (minutes before kickoff)
          <input className={inputClass} type="number" inputMode="numeric" min={5} max={180} value={draft.kickoffMinutes}
            onChange={(e) => setDraft({ ...draft, kickoffMinutes: e.target.value })} onBlur={() => saveNumber("kickoffMinutes", 5, 180)} />
        </label>
        <label className="text-sm">
          Daily limit
          <input className={inputClass} type="number" inputMode="numeric" min={1} max={50} value={draft.dailyCap}
            onChange={(e) => setDraft({ ...draft, dailyCap: e.target.value })} onBlur={() => saveNumber("dailyCap", 1, 50)} />
        </label>
        <label className="text-sm">
          Timezone
          <input className={inputClass} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            onBlur={() => { if (draft.timezone !== prefs.timezone) save({ timezone: draft.timezone }); }} />
        </label>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quietOn}
            onChange={(e) => save(e.target.checked ? { quietStartMinutes: 22 * 60, quietEndMinutes: 7 * 60 } : { quietStartMinutes: null, quietEndMinutes: null })} />
          <span>Quiet hours (no push; your inbox still updates)</span>
        </label>
        {quietOn && (
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <label className="text-sm">
              From
              <input className={inputClass} type="time" value={toTime(prefs.quietStartMinutes)}
                onChange={(e) => { const m = fromTime(e.target.value); if (m != null) save({ quietStartMinutes: m }); }} />
            </label>
            <label className="text-sm">
              Until
              <input className={inputClass} type="time" value={toTime(prefs.quietEndMinutes)}
                onChange={(e) => { const m = fromTime(e.target.value); if (m != null) save({ quietEndMinutes: m }); }} />
            </label>
          </div>
        )}
      </div>

      {message && <p className="text-sm text-brand" role="status">{message}</p>}
    </section>
  );
}

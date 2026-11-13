"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { trackEngagement } from "@/lib/engagement";
import { CompetitionPicker, MarketPicker, TeamPicker, TimezonePicker, type Option } from "@/components/personal/PreferencePickers";

export type PreferencesInitial = {
  teams: Option[];
  leagues: Option[];
  markets: string[];
  timezone: string;
};

type SaveBody = {
  teamIds?: number[];
  leagueIds?: number[];
  preferredMarkets?: string[];
  timezone?: string;
  onboarding?: "complete" | "skip";
};

async function putPreferences(body: SaveBody): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, error: typeof j.error === "string" ? j.error : "Could not save. Try again." };
  } catch {
    return { ok: false, error: "You appear to be offline. Try again." };
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function added(before: Option[], after: Option[]): number {
  const b = new Set(before.map((o) => o.id));
  return after.filter((o) => !b.has(o.id)).length;
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3 border-t border-brand-border pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-base font-bold text-gray-100">{title}</h2>
        <p className="text-sm text-gray-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * The full preferences screen. Edits are local until "Save changes", which
 * sends the whole selection in one request (one transaction server-side);
 * the server-rendered dashboard picks it up on refresh without a full reload.
 */
export function PreferencesForm({ initial, competitions, popularTeams }: { initial: PreferencesInitial; competitions: Option[]; popularTeams: Option[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [teams, setTeams] = useState(initial.teams);
  const [leagues, setLeagues] = useState(initial.leagues);
  const [markets, setMarkets] = useState(initial.markets);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const [confirmReset, setConfirmReset] = useState(false);

  const key = (o: Option[]) => o.map((x) => x.id).sort((a, b) => a - b).join(",");
  const dirty =
    key(teams) !== key(saved.teams) ||
    key(leagues) !== key(saved.leagues) ||
    [...markets].sort().join() !== [...saved.markets].sort().join() ||
    timezone !== saved.timezone;

  const save = async () => {
    if (status.kind === "saving") return;
    setStatus({ kind: "saving" });
    const res = await putPreferences({ teamIds: teams.map((t) => t.id), leagueIds: leagues.map((l) => l.id), preferredMarkets: markets, timezone });
    if (!res.ok) return setStatus({ kind: "error", message: res.error });
    const newTeams = added(saved.teams, teams);
    const newLeagues = added(saved.leagues, leagues);
    for (let i = 0; i < newTeams; i++) trackEngagement("favourite_team_add", { source: "preferences" });
    for (let i = 0; i < newLeagues; i++) trackEngagement("favourite_league_add", { source: "preferences" });
    trackEngagement("preferences_update", { teams: teams.length, leagues: leagues.length, markets: markets.length, timezone_changed: timezone !== saved.timezone ? 1 : 0 });
    setSaved({ teams, leagues, markets, timezone });
    setStatus({ kind: "saved" });
    router.refresh();
  };

  const reset = async () => {
    setStatus({ kind: "saving" });
    try {
      const r = await fetch("/api/preferences", { method: "DELETE" });
      if (!r.ok) throw new Error();
    } catch {
      return setStatus({ kind: "error", message: "Could not reset. Try again." });
    }
    const cleared = { teams: [], leagues: [], markets: [], timezone: "Africa/Lagos" };
    setTeams([]);
    setLeagues([]);
    setMarkets([]);
    setTimezone(cleared.timezone);
    setSaved(cleared);
    setConfirmReset(false);
    setStatus({ kind: "saved", message: "Preferences reset" });
    trackEngagement("preferences_reset");
    router.refresh();
  };

  const discard = () => {
    setTeams(saved.teams);
    setLeagues(saved.leagues);
    setMarkets(saved.markets);
    setTimezone(saved.timezone);
    setStatus({ kind: "idle" });
  };

  return (
    <div className="space-y-6 pb-24">
      <Section id="teams" title="Favourite teams" description="Their matches and predictions lead your dashboard. Following a team also enables its alerts if notifications are on.">
        <TeamPicker popular={popularTeams} selected={teams} onChange={setTeams} />
      </Section>
      <Section id="competitions" title="Favourite competitions" description="Leagues and cups to prioritise. Search to find any competition we cover.">
        <CompetitionPicker all={competitions} selected={leagues} onChange={setLeagues} />
      </Section>
      <Section id="markets" title="Preferred markets" description="Predictions in these markets rank higher. Leave empty to see every market equally.">
        <MarketPicker selected={markets} onChange={setMarkets} />
      </Section>
      <Section id="timezone" title="Timezone" description="Kickoff times and your dashboard date use this zone.">
        <TimezonePicker value={timezone} onChange={setTimezone} />
      </Section>
      <Section id="reset" title="Reset" description="Remove favourite teams and competitions and clear market and timezone choices. Saved predictions are kept.">
        {confirmReset ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-300">Reset all preferences?</span>
            <button type="button" onClick={reset} className="btn border border-red-400 px-3 py-1.5 text-sm text-red-300 hover:bg-brand-card">Yes, reset</button>
            <button type="button" onClick={() => setConfirmReset(false)} className="btn btn-ghost px-3 py-1.5 text-sm">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className="btn btn-ghost px-3 py-1.5 text-sm">Reset preferences</button>
        )}
      </Section>

      {/* Save bar: fixed on mobile so the action is always in reach, inline on wide screens. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-border surface-blur px-4 py-3 backdrop-blur md:sticky md:bottom-4 md:rounded-xl md:border">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm" role="status" aria-live="polite">
            {status.kind === "saving" ? (
              <span className="text-gray-400">Saving…</span>
            ) : status.kind === "error" ? (
              <span className="text-red-300">{status.message}</span>
            ) : dirty ? (
              <span className="text-gray-300">Unsaved changes</span>
            ) : status.kind === "saved" ? (
              <span className="inline-flex items-center gap-1 text-brand"><Check size={14} aria-hidden /> {status.message ?? "Saved"}</span>
            ) : (
              <span className="text-gray-500">{plural(teams.length, "team")} · {plural(leagues.length, "competition")} · {plural(markets.length, "market")}</span>
            )}
          </p>
          {dirty && <button type="button" onClick={discard} className="btn btn-ghost px-3 py-2 text-sm">Discard</button>}
          <button type="button" onClick={save} disabled={!dirty || status.kind === "saving"} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50">
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { key: "welcome", label: "Welcome" },
  { key: "competitions", label: "Competitions" },
  { key: "teams", label: "Teams" },
  { key: "markets", label: "Markets" },
  { key: "done", label: "Done" },
] as const;

/**
 * First-time setup. Five short steps, every one skippable, nothing required:
 * an account is fully usable with no preferences at all. Selections are held
 * locally and saved once, on finish, so a half-finished flow leaves nothing
 * behind. Skipping records the skip so the flow is not offered again; the
 * same choices stay editable at /dashboard/preferences.
 */
export function OnboardingFlow({ initial, competitions, popularTeams }: { initial: PreferencesInitial; competitions: Option[]; popularTeams: Option[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [teams, setTeams] = useState(initial.teams);
  const [leagues, setLeagues] = useState(initial.leagues);
  const [markets, setMarkets] = useState(initial.markets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    trackEngagement("onboarding_start");
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const current = STEPS[step];

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    // The browser's own zone, if it is one we accept, so times read right from the start; otherwise the Lagos default.
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timezone = undefined;
    }
    let res = await putPreferences({ teamIds: teams.map((t) => t.id), leagueIds: leagues.map((l) => l.id), preferredMarkets: markets, onboarding: "complete", ...(timezone && initial.timezone === "Africa/Lagos" ? { timezone } : {}) });
    if (!res.ok && timezone) res = await putPreferences({ teamIds: teams.map((t) => t.id), leagueIds: leagues.map((l) => l.id), preferredMarkets: markets, onboarding: "complete" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    trackEngagement("onboarding_complete", { teams: teams.length, leagues: leagues.length, markets: markets.length });
    setStep(STEPS.length - 1);
  };

  const skip = async () => {
    if (busy) return;
    setBusy(true);
    await putPreferences({ onboarding: "skip" });
    trackEngagement("onboarding_skip", { step: current.key });
    router.push("/dashboard");
  };

  const next = () => (step === 3 ? finish() : setStep((s) => Math.min(s + 1, STEPS.length - 1)));

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col sm:min-h-0">
      {/* Progress: a segmented bar plus words, so it reads without colour. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>
            Step {step + 1} of {STEPS.length} · <span className="text-gray-300">{current.label}</span>
          </span>
          {step < STEPS.length - 1 && (
            <button type="button" onClick={skip} disabled={busy} className="min-h-9 px-1 font-semibold text-gray-400 hover:text-gray-100">
              Skip setup
            </button>
          )}
        </div>
        <div className="grid grid-cols-5 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <span key={s.key} className={`h-1 rounded-full ${i <= step ? "bg-brand" : "bg-brand-border"}`} />
          ))}
        </div>
      </div>

      <div className="flex-1 py-8 sm:flex-none">
        {current.key === "welcome" && (
          <div className="space-y-5">
            <h1 ref={heading} tabIndex={-1} className="text-3xl font-black tracking-tight focus:outline-none sm:text-4xl">Welcome to BetGenius</h1>
            <p className="max-w-lg text-gray-300">
              Tell us what you follow and your dashboard will open on the matches and predictions that matter to you — your teams first, then your competitions and the markets you play.
            </p>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden /> Three quick choices, each optional</li>
              <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden /> Change everything later in Preferences</li>
              <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden /> Statistical predictions and match analysis — never guarantees</li>
            </ul>
          </div>
        )}
        {current.key === "competitions" && (
          <div className="space-y-4">
            <div>
              <h1 ref={heading} tabIndex={-1} className="text-2xl font-black tracking-tight focus:outline-none">Which competitions do you follow?</h1>
              <p className="text-sm text-gray-400">Pick as many as you like.</p>
            </div>
            <CompetitionPicker all={competitions} selected={leagues} onChange={setLeagues} />
          </div>
        )}
        {current.key === "teams" && (
          <div className="space-y-4">
            <div>
              <h1 ref={heading} tabIndex={-1} className="text-2xl font-black tracking-tight focus:outline-none">Your favourite teams</h1>
              <p className="text-sm text-gray-400">Clubs or national teams. Their matches lead your dashboard.</p>
            </div>
            <TeamPicker popular={popularTeams} selected={teams} onChange={setTeams} />
          </div>
        )}
        {current.key === "markets" && (
          <div className="space-y-4">
            <div>
              <h1 ref={heading} tabIndex={-1} className="text-2xl font-black tracking-tight focus:outline-none">Markets you prefer</h1>
              <p className="text-sm text-gray-400">Predictions in these markets rank higher. Skip to treat all markets equally.</p>
            </div>
            <MarketPicker selected={markets} onChange={setMarkets} />
          </div>
        )}
        {current.key === "done" && (
          <div className="space-y-5">
            <h1 ref={heading} tabIndex={-1} className="text-3xl font-black tracking-tight focus:outline-none">You&apos;re set up</h1>
            <p className="text-gray-300">
              {teams.length || leagues.length || markets.length
                ? `Following ${teams.length} team${teams.length === 1 ? "" : "s"} and ${leagues.length} competition${leagues.length === 1 ? "" : "s"}${markets.length ? `, with ${markets.length} preferred market${markets.length === 1 ? "" : "s"}` : ""}.`
                : "No preferences chosen — your dashboard will show today's top predictions. You can personalise it any time."}
            </p>
            <p className="text-sm text-gray-500">Predictions are statistical assessments, not certainties. Please play responsibly.</p>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-red-300" role="alert">{error}</p>}
      </div>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-brand-border surface-blur px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
        {step > 0 && step < STEPS.length - 1 ? (
          <button type="button" onClick={() => setStep((s) => s - 1)} disabled={busy} className="btn btn-ghost px-3 py-2.5 text-sm">
            <ArrowLeft size={16} aria-hidden /> Back
          </button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex items-center gap-3">
          {step > 0 && step < 4 && (
            <span className="hidden text-xs text-gray-500 sm:inline">
              {step === 1 ? `${leagues.length} selected` : step === 2 ? `${teams.length} selected` : `${markets.length} selected`}
            </span>
          )}
          {current.key === "done" ? (
            <Link href="/dashboard" className="btn btn-primary px-5 py-2.5 text-sm">Go to my dashboard <ArrowRight size={16} aria-hidden /></Link>
          ) : (
            <button type="button" onClick={next} disabled={busy} className="btn btn-primary px-5 py-2.5 text-sm disabled:opacity-60">
              {busy ? "Saving…" : step === 0 ? "Get started" : step === 3 ? "Finish" : "Next"} {!busy && <ArrowRight size={16} aria-hidden />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

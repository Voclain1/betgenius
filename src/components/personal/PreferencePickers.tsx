"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import { COMMON_TIMEZONES, LIMITS, PREFERENCE_MARKETS, zoneAbbreviation } from "@/lib/personalization";

export type Option = { id: number; name: string; country?: string; popular?: boolean };

/** Selected items as removable tokens. Neutral surface, not a tinted status pill. */
function SelectedTokens({ items, onRemove, kind }: { items: Option[]; onRemove: (id: number) => void; kind: "team" | "league" }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={kind === "team" ? "Selected teams" : "Selected competitions"}>
      {items.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            onClick={() => onRemove(o.id)}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-500 bg-brand-card py-1 pl-2 pr-1.5 text-sm text-gray-100 transition hover:border-red-400"
            aria-label={`Remove ${o.name}`}
          >
            {kind === "team" ? <TeamCrest teamApiId={o.id} name={o.name} size={16} /> : <LeagueBadge leagueApiId={o.id} leagueName={o.name} showName={false} size={16} />}
            <span className="max-w-[12rem] truncate">{o.name}</span>
            <X size={14} className="text-gray-500" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-brand-border bg-brand-bg pl-9 pr-3 text-[15px] text-gray-100 placeholder:text-gray-500 focus:border-gray-400 focus:outline-none"
        autoComplete="off"
        enterKeyHint="search"
      />
    </label>
  );
}

function OptionRow({ selected, disabled, onToggle, children, sub }: { selected: boolean; disabled?: boolean; onToggle: () => void; children: React.ReactNode; sub?: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled && !selected}
        aria-pressed={selected}
        className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-brand-bg/70 disabled:opacity-40"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">{children}</span>
        {sub && <span className="hidden shrink-0 text-xs text-gray-500 sm:inline">{sub}</span>}
        <span
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${selected ? "border-brand bg-brand text-on-brand" : "border-brand-border text-gray-500"}`}
          aria-hidden
        >
          {selected ? <Check size={14} strokeWidth={3} /> : <Plus size={14} />}
        </span>
      </button>
    </li>
  );
}

export function CompetitionPicker({ all, selected, onChange }: { all: Option[]; selected: Option[]; onChange: (next: Option[]) => void }) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(false);
  const ids = new Set(selected.map((s) => s.id));
  const needle = q.trim().toLowerCase();
  const matches = needle ? all.filter((o) => `${o.name} ${o.country ?? ""}`.toLowerCase().includes(needle)) : all;
  const shown = needle || expanded ? matches : matches.slice(0, 10);
  const full = selected.length >= LIMITS.leagues;
  const toggle = (o: Option) => onChange(ids.has(o.id) ? selected.filter((s) => s.id !== o.id) : full ? selected : [...selected, o]);

  return (
    <div className="space-y-3">
      <SelectedTokens items={selected} onRemove={(id) => onChange(selected.filter((s) => s.id !== id))} kind="league" />
      <SearchInput value={q} onChange={setQ} placeholder="Search competitions or countries" label="Search competitions" />
      {!needle && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Most followed</p>}
      <ul className="max-h-[22rem] divide-y divide-brand-border overflow-y-auto overscroll-contain rounded-xl border border-brand-border bg-brand-card">
        {shown.map((o) => (
          <OptionRow key={o.id} selected={ids.has(o.id)} disabled={full} onToggle={() => toggle(o)} sub={o.country}>
            <LeagueBadge leagueApiId={o.id} leagueName={o.name} showName={false} size={18} />
            <span className="truncate text-gray-100">{o.name}</span>
          </OptionRow>
        ))}
        {!shown.length && <li className="px-3 py-4 text-sm text-gray-400">No competition matches “{q}”.</li>}
      </ul>
      {!needle && !expanded && matches.length > shown.length && (
        <button type="button" onClick={() => setExpanded(true)} className="text-sm font-semibold text-brand hover:underline">
          Show all {matches.length} competitions
        </button>
      )}
      {full && <p className="text-xs text-amber-300">You can follow up to {LIMITS.leagues} competitions.</p>}
    </div>
  );
}

export function TeamPicker({ popular, selected, onChange }: { popular: Option[]; selected: Option[]; onChange: (next: Option[]) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Option[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const ids = new Set(selected.map((s) => s.id));
  const full = selected.length >= LIMITS.teams;

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const r = await fetch(`/api/preferences/teams?q=${encodeURIComponent(needle)}`, { signal: ctl.signal });
        if (!r.ok) throw new Error(r.status === 429 ? "Searching too quickly — pause a moment." : "Search failed");
        const body = await r.json();
        setResults(Array.isArray(body.teams) ? body.teams : []);
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const list = results ?? popular;
  const toggle = (o: Option) => onChange(ids.has(o.id) ? selected.filter((s) => s.id !== o.id) : full ? selected : [...selected, { id: o.id, name: o.name }]);

  return (
    <div className="space-y-3">
      <SelectedTokens items={selected} onRemove={(id) => onChange(selected.filter((s) => s.id !== id))} kind="team" />
      <SearchInput value={q} onChange={setQ} placeholder="Search clubs and national teams" label="Search teams" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500" aria-live="polite">
        {results ? (loading ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`) : loading ? "Searching…" : "Most covered teams"}
      </p>
      <ul className="max-h-[22rem] divide-y divide-brand-border overflow-y-auto overscroll-contain rounded-xl border border-brand-border bg-brand-card">
        {list.map((o) => (
          <OptionRow key={o.id} selected={ids.has(o.id)} disabled={full} onToggle={() => toggle(o)}>
            <TeamCrest teamApiId={o.id} name={o.name} size={18} />
            <span className="truncate text-gray-100">{o.name}</span>
          </OptionRow>
        ))}
        {results && !results.length && !loading && (
          <li className="px-3 py-4 text-sm text-gray-400">No team matches “{q}”. We list teams we have published predictions for.</li>
        )}
        {!results && !popular.length && <li className="px-3 py-4 text-sm text-gray-400">Search for a team by name.</li>}
      </ul>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {full && <p className="text-xs text-amber-300">You can follow up to {LIMITS.teams} teams.</p>}
    </div>
  );
}

export function MarketPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const set = new Set(selected);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {PREFERENCE_MARKETS.map((m) => {
        const on = set.has(m.type);
        return (
          <li key={m.type}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((s) => s !== m.type) : [...selected, m.type])}
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${on ? "border-gray-300 bg-brand-card" : "border-brand-border hover:border-gray-500"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-100">{m.label}</span>
                <span className="block text-xs text-gray-500">{m.hint}</span>
              </span>
              <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand bg-brand text-on-brand" : "border-brand-border text-transparent"}`} aria-hidden>
                <Check size={14} strokeWidth={3} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function allTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn("timeZone") : [...COMMON_TIMEZONES];
  } catch {
    return [...COMMON_TIMEZONES];
  }
}

export function TimezonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  // The full list comes from the browser after mount: Node and the browser
  // can ship different tz databases, and rendering it on the server would
  // risk a hydration mismatch. A stored zone outside the common list is
  // still rendered from the first paint so the select never shows a blank.
  const [zones, setZones] = useState<string[]>(() => ((COMMON_TIMEZONES as readonly string[]).includes(value) ? [] : [value]));
  useEffect(() => {
    setZones(Array.from(new Set([value, ...allTimeZones()])).filter((z) => !(COMMON_TIMEZONES as readonly string[]).includes(z)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const label = (z: string) => `${z.replace(/_/g, " ")} (${zoneAbbreviation(z)})`;
  return (
    <label className="block space-y-1.5">
      <span className="sr-only">Timezone</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-brand-border bg-brand-bg px-3 text-[15px] text-gray-100 focus:border-gray-400 focus:outline-none sm:max-w-md"
      >
        <optgroup label="Common">
          {COMMON_TIMEZONES.map((z) => (
            <option key={z} value={z}>{label(z)}</option>
          ))}
        </optgroup>
        <optgroup label="All timezones">
          {zones.map((z) => (
            <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

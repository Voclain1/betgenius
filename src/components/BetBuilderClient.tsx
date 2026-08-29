"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TipsPicker, type TipCategory, type TipOption } from "@/components/TipsPicker";
import { BookmakerJoinButton, type BookmakerOption } from "@/components/BookmakerJoinButton";
import { calculateSlip } from "@/lib/betBuilderMath";

export type { TipCategory, TipOption, BookmakerOption };

type Leg = { id: string; label: string; market: string; pick: string; odds: number | null };
type ManualDraft = Omit<Leg, "odds"> & { odds: string };

function formatSummary(legs: Leg[]) {
  if (legs.length === 0) return "No legs added yet.";
  const lines = legs.map((l, i) => `${i + 1}. ${l.label} — ${l.market}: ${l.pick}`);
  return `BetGenius picks:\n${lines.join("\n")}`;
}

export function BetBuilderClient({
  categories,
  bookmakers,
}: {
  categories: TipCategory[];
  bookmakers: BookmakerOption[];
}) {
  const searchParams = useSearchParams();
  const [legs, setLegs] = useState<Leg[]>([]);
  const [source, setSource] = useState<"manual" | "tips">("manual");
  const [draft, setDraft] = useState<ManualDraft>({ id: "", label: "", market: "1X2", pick: "Home", odds: "" });
  const [bookmakerId, setBookmakerId] = useState(bookmakers[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const [stake, setStake] = useState("10");

  const legIds = useMemo(() => new Set(legs.map((l) => l.id)), [legs]);
  const selectedBookmaker = bookmakers.find((b) => b.id === bookmakerId);
  const summaryText = formatSummary(legs);
  const calculation = useMemo(() => calculateSlip(legs, Number(stake)), [legs, stake]);
  const canContinue = legs.length > 0 && !!selectedBookmaker;

  const addTip = (opt: TipOption) => {
    if (legIds.has(opt.id)) return;
    // Functional update so rapid successive adds can't read the same stale
    // `legs` and have the second silently overwrite the first.
    setLegs((prev) => [...prev, { id: opt.id, label: opt.label, market: opt.market, pick: opt.pick, odds: null }]);
  };

  // Kept in sync so the combo-loading effect below can read the current
  // slip without depending on `legs` (which would re-run it on every add/remove).
  const legsRef = useRef(legs);
  useEffect(() => {
    legsRef.current = legs;
  }, [legs]);

  // /multi-bets "Add to slip" navigates here with ?combo=<id> — load its legs.
  // The query param and /api/combos stay on the internal name: they are the
  // Combo model's contract, not display copy.
  // into the slip on arrival. If the visitor already has legs in progress,
  // confirm before replacing rather than silently discarding their work.
  useEffect(() => {
    const comboId = searchParams.get("combo");
    if (!comboId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/combos/${comboId}`);
      if (!res.ok || cancelled) return;
      const { combo } = await res.json();
      const current = legsRef.current;
      if (
        current.length > 0 &&
        !window.confirm(`Replace your current ${current.length} leg(s) with "${combo.title}"?`)
      ) {
        window.history.replaceState(null, "", "/bet-builder");
        return;
      }
      const newLegs: Leg[] = combo.legs.map((l: any) => ({
        id: l.id,
        label: l.matchLabel,
        market: l.market,
        pick: l.pick,
        odds: null,
      }));
      setLegs(newLegs);
      setSource("manual");
      // Plain history API, not next/navigation's router — router.replace()
      // triggers an RSC round-trip that remounts this component and wipes
      // the legs we just set before they ever paint. This only needs to
      // clean the URL bar, not re-render anything server-side.
      window.history.replaceState(null, "", "/bet-builder");
    })();
    return () => {
      cancelled = true;
    };
    // Only ever act on the URL's initial ?combo= value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) — the text
      // is still visible to select/copy manually, so this is a soft failure.
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <div className="space-y-4 md:col-span-2">
        <h1 className="text-2xl font-bold">Bet builder</h1>

        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Add a leg</h2>
            <div className="inline-flex rounded-lg border border-brand-border bg-brand-bg p-1">
              {(["manual", "tips"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    source === s ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"
                  }`}
                >
                  {s === "manual" ? "Manual entry" : "From our tips"}
                </button>
              ))}
            </div>
          </div>

          {source === "manual" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-sm">Match
                  <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value, id: crypto.randomUUID() })}
                    placeholder="Arsenal vs Chelsea"
                    className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
                </label>
                <label className="text-sm">Market
                  <select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })}
                    className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
                    {["1X2", "BTTS", "Over 2.5", "Under 2.5", "Double chance", "Correct score"].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className="text-sm">Pick
                  <input value={draft.pick} onChange={(e) => setDraft({ ...draft, pick: e.target.value })}
                    className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
                </label>
                <label className="text-sm">Your bookmaker odds
                  <input type="number" min="1.01" step="0.01" inputMode="decimal"
                    value={draft.odds} onChange={(e) => setDraft({ ...draft, odds: e.target.value })}
                    placeholder="e.g. 1.90"
                    className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
                </label>
              </div>
              <button className="btn btn-primary"
                onClick={() => {
                  const odds = Number(draft.odds);
                  if (!draft.label || !Number.isFinite(odds) || odds <= 1) return;
                  setLegs((prev) => [...prev, { ...draft, odds, id: crypto.randomUUID() }]);
                  setDraft({ ...draft, label: "", pick: "Home", odds: "" });
                }}>Add leg</button>
            </>
          ) : (
            <TipsPicker categories={categories} addedIds={legIds} onAdd={addTip} dateScope="today-only" />
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold">Your legs</h2>
          {legs.length === 0 ? (
            <p className="text-sm text-gray-400">Add at least one leg to build your slip.</p>
          ) : (
            <ul className="divide-y divide-brand-border">
              {legs.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.label}</div>
                    <div className="truncate text-gray-500">{l.odds === null ? "No verified odds" : `Odds: ${l.odds.toFixed(2)}`}</div>
                    <div className="truncate text-gray-400">{l.market} — {l.pick}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => setLegs((prev) => prev.filter((x) => x.id !== l.id))}
                      className="text-xs text-gray-400 hover:text-red-400">Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="h-fit space-y-4">
        <div className="card space-y-3">
          <h2 className="font-semibold">Bet calculation</h2>
          <label className="block text-sm">Stake
            <input type="number" min="0.01" step="0.01" inputMode="decimal"
              value={stake} onChange={(e) => setStake(e.target.value)}
              className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          </label>
          {calculation ? (
            <div className="space-y-1 text-sm">
              <p>Combined odds: <strong>{calculation.combinedOdds.toFixed(2)}</strong></p>
              <p>Potential return: <strong>{calculation.potentialReturn.toFixed(2)}</strong></p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              Combined odds and potential return are available only when every leg was entered manually with your bookmaker's odds.
            </p>
          )}
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">Continue to bookmaker</h2>
          {bookmakers.length === 0 ? (
            <p className="text-sm text-gray-400">No bookmakers available yet — check back soon.</p>
          ) : (
            <>
              <label className="block text-sm">Bookmaker
                <select value={bookmakerId} onChange={(e) => setBookmakerId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
                  {bookmakers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <BookmakerJoinButton
                bookmaker={selectedBookmaker ?? bookmakers[0]}
                disabled={!canContinue}
                label={`Continue to ${selectedBookmaker?.name ?? "bookmaker"}`}
                className="w-full"
              />
            </>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-gray-400">Your selections</span>
              <button
                type="button"
                onClick={copySummary}
                disabled={legs.length === 0}
                className={`text-xs ${legs.length === 0 ? "text-gray-600" : "text-brand hover:underline"}`}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <textarea
              readOnly
              value={summaryText}
              rows={Math.min(8, Math.max(3, legs.length + 3))}
              className="w-full resize-none rounded-md border border-brand-border bg-brand-bg px-3 py-2 font-mono text-xs text-gray-300"
              onFocus={(e) => e.target.select()}
            />
            <p className="mt-1 text-xs text-gray-500">
              No slip is pre-loaded on the bookmaker's site — copy this to reference your picks while you re-enter them there.
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          BetGenius does not process bets or handle funds. Clicking through takes you to the bookmaker's own site to
          place your bet independently. 18+. Please bet responsibly.
        </p>
      </aside>
    </div>
  );
}

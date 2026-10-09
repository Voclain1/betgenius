"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TipsPicker, type TipCategory, type TipOption } from "@/components/TipsPicker";
import { BookmakerJoinButton, type BookmakerOption } from "@/components/BookmakerJoinButton";
import { calculateSlip } from "@/lib/betBuilderMath";
import { CategoryMasthead } from "@/components/CategoryMasthead";

export type { TipCategory, TipOption, BookmakerOption };

type Leg = { id: string; label: string; market: string; pick: string; odds: number | null };
type ManualDraft = Omit<Leg, "odds"> & { odds: string };

const LABEL = "text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400";
const FIELD = "mt-1.5 h-11 w-full rounded-xl border border-brand-border bg-brand-bg px-3 text-sm font-semibold normal-case tracking-normal text-gray-100 placeholder:font-normal placeholder:text-gray-500 focus:border-brand focus:outline-none";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-black text-on-brand transition hover:bg-brand-dark";

/** A panel's kicker and title, matching SectionHead on the server-rendered pages. */
function PanelTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-[3px] w-5 rounded-full bg-brand" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">{kicker}</span>
      </div>
      <h2 className="mt-1 text-xl font-black tracking-tight text-gray-100">{title}</h2>
    </div>
  );
}

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
    <div className="space-y-6 sm:space-y-8">
      <CategoryMasthead
        kicker="Tools"
        title="Bet builder"
        blurb="Build a slip from our published tips or your own selections, check the combined odds, then take it to your bookmaker."
        stats={[
          { label: legs.length === 1 ? "Leg" : "Legs", value: String(legs.length) },
          { label: "Combined odds", value: calculation ? calculation.combinedOdds.toFixed(2) : "—", accent: !!calculation },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <section className="rounded-3xl border border-brand-border bg-brand-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <PanelTitle kicker="Step 1" title="Add a leg" />
              <div className="inline-flex rounded-2xl border border-brand-border bg-brand-bg p-1">
                {(["manual", "tips"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSource(s)}
                    className={`rounded-xl px-3.5 py-2 text-sm font-bold transition ${
                      source === s ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"
                    }`}
                  >
                    {s === "manual" ? "Manual entry" : "From our tips"}
                  </button>
                ))}
              </div>
            </div>

            {source === "manual" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className={LABEL}>Match
                    <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value, id: crypto.randomUUID() })}
                      placeholder="Arsenal vs Chelsea"
                      className={FIELD} />
                  </label>
                  <label className={LABEL}>Market
                    <select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })}
                      className={FIELD}>
                      {["1X2", "BTTS", "Over 2.5", "Under 2.5", "Double chance", "Correct score"].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </label>
                  <label className={LABEL}>Pick
                    <input value={draft.pick} onChange={(e) => setDraft({ ...draft, pick: e.target.value })}
                      className={FIELD} />
                  </label>
                  <label className={LABEL}>Your bookmaker odds
                    <input type="number" min="1.01" step="0.01" inputMode="decimal"
                      value={draft.odds} onChange={(e) => setDraft({ ...draft, odds: e.target.value })}
                      placeholder="e.g. 1.90"
                      className={FIELD} />
                  </label>
                </div>
                <button className={PRIMARY}
                  onClick={() => {
                    const odds = Number(draft.odds);
                    if (!draft.label || !Number.isFinite(odds) || odds <= 1) return;
                    setLegs((prev) => [...prev, { ...draft, odds, id: crypto.randomUUID() }]);
                    setDraft({ ...draft, label: "", pick: "Home", odds: "" });
                  }}>Add leg</button>
              </div>
            ) : (
              <TipsPicker categories={categories} addedIds={legIds} onAdd={addTip} dateScope="today-only" />
            )}
          </section>

          <section className="rounded-3xl border border-brand-border bg-brand-card p-5">
            <PanelTitle kicker="Step 2" title="Your legs" />
            {legs.length === 0 ? (
              <p className="mt-4 text-sm text-gray-400">Add at least one leg to build your slip.</p>
            ) : (
              <ol className="mt-3 divide-y divide-brand-border">
                {legs.map((l, i) => (
                  <li key={l.id} className="flex items-center gap-4 py-3">
                    <span className="w-6 shrink-0 text-lg font-black tabular-nums text-brand">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-gray-100">{l.label}</div>
                      <div className="truncate text-sm text-gray-400">{l.market} — <span className="font-semibold text-gray-200">{l.pick}</span></div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-base font-black tabular-nums text-gray-100">{l.odds === null ? "—" : l.odds.toFixed(2)}</div>
                      <button onClick={() => setLegs((prev) => prev.filter((x) => x.id !== l.id))}
                        className="text-xs font-semibold text-gray-500 hover:text-red-400">Remove</button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {legs.some((l) => l.odds === null) && (
              <p className="mt-3 border-t border-brand-border pt-3 text-[11px] text-gray-500">— means no verified odds for a tip leg: enter your bookmaker&apos;s price manually to include it in the calculation.</p>
            )}
          </section>
        </div>

        <aside className="h-fit space-y-6">
          <section className="rounded-3xl border border-brand-border bg-brand-card p-5">
            <PanelTitle kicker="Step 3" title="Bet calculation" />
            <label className={`${LABEL} mt-4 block`}>Stake
              <input type="number" min="0.01" step="0.01" inputMode="decimal"
                value={stake} onChange={(e) => setStake(e.target.value)}
                className={FIELD} />
            </label>
            {calculation ? (
              <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-brand-border text-center">
                <div className="flex flex-col-reverse bg-brand-bg px-2 py-3">
                  <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Combined odds</dt>
                  <dd className="text-2xl font-black tabular-nums text-gray-100">{calculation.combinedOdds.toFixed(2)}</dd>
                </div>
                <div className="flex flex-col-reverse bg-brand-bg px-2 py-3">
                  <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Potential return</dt>
                  <dd className="text-2xl font-black tabular-nums text-brand">{calculation.potentialReturn.toFixed(2)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-gray-400">
                Combined odds and potential return are available only when every leg was entered manually with your bookmaker&apos;s odds.
              </p>
            )}
          </section>
          <section className="space-y-4 rounded-3xl border border-brand-border bg-brand-card p-5">
            <PanelTitle kicker="Step 4" title="Continue to bookmaker" />
            {bookmakers.length === 0 ? (
              <p className="text-sm text-gray-400">No bookmakers available yet — check back soon.</p>
            ) : (
              <>
                <label className={`${LABEL} block`}>Bookmaker
                  <select value={bookmakerId} onChange={(e) => setBookmakerId(e.target.value)}
                    className={FIELD}>
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

            <div className="border-t border-brand-border pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Your selections</span>
                <button
                  type="button"
                  onClick={copySummary}
                  disabled={legs.length === 0}
                  className={`text-xs font-bold ${legs.length === 0 ? "text-gray-600" : "text-brand hover:underline"}`}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <textarea
                readOnly
                value={summaryText}
                rows={Math.min(8, Math.max(3, legs.length + 3))}
                className="w-full resize-none rounded-xl border border-brand-border bg-brand-bg px-3 py-2 font-mono text-xs text-gray-300"
                onFocus={(e) => e.target.select()}
              />
              <p className="mt-1 text-xs text-gray-500">
                No slip is pre-loaded on the bookmaker&apos;s site — copy this to reference your picks while you re-enter them there.
              </p>
            </div>
          </section>

          <p className="text-xs leading-relaxed text-gray-500">
            BetGenius does not process bets or handle funds. Clicking through takes you to the bookmaker&apos;s own site to
            place your bet independently. 18+. Please bet responsibly.
          </p>
        </aside>
      </div>
    </div>
  );
}

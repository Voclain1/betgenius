"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

type Leg = { id: string; label: string; market: string; pick: string; odds: number };

export type TipOption = { id: string; label: string; market: string; pick: string; odds: number };
export type TipCategory = { key: string; label: string; locked: boolean; options: TipOption[] };
export type BookmakerOption = { id: string; name: string; affiliateUrl: string; logoUrl: string | null };

function formatSummary(legs: Leg[]) {
  if (legs.length === 0) return "No legs added yet.";
  const lines = legs.map((l, i) => `${i + 1}. ${l.label} — ${l.market}: ${l.pick} @ ${l.odds.toFixed(2)}`);
  const total = legs.reduce((a, l) => a * l.odds, 1);
  return `BetGenius picks:\n${lines.join("\n")}\n\nTotal odds: ${total.toFixed(2)}`;
}

export function BetBuilderClient({
  categories,
  bookmakers,
}: {
  categories: TipCategory[];
  bookmakers: BookmakerOption[];
}) {
  const [legs, setLegs] = useState<Leg[]>([]);
  const [stake, setStake] = useState(10);
  const [source, setSource] = useState<"manual" | "tips">("manual");
  const [draft, setDraft] = useState<Leg>({ id: "", label: "", market: "1X2", pick: "Home", odds: 1.9 });
  const [activeCategory, setActiveCategory] = useState(
    () => categories.find((c) => !c.locked)?.key ?? categories[0]?.key,
  );
  const [bookmakerId, setBookmakerId] = useState(bookmakers[0]?.id ?? "");
  const [copied, setCopied] = useState(false);

  const total = useMemo(() => legs.reduce((a, l) => a * l.odds, 1), [legs]);
  const potential = total * stake;
  const legIds = useMemo(() => new Set(legs.map((l) => l.id)), [legs]);
  const category = categories.find((c) => c.key === activeCategory);
  const selectedBookmaker = bookmakers.find((b) => b.id === bookmakerId);
  const summaryText = formatSummary(legs);
  const canContinue = legs.length > 0 && !!selectedBookmaker;

  const addTip = (opt: TipOption) => {
    if (legIds.has(opt.id)) return;
    setLegs([...legs, { id: opt.id, label: opt.label, market: opt.market, pick: opt.pick, odds: opt.odds }]);
  };

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
    <div className="grid gap-6 md:grid-cols-3">
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
                    source === s ? "bg-brand text-black" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {s === "manual" ? "Manual entry" : "From our tips"}
                </button>
              ))}
            </div>
          </div>

          {source === "manual" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
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
                <label className="text-sm">Odds
                  <input type="number" step="0.01" min="1.01" value={draft.odds}
                    onChange={(e) => setDraft({ ...draft, odds: Number(e.target.value) })}
                    className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
                </label>
              </div>
              <button className="btn btn-primary"
                onClick={() => {
                  if (!draft.label) return;
                  setLegs([...legs, { ...draft, id: crypto.randomUUID() }]);
                  setDraft({ ...draft, label: "", pick: "Home" });
                }}>Add leg</button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setActiveCategory(c.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      activeCategory === c.key
                        ? "bg-brand text-black"
                        : c.locked
                          ? "bg-brand-bg text-gray-500 hover:bg-brand-border"
                          : "bg-brand-bg text-gray-300 hover:bg-brand-border"
                    }`}
                  >
                    {c.label}
                    {c.locked && <Lock size={11} className="shrink-0" />}
                  </button>
                ))}
              </div>

              {category?.locked ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-brand-border bg-brand-bg py-8 text-center">
                  <Lock size={22} className="text-gray-500" />
                  <p className="text-sm text-gray-400">Subscribe to unlock {category.label}.</p>
                  <Link href="/pricing" className="btn btn-primary text-sm">Upgrade</Link>
                </div>
              ) : category && category.options.length === 0 ? (
                <p className="py-4 text-sm text-gray-400">No published tips in this category yet.</p>
              ) : (
                <ul className="max-h-72 divide-y divide-brand-border overflow-y-auto rounded-lg border border-brand-border">
                  {category?.options.map((opt) => {
                    const added = legIds.has(opt.id);
                    return (
                      <li key={opt.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{opt.label}</div>
                          <div className="truncate text-gray-400">{opt.market} — {opt.pick}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-brand">{opt.odds.toFixed(2)}</span>
                          <button
                            onClick={() => addTip(opt)}
                            disabled={added}
                            className={`text-xs ${added ? "text-gray-500" : "text-brand hover:underline"}`}
                          >
                            {added ? "Added" : "Add"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold">Your legs</h2>
          {legs.length === 0 ? (
            <p className="text-sm text-gray-400">Add at least one leg to build your slip.</p>
          ) : (
            <ul className="divide-y divide-brand-border">
              {legs.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{l.label}</div>
                    <div className="text-gray-400">{l.market} — {l.pick}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-brand">{l.odds.toFixed(2)}</span>
                    <button onClick={() => setLegs(legs.filter((x) => x.id !== l.id))}
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
          <h2 className="font-semibold">Summary</h2>
          <label className="block text-sm">Stake
            <input type="number" min="0" value={stake} onChange={(e) => setStake(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          </label>
          <div className="text-sm">Total odds: <span className="font-semibold text-brand">{total.toFixed(2)}</span></div>
          <div className="text-sm">Potential return: <span className="font-semibold text-brand">{potential.toFixed(2)}</span></div>
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
              <a
                href={canContinue ? selectedBookmaker!.affiliateUrl : undefined}
                target="_blank"
                rel="noopener noreferrer sponsored"
                aria-disabled={!canContinue}
                onClick={(e) => { if (!canContinue) e.preventDefault(); }}
                className={`btn btn-primary w-full justify-center ${canContinue ? "" : "pointer-events-none opacity-50"}`}
              >
                Continue to {selectedBookmaker?.name ?? "bookmaker"}
              </a>
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

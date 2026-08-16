"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { SearchIndex } from "@/lib/predictionScope";

const MAX_PER_GROUP = 5;

/**
 * Matches on prefix first, then substring — "ars" should surface Arsenal above
 * a club that merely contains those letters. Case- and accent-insensitive so
 * "atletico" finds "Atlético".
 */
function normalise(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function rank<T extends { label: string }>(items: T[], q: string): T[] {
  const needle = normalise(q);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const hay = normalise(item.label);
    const at = hay.indexOf(needle);
    if (at === -1) continue;
    // Word-boundary prefixes rank above mid-word hits.
    const boundary = at === 0 || hay[at - 1] === " ";
    scored.push({ item, score: (at === 0 ? 0 : boundary ? 1 : 2) * 1000 + at });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item);
}

type Hit = { label: string; href: string; sub?: string };

/**
 * Nav search over teams, leagues and fixtures that have published predictions.
 *
 * The index is fetched ONCE, lazily, the first time the box is focused — never
 * on page load, so the ~12KB costs nothing to readers who don't search — and
 * every keystroke after that filters in memory. That's why there's no
 * debounce: there's no request to debounce. See getSearchIndex for when this
 * should flip to a server-side query.
 */
export function SearchBox({ onNavigate, autoFocus = false }: { onNavigate?: () => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const loadIndex = async () => {
    if (index || loading) return;
    setLoading(true);
    try {
      setIndex(await fetch("/api/search").then((r) => r.json()));
    } catch {
      setIndex({ teams: [], leagues: [], matches: [] });
    } finally {
      setLoading(false);
    }
  };

  // Click-outside closes the dropdown; Escape clears and closes.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const groups = useMemo(() => {
    if (!index || query.trim().length === 0) return null;
    const q = query.trim();
    return [
      { title: "Teams", hits: rank(index.teams.map((t) => ({ label: t.name, href: `/predictions/team/${t.slug}` })), q) },
      {
        title: "Leagues",
        hits: rank(
          index.leagues.map((l) => ({ label: l.name, href: `/predictions/league/${l.slug}`, sub: l.country ?? undefined })),
          q,
        ),
      },
      {
        title: "Matches",
        hits: rank(
          index.matches.map((m) => ({ label: m.label, href: `/predictions/match/${m.slug}`, sub: m.date || undefined })),
          q,
        ),
      },
    ].map((g) => ({ ...g, hits: g.hits.slice(0, MAX_PER_GROUP) as Hit[] }));
  }, [index, query]);

  const total = groups?.reduce((n, g) => n + g.hits.length, 0) ?? 0;

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    onNavigate?.();
    router.push(href);
  };

  return (
    <div ref={boxRef} className="relative w-full md:w-44 lg:w-56 xl:w-64">
      <div className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-card px-2.5 py-1.5">
        <Search size={15} className="shrink-0 text-gray-500" />
        <input
          type="search"
          value={query}
          autoFocus={autoFocus}
          placeholder="Search teams, leagues, matches"
          onFocus={() => {
            setOpen(true);
            loadIndex();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              setOpen(false);
            }
            // Enter with exactly one hit is the common case — take it.
            if (e.key === "Enter" && total === 1) {
              const only = groups?.flatMap((g) => g.hits)[0];
              if (only) go(only.href);
            }
          }}
          // min-w-0 is what stops the input forcing the nav wider than the
          // viewport on narrow screens — the overflow class of bug from
          // earlier in this project.
          className="w-full min-w-0 bg-transparent text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="shrink-0 text-gray-500 hover:text-gray-300">
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-brand-border bg-brand-bg shadow-xl">
          {loading && <p className="px-3 py-2 text-sm text-gray-500">Loading…</p>}

          {!loading && total === 0 && (
            <p className="px-3 py-3 text-sm text-gray-400">
              No matches for &ldquo;<span className="text-gray-200">{query.trim()}</span>&rdquo;
            </p>
          )}

          {!loading &&
            groups
              ?.filter((g) => g.hits.length > 0)
              .map((g) => (
                <div key={g.title} className="border-b border-brand-border last:border-b-0">
                  <div className="px-3 pt-2 text-[10px] uppercase tracking-wide text-gray-500">{g.title}</div>
                  {g.hits.map((h) => (
                    <Link
                      key={h.href}
                      href={h.href}
                      onClick={() => {
                        setOpen(false);
                        setQuery("");
                        onNavigate?.();
                      }}
                      className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm text-gray-200 hover:bg-brand-card"
                    >
                      <span className="truncate">{h.label}</span>
                      {h.sub && <span className="shrink-0 text-xs text-gray-500">{h.sub}</span>}
                    </Link>
                  ))}
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

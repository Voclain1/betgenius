"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";

type Row = {
  id: string;
  category: string;
  categories: { category: string }[];
  status: string;
  market: string;
  pick: string;
  overUnder: string | null;
  confidence: number;
  reasoning: string;
  createdAt: string;
  leagueApiId: number | null;
  leagueName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  fixture?: { homeTeam?: { name: string }; awayTeam?: { name: string } };
};

export default function AdminPredictions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<string>("ALL");

  const load = async () => {
    const j = await fetch("/api/admin/predictions").then((r) => r.json());
    setRows(j.items);
  };
  useEffect(() => { load(); }, []);

  const act = async (id: string, action: "APPROVE" | "PUBLISH" | "ARCHIVE") => {
    await fetch(`/api/admin/predictions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this prediction? This cannot be undone.")) return;
    await fetch(`/api/admin/predictions/${id}`, { method: "DELETE" });
    load();
  };

  const shown = rows.filter((r) => filter === "ALL" || r.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Predictions</h1>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border border-brand-border bg-brand-card px-3 py-2 text-sm">
            {["ALL", "DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <Link href="/admin/predictions/new" className="btn btn-primary text-sm">Post prediction</Link>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">League</th>
              <th className="px-3 py-2">Categories</th>
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Pick</th>
              <th className="px-3 py-2">Over/Under</th>
              <th className="px-3 py-2">Conf.</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  {r.homeTeam
                    ? `${r.homeTeam} vs ${r.awayTeam}`
                    : r.fixture?.homeTeam?.name
                      ? `${r.fixture.homeTeam.name} vs ${r.fixture.awayTeam?.name}`
                      : "—"}
                </td>
                <td className="px-3 py-2">
                  <LeagueBadge leagueApiId={r.leagueApiId} leagueName={r.leagueName} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(r.categories?.length ? r.categories.map((c) => c.category) : [r.category]).map((c) => (
                      <span key={c} className="chip bg-brand-border text-[10px]">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">{r.market}</td>
                <td className="px-3 py-2 font-semibold text-brand">{r.pick}</td>
                <td className="px-3 py-2 text-gray-400">{r.overUnder ?? "—"}</td>
                <td className="px-3 py-2">{r.confidence}%</td>
                <td className="px-3 py-2"><span className="chip bg-brand-border">{r.status}</span></td>
                <td className="px-3 py-2 space-x-2 text-right whitespace-nowrap">
                  <Link href={`/admin/predictions/${r.id}`} className="text-xs text-gray-300 hover:underline">Edit</Link>
                  <button className="text-xs text-blue-400 hover:underline" onClick={() => act(r.id, "APPROVE")}>Approve</button>
                  <button className="text-xs text-brand hover:underline" onClick={() => act(r.id, "PUBLISH")}>Publish</button>
                  <button className="text-xs text-gray-400 hover:underline" onClick={() => act(r.id, "ARCHIVE")}>Archive</button>
                  <button className="text-xs text-red-400 hover:underline" onClick={() => remove(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No predictions</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

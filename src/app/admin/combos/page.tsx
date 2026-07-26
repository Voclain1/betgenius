"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { id: string; title: string; category: string; published: boolean; legs: { id: string }[] };

export default function AdminCombos() {
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    const j = await fetch("/api/admin/combos").then((r) => r.json());
    setRows(j.combos);
  };
  useEffect(() => { load(); }, []);

  const togglePublished = async (row: Row) => {
    await fetch(`/api/admin/combos/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !row.published }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this combo? This cannot be undone.")) return;
    await fetch(`/api/admin/combos/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Combos</h1>
        <Link href="/admin/combos/new" className="btn btn-primary text-sm">New combo</Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Legs</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium">{r.title}</td>
                <td className="px-3 py-2"><span className="chip bg-brand-border">{r.category}</span></td>
                <td className="px-3 py-2 text-gray-400">{r.legs.length}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => togglePublished(r)}
                    className={`chip ${r.published ? "bg-emerald-500/10 text-emerald-300" : "bg-gray-500/10 text-gray-300"}`}
                  >
                    {r.published ? "Published" : "Draft"}
                  </button>
                </td>
                <td className="px-3 py-2 space-x-2 text-right whitespace-nowrap">
                  <Link href={`/admin/combos/${r.id}`} className="text-xs text-gray-300 hover:underline">Edit</Link>
                  <button className="text-xs text-red-400 hover:underline" onClick={() => remove(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No combos yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

type Bookmaker = { id: string; name: string; logoUrl: string | null; affiliateUrl: string; active: boolean };

const emptyForm = { name: "", logoUrl: "", affiliateUrl: "" };

export default function AdminBookmakers() {
  const [rows, setRows] = useState<Bookmaker[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const load = async () => setRows((await fetch("/api/admin/bookmakers").then((r) => r.json())).bookmakers);
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.name || !form.affiliateUrl) return;
    await fetch("/api/admin/bookmakers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, affiliateUrl: form.affiliateUrl, logoUrl: form.logoUrl || null }),
    });
    setForm(emptyForm);
    load();
  };

  const startEdit = (b: Bookmaker) => {
    setEditingId(b.id);
    setEditForm({ name: b.name, logoUrl: b.logoUrl ?? "", affiliateUrl: b.affiliateUrl });
  };

  const saveEdit = async (id: string) => {
    await fetch(`/api/admin/bookmakers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editForm.name, affiliateUrl: editForm.affiliateUrl, logoUrl: editForm.logoUrl || null }),
    });
    setEditingId(null);
    load();
  };

  const toggleActive = async (b: Bookmaker) => {
    await fetch(`/api/admin/bookmakers/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !b.active }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this bookmaker?")) return;
    await fetch(`/api/admin/bookmakers/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Bookmakers</h1>
      <div className="card flex flex-wrap items-end gap-3">
        <label className="text-sm">Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bet9ja"
            className="mt-1 w-48 rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Logo URL
          <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…"
            className="mt-1 w-56 rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Affiliate URL
          <input value={form.affiliateUrl} onChange={(e) => setForm({ ...form, affiliateUrl: e.target.value })} placeholder="https://…"
            className="mt-1 w-64 rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <button className="btn btn-primary" onClick={add}>Add bookmaker</button>
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2">Bookmaker</th>
              <th className="px-3 py-2">Affiliate URL</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map((b) =>
              editingId === b.id ? (
                <tr key={b.id}>
                  <td className="px-3 py-2" colSpan={2}>
                    <div className="flex flex-wrap gap-2">
                      <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-36 rounded-md border border-brand-border bg-brand-bg px-2 py-1" />
                      <input value={editForm.logoUrl} onChange={(e) => setEditForm({ ...editForm, logoUrl: e.target.value })} placeholder="Logo URL"
                        className="w-44 rounded-md border border-brand-border bg-brand-bg px-2 py-1" />
                      <input value={editForm.affiliateUrl} onChange={(e) => setEditForm({ ...editForm, affiliateUrl: e.target.value })} placeholder="Affiliate URL"
                        className="w-56 rounded-md border border-brand-border bg-brand-bg px-2 py-1" />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`chip ${b.active ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-500/20 text-gray-400"}`}>
                      {b.active ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td className="px-3 py-2 space-x-2 text-right whitespace-nowrap">
                    <button className="text-xs text-brand hover:underline" onClick={() => saveEdit(b.id)}>Save</button>
                    <button className="text-xs text-gray-400 hover:underline" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={b.id}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {b.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.logoUrl}
                          alt=""
                          width={20}
                          height={20}
                          className="h-5 w-5 shrink-0 rounded-sm object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                      <span className="font-medium">{b.name}</span>
                    </div>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-gray-400">{b.affiliateUrl}</td>
                  <td className="px-3 py-2">
                    <span className={`chip ${b.active ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-500/20 text-gray-400"}`}>
                      {b.active ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td className="px-3 py-2 space-x-2 text-right whitespace-nowrap">
                    <button className="text-xs text-gray-300 hover:underline" onClick={() => startEdit(b)}>Edit</button>
                    <button className={`text-xs hover:underline ${b.active ? "text-yellow-400" : "text-brand"}`} onClick={() => toggleActive(b)}>
                      {b.active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="text-xs text-red-400 hover:underline" onClick={() => remove(b.id)}>Delete</button>
                  </td>
                </tr>
              ),
            )}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No bookmakers yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

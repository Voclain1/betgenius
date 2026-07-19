"use client";
import { useEffect, useState } from "react";

type Sub = {
  id: string;
  tier: string;
  status: string;
  currentPeriodEnd?: string;
  user: { email: string; name?: string };
};

export default function AdminSubscribers() {
  const [rows, setRows] = useState<Sub[]>([]);
  const load = async () => setRows((await fetch("/api/admin/subscribers").then((r) => r.json())).subscribers);
  useEffect(() => { load(); }, []);

  const act = async (id: string, action: "APPROVE" | "CANCEL" | "SET_TIER", tier?: string) => {
    await fetch(`/api/admin/subscribers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, tier }),
    });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Subscribers</h1>
      <div className="overflow-hidden rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Renews</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{s.user.name || "—"}</div>
                  <div className="text-xs text-gray-400">{s.user.email}</div>
                </td>
                <td className="px-3 py-2">{s.tier}</td>
                <td className="px-3 py-2"><span className="chip bg-brand-border">{s.status}</span></td>
                <td className="px-3 py-2 text-xs text-gray-400">
                  {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 space-x-2 text-right">
                  {s.status !== "ACTIVE" && (
                    <button className="text-xs text-brand hover:underline" onClick={() => act(s.id, "APPROVE")}>Approve</button>
                  )}
                  <button className="text-xs text-yellow-400 hover:underline" onClick={() => act(s.id, "SET_TIER", "VIP")}>Set VIP</button>
                  <button className="text-xs text-purple-400 hover:underline" onClick={() => act(s.id, "SET_TIER", "PREMIUM")}>Set Premium</button>
                  <button className="text-xs text-red-400 hover:underline" onClick={() => act(s.id, "CANCEL")}>Cancel</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

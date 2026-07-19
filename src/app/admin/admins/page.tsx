"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type Admin = { id: string; email: string; name?: string; role: string };

export default function AdminAdmins() {
  const { data } = useSession();
  const isSuper = (data?.user as any)?.role === "SUPER_ADMIN";
  const [rows, setRows] = useState<Admin[]>([]);
  const [invite, setInvite] = useState("");

  const load = async () => setRows((await fetch("/api/admin/admins").then((r) => r.json())).admins);
  useEffect(() => { load(); }, []);

  const nominate = async () => {
    if (!invite) return;
    await fetch("/api/admin/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: invite }) });
    setInvite("");
    load();
  };
  const decide = async (id: string, action: "APPROVE" | "REVOKE") => {
    await fetch(`/api/admin/admins/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Admins</h1>
      {isSuper && (
        <div className="card flex flex-wrap items-end gap-3">
          <label className="text-sm">Nominate existing user by email
            <input value={invite} onChange={(e) => setInvite(e.target.value)}
              placeholder="user@example.com"
              className="mt-1 w-72 rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          </label>
          <button className="btn btn-primary" onClick={nominate}>Nominate</button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2">{a.email}</td>
                <td className="px-3 py-2">{a.name || "—"}</td>
                <td className="px-3 py-2"><span className="chip bg-brand-border">{a.role}</span></td>
                <td className="px-3 py-2 space-x-2 text-right">
                  {isSuper && a.role === "ADMIN_PENDING" && (
                    <button className="text-xs text-brand hover:underline" onClick={() => decide(a.id, "APPROVE")}>Approve</button>
                  )}
                  {isSuper && a.role === "ADMIN" && (
                    <button className="text-xs text-red-400 hover:underline" onClick={() => decide(a.id, "REVOKE")}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

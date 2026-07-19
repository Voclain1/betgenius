"use client";
import { useEffect, useState } from "react";

type Task = {
  id: string;
  title: string;
  description?: string;
  status: string;
  dueAt?: string;
  assignedTo?: { email: string; name?: string };
};
type Admin = { id: string; email: string; name?: string; role: string };

export default function AdminTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [form, setForm] = useState({ title: "", description: "", assignedToId: "", dueAt: "" });

  const load = async () => {
    const [t, a] = await Promise.all([
      fetch("/api/admin/tasks").then((r) => r.json()),
      fetch("/api/admin/admins").then((r) => r.json()),
    ]);
    setTasks(t.tasks);
    setAdmins(a.admins.filter((x: Admin) => x.role === "ADMIN" || x.role === "SUPER_ADMIN"));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title) return;
    await fetch("/api/admin/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description || undefined,
        assignedToId: form.assignedToId || undefined,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
      }),
    });
    setForm({ title: "", description: "", assignedToId: "", dueAt: "" });
    load();
  };

  const setStatus = async (id: string, status: Task["status"]) => {
    await fetch(`/api/admin/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Admin tasks</h1>
      <div className="card grid gap-3 md:grid-cols-4">
        <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 md:col-span-2" />
        <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
          className="rounded-md border border-brand-border bg-brand-bg px-3 py-2">
          <option value="">Assign to…</option>
          {admins.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
        </select>
        <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
          className="rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        <textarea placeholder="Description" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 md:col-span-3" />
        <button className="btn btn-primary" onClick={create}>Create</button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {["OPEN", "IN_PROGRESS", "DONE"].map((col) => (
          <div key={col} className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-400">{col.replace("_", " ")}</h3>
            {tasks.filter((t) => t.status === col).map((t) => (
              <div key={t.id} className="card space-y-2">
                <div className="font-medium">{t.title}</div>
                {t.description && <div className="text-sm text-gray-400 whitespace-pre-wrap">{t.description}</div>}
                <div className="text-xs text-gray-500">
                  Assigned: {t.assignedTo?.name || t.assignedTo?.email || "—"}
                  {t.dueAt && ` · Due ${new Date(t.dueAt).toLocaleString()}`}
                </div>
                <div className="flex gap-1 text-xs">
                  {col !== "OPEN" && <button className="text-gray-400 hover:underline" onClick={() => setStatus(t.id, "OPEN")}>↤ Open</button>}
                  {col !== "IN_PROGRESS" && <button className="text-blue-400 hover:underline" onClick={() => setStatus(t.id, "IN_PROGRESS")}>In progress</button>}
                  {col !== "DONE" && <button className="text-brand hover:underline" onClick={() => setStatus(t.id, "DONE")}>Done ↦</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PREDICTION_CATEGORIES } from "@/lib/enums";

export default function NewCombo() {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", description: "", category: "FEATURED" as string, published: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!form.title) { setError("Title is required."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, description: form.description || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || j.error || "Failed to create combo");
      router.push(`/admin/combos/${j.combo.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/combos" className="text-sm text-gray-400 hover:underline">← Back to combos</Link>
        <h1 className="mt-1 text-2xl font-bold">New combo</h1>
        <p className="text-sm text-gray-400">Add legs once it's created.</p>
      </div>
      <div className="card grid gap-3 md:grid-cols-2">
        <label className="text-sm md:col-span-2">Title
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Weekend 5-fold banker"
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">Description <span className="text-gray-500">(optional)</span>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Category
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            {PREDICTION_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
          Published
        </label>
        {error && <div className="md:col-span-2 text-sm text-red-400">{error}</div>}
        <div className="md:col-span-2 flex justify-end">
          <button disabled={busy} onClick={create} className="btn btn-primary disabled:opacity-50">
            {busy ? "Creating…" : "Create combo"}
          </button>
        </div>
      </div>
    </div>
  );
}

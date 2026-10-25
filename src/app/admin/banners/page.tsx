"use client";
import { useEffect, useState } from "react";
import { BANNER_DESKTOP_SIZE, BANNER_MOBILE_SIZE, bannerStatus } from "@/lib/houseBanners";

type Banner = {
  id: string;
  title: string;
  linkUrl: string;
  sponsored: boolean;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  views: number;
  clicks: number;
  hasMobile: boolean;
  updatedAt: string;
};

const input = "w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-sm";
const toDate = (s: string | null) => (s ? new Date(s) : null);
/** datetime-local wants local "YYYY-MM-DDTHH:mm". */
const toLocalInput = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const STATUS_TONE: Record<string, string> = { Live: "text-emerald-400", Scheduled: "text-amber-400", Ended: "text-gray-500", Off: "text-gray-500" };

/**
 * House banners for the top banner slot (src/components/ads/TopBanner.tsx).
 * Upload, switch on and off, edit details and run dates, and read views and
 * clicks. With nothing live, the slot shows an Adsterra ad instead.
 */
export default function AdminBanners() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = async () => {
    const j = await fetch("/api/admin/banners").then((r) => r.json()).catch(() => ({ banners: [] }));
    setBanners(j.banners ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("sponsored", (form.elements.namedItem("sponsored") as HTMLInputElement).checked ? "true" : "false");
    for (const k of ["startsAt", "endsAt"]) {
      const v = data.get(k);
      data.set(k, typeof v === "string" && v ? new Date(v).toISOString() : "");
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/banners", { method: "POST", body: data });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(j.error ?? "Could not save the banner.");
    form.reset();
    load();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(`/api/admin/banners/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setError(j.error ?? "Could not save the change.");
    else setEditing(null);
    load();
  };

  const remove = async (b: Banner) => {
    if (!confirm(`Delete "${b.title}"? Its views and clicks go with it.`)) return;
    await fetch(`/api/admin/banners/${b.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="max-w-5xl space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Banners</h1>
        <p className="text-sm text-gray-400">
          The banner under the menu on every page that shows ads. Several live banners take turns, one per page view. With
          none live, the space shows an Adsterra ad.
        </p>
      </div>

      <form onSubmit={create} className="card space-y-4">
        <h2 className="text-lg font-bold">Add a banner</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-gray-300">Name</span>
            <input name="title" required placeholder="e.g. Premium for less, or the sponsor's name" className={input} />
            <span className="block text-xs text-gray-500">Also the image's description for screen readers.</span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-300">Link</span>
            <input name="linkUrl" type="url" required placeholder="https://" className={input} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-300">Desktop image</span>
            <input name="image" type="file" required accept="image/png,image/jpeg,image/webp,image/gif" className={input} />
            <span className="block text-xs text-gray-500">
              {BANNER_DESKTOP_SIZE.width} x {BANNER_DESKTOP_SIZE.height} px (shown at 728 x 90). PNG, JPG, WebP or GIF, up to 1 MB.
            </span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-300">Phone image (optional)</span>
            <input name="mobileImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className={input} />
            <span className="block text-xs text-gray-500">
              {BANNER_MOBILE_SIZE.width} x {BANNER_MOBILE_SIZE.height} px (full phone width, 4:1). Without it, phones crop the desktop image.
            </span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-300">Starts (optional)</span>
            <input name="startsAt" type="datetime-local" className={input} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-300">Ends (optional)</span>
            <input name="endsAt" type="datetime-local" className={input} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input name="sponsored" type="checkbox" defaultChecked />
          Paid or third-party banner: shows the small &ldquo;Ad&rdquo; tag. Untick for our own promotion.
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving} className="btn btn-primary disabled:opacity-50">
          {saving ? "Uploading…" : "Add banner"}
        </button>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">
          All banners <span className="tabular-nums text-gray-500">{banners.length}</span>
        </h2>
        {banners.length === 0 ? (
          <p className="text-sm text-gray-400">No banners yet. The top banner shows an Adsterra ad until you add one.</p>
        ) : (
          <ul className="divide-y divide-brand-border">
            {banners.map((b) => {
              const status = bannerStatus({ active: b.active, startsAt: toDate(b.startsAt), endsAt: toDate(b.endsAt) });
              const ctr = b.views > 0 ? `${((b.clicks / b.views) * 100).toFixed(1)}%` : "—";
              return (
                <li key={b.id} className="space-y-3 py-6">
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin preview from our own image route */}
                  <img
                    src={`/api/banners/${b.id}/image?size=desktop&v=${new Date(b.updatedAt).getTime()}`}
                    alt={b.title}
                    className="aspect-[728/90] w-full max-w-[728px] rounded-md object-cover"
                  />
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="text-base font-bold text-gray-100">{b.title}</div>
                      <a href={b.linkUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-brand hover:underline">
                        {b.linkUrl}
                      </a>
                      <div className="text-xs text-gray-500">
                        <span className={`font-semibold ${STATUS_TONE[status]}`}>{status}</span>
                        {" · "}
                        {b.sponsored ? "Paid / third-party (Ad tag)" : "Our own promotion"}
                        {" · "}
                        {b.hasMobile ? "Phone image set" : "No phone image"}
                        {(b.startsAt || b.endsAt) &&
                          ` · ${b.startsAt ? new Date(b.startsAt).toLocaleString() : "now"} to ${b.endsAt ? new Date(b.endsAt).toLocaleString() : "no end"}`}
                      </div>
                      <div className="text-sm tabular-nums text-gray-300">
                        {b.views.toLocaleString()} views · {b.clicks.toLocaleString()} clicks · {ctr} click rate
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-ghost text-sm" onClick={() => patch(b.id, { active: !b.active })}>
                        {b.active ? "Turn off" : "Turn on"}
                      </button>
                      <button type="button" className="btn btn-ghost text-sm" onClick={() => setEditing(editing === b.id ? null : b.id)}>
                        {editing === b.id ? "Cancel" : "Edit"}
                      </button>
                      <button type="button" className="btn btn-ghost text-sm text-red-400" onClick={() => remove(b)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {editing === b.id && (
                    <form
                      className="grid gap-3 md:grid-cols-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        patch(b.id, {
                          title: String(f.get("title") ?? ""),
                          linkUrl: String(f.get("linkUrl") ?? ""),
                          sponsored: f.get("sponsored") === "on",
                          startsAt: fromLocalInput(String(f.get("startsAt") ?? "")),
                          endsAt: fromLocalInput(String(f.get("endsAt") ?? "")),
                        });
                      }}
                    >
                      <input name="title" defaultValue={b.title} required className={input} aria-label="Name" />
                      <input name="linkUrl" type="url" defaultValue={b.linkUrl} required className={input} aria-label="Link" />
                      <input name="startsAt" type="datetime-local" defaultValue={toLocalInput(b.startsAt)} className={input} aria-label="Starts" />
                      <input name="endsAt" type="datetime-local" defaultValue={toLocalInput(b.endsAt)} className={input} aria-label="Ends" />
                      <label className="flex items-center gap-2 text-sm text-gray-300">
                        <input name="sponsored" type="checkbox" defaultChecked={b.sponsored} />
                        Shows the &ldquo;Ad&rdquo; tag
                      </label>
                      <div>
                        <button type="submit" className="btn btn-primary text-sm">Save</button>
                      </div>
                      <p className="text-xs text-gray-500 md:col-span-2">To change the images, add the new version as a new banner and delete this one.</p>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

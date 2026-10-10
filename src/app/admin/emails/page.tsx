"use client";
import { useCallback, useEffect, useState } from "react";

type AudienceRow = { id: string; label: string; count: number };
type Campaign = { id: string; subject: string; audience: string; queued: number; createdAt: string; status: Record<string, number> };
type KindRow = { kind: string; status: string; count: number };
type Failure = { id: string; kind: string; to: string; subject: string; lastError: string | null; createdAt: string };
type Data = { configured: boolean; audiences: AudienceRow[]; campaigns: Campaign[]; byKind: KindRow[]; failures: Failure[] };

const KIND_LABEL: Record<string, string> = {
  RECEIPT: "Payment receipts",
  PAYMENT_PROBLEM: "Payment problems",
  RENEWAL_REMINDER: "Renewal reminders",
  ACCESS_ENDED: "Access ended",
  DAILY_PICKS: "Daily picks",
  ANNOUNCEMENT: "Announcements",
  ADMIN_ALERT: "Admin alerts",
};

const AUTOMATIC = [
  ["Payment receipts", "When a payment unlocks VIP or Premium."],
  ["Payment problems", "45 minutes after a checkout is declined, blocked or left unfinished — unless they have paid since. At most one every three days."],
  ["Renewal reminders", "Three days before access ends, and again when it has ended."],
  ["Daily picks", "From 9am Lagos time, to active subscribers who haven't turned it off, on days with picks."],
  ["Admin alerts", "To every admin, when Paystack shows a paid checkout that unlocked nothing after 30 minutes."],
] as const;

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

export default function AdminEmails() {
  const [data, setData] = useState<Data | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL_PAID");
  const [testTo, setTestTo] = useState("");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/emails");
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const chosen = data?.audiences.find((a) => a.id === audience);
  const isDirect = audience === "DIRECT";
  // For pasted addresses the count is what was pasted; the server says which have no account.
  const pasted = [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))].length;
  const sendCount = isDirect ? pasted : chosen?.count ?? 0;

  const submit = async (action: "test" | "send") => {
    if (action === "send" && !window.confirm(`Send “${subject}” to ${sendCount} ${sendCount === 1 ? "person" : "people"}? This can't be undone.`)) return;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, subject, body, audience, testTo, emails }),
      });
      const json = await res.json();
      if (!res.ok) setMessage({ ok: false, text: json.error ?? "That didn't work." });
      else if (action === "test") setMessage({ ok: json.delivered, text: json.delivered ? `Test sent to ${json.to}.` : "The test couldn't be sent — see failures below." });
      else {
        const missing: string[] = json.notFound ?? [];
        setMessage({
          ok: true,
          text:
            `Queued for ${json.campaign.queued} ${json.campaign.queued === 1 ? "person" : "people"}; ${json.sentNow} sent so far. The rest go out over the next few minutes.` +
            (missing.length ? ` Not sent — no BetGenius account: ${missing.join(", ")}.` : ""),
        });
        setEmails("");
        setSubject("");
        setBody("");
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const kinds = data ? [...new Set(data.byKind.map((k) => k.kind))] : [];
  const count = (kind: string, status: string) => data?.byKind.find((k) => k.kind === kind && k.status === status)?.count ?? 0;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Email</h1>
        <p className="mt-1 text-sm text-gray-400">Announcements you write here, and the emails that go out automatically.</p>
      </div>

      {data && !data.configured && (
        <div className="card text-sm text-amber-200">
          Sending is off: <code>RESEND_API_KEY</code> is not set in Vercel. Nothing is queued or sent until it is.
        </div>
      )}

      <section className="card space-y-4">
        <h2 className="section-heading">New email</h2>
        <label className="block space-y-1">
          <span className="text-sm text-gray-300">Send to</span>
          <select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            {data?.audiences.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === "DIRECT" ? a.label : `${a.label} — ${a.count}`}
              </option>
            ))}
          </select>
          <span className="block text-xs text-gray-500">
            {isDirect
              ? "A personal message to named customers, e.g. about their own payment. Up to 20, registered accounts only, no unsubscribe link — use an audience for anything you'd send to many people."
              : "Counts leave out anyone who unsubscribed from announcements. Free accounts are not an audience: they never agreed to marketing email."}
          </span>
        </label>
        {isDirect && (
          <label className="block space-y-1">
            <span className="text-sm text-gray-300">Email addresses</span>
            <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="customer@gmail.com" className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
            <span className="block text-xs text-gray-500">Paste one or more, separated by commas or new lines. You can copy them from Payments or Subscribers.</span>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm text-gray-300">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-300">Message</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2 leading-6" />
          <span className="block text-xs text-gray-500">Plain text. A blank line starts a new paragraph. An unsubscribe link and the 18+ notice are added automatically.</span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-300">Send test to</span>
          <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Your own login email" className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          <span className="block text-xs text-gray-500">Leave empty to use the email you are signed in with.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy || !subject.trim() || !body.trim()} onClick={() => submit("test")} className="btn btn-ghost disabled:opacity-50">
            {busy === "test" ? "Sending test…" : "Send test"}
          </button>
          <button type="button" disabled={!!busy || !subject.trim() || !body.trim() || !sendCount} onClick={() => submit("send")} className="btn btn-primary disabled:opacity-50">
            {busy === "send" ? "Sending…" : `Send to ${sendCount}`}
          </button>
        </div>
        {message && <p className={`text-sm ${message.ok ? "text-gray-200" : "text-red-400"}`}>{message.text}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="section-heading">Past announcements</h2>
        {data?.campaigns.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400">
              <tr><th className="py-2">Subject</th><th>Audience</th><th>Sent</th><th>Pending</th><th>Failed</th><th>When</th></tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id} className="border-t border-brand-border">
                  <td className="py-2 pr-3">{c.subject}</td>
                  <td className="pr-3 text-gray-400">{c.audience}</td>
                  <td>{c.status.SENT ?? 0}</td>
                  <td>{c.status.PENDING ?? 0}</td>
                  <td className={c.status.FAILED ? "text-red-400" : ""}>{c.status.FAILED ?? 0}</td>
                  <td className="text-gray-400">{fmt(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">None yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-heading">Automatic emails</h2>
        <ul className="space-y-1 text-sm">
          {AUTOMATIC.map(([name, when]) => (
            <li key={name}><span className="font-medium text-gray-100">{name}.</span> <span className="text-gray-400">{when}</span></li>
          ))}
        </ul>
        <h3 className="pt-2 text-sm font-semibold text-gray-300">Last 7 days</h3>
        {kinds.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400">
              <tr><th className="py-2">Kind</th><th>Sent</th><th>Pending</th><th>Skipped</th><th>Failed</th></tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k} className="border-t border-brand-border">
                  <td className="py-2">{KIND_LABEL[k] ?? k}</td>
                  <td>{count(k, "SENT")}</td>
                  <td>{count(k, "PENDING")}</td>
                  <td>{count(k, "SKIPPED")}</td>
                  <td className={count(k, "FAILED") ? "text-red-400" : ""}>{count(k, "FAILED")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">No emails in the last 7 days.</p>
        )}
        {!!data?.failures.length && (
          <>
            <h3 className="pt-2 text-sm font-semibold text-gray-300">Failed sends</h3>
            <ul className="space-y-1 text-sm">
              {data.failures.map((f) => (
                <li key={f.id} className="text-gray-400">
                  {fmt(f.createdAt)} · {KIND_LABEL[f.kind] ?? f.kind} to {f.to}: <span className="text-red-400">{f.lastError ?? "unknown error"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

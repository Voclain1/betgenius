"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr("Those passwords don't match");
      return;
    }
    setPending(true);
    const res = await fetch("/api/password-reset/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    setPending(false);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setErr(body?.error ?? "Could not reset your password. Request a new link.");
      return;
    }
    // Straight to log in rather than signing them in from here. Signing in
    // would mean the endpoint handing the account's email back to whoever holds
    // the link, and the link is the only thing proven at this point — it is not
    // worth disclosing who the account belongs to just to save one form.
    router.push("/login?reset=1");
  };

  if (!token) {
    return (
      <div className="card space-y-3">
        <p className="text-sm">This link is missing its token. Reset links expire after an hour.</p>
        <Link href="/forgot-password" className="btn btn-primary inline-flex">Request a new link</Link>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          required
          minLength={8}
          placeholder="New password (8+ chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2"
        />
        {err && <div className="text-sm text-red-400">{err}</div>}
        <button className="btn btn-primary w-full" disabled={pending}>
          {pending ? "Saving…" : "Set new password"}
        </button>
      </form>
      <p className="text-sm text-gray-400">
        <Link href="/forgot-password" className="text-brand">Request a new link</Link> if this one has expired.
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Choose a new password</h1>
      <Suspense fallback={<div className="card text-gray-400">Loading…</div>}>
        <ResetForm />
      </Suspense>
    </div>
  );
}

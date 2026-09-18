"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    // The endpoint answers identically whether or not the address has an
    // account, so there is nothing to branch on here — and nothing this page
    // could show that would reveal who is registered.
    await fetch("/api/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setPending(false);
    setSent(true);
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Reset your password</h1>
      {sent ? (
        <div className="card space-y-3">
          <p className="text-sm">
            If an account exists for <span className="font-semibold">{email}</span>, a reset link is on its way. It
            expires in an hour.
          </p>
          <p className="text-sm text-gray-400">
            Nothing arrived? Check your spam folder, or{" "}
            <button type="button" className="text-brand underline" onClick={() => setSent(false)}>
              try another address
            </button>
            .
          </p>
          <Link href="/login" className="btn btn-ghost inline-flex">Back to log in</Link>
        </div>
      ) : (
        <div className="card space-y-3">
          <p className="text-sm text-gray-400">
            Enter the email you signed up with and we&apos;ll send you a link to choose a new password.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2"
            />
            <button className="btn btn-primary w-full" disabled={pending}>
              {pending ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p className="text-sm text-gray-400">
            Signed up with Google? <Link href="/login" className="text-brand">Log in with Google</Link> instead — those
            accounts have no password.
          </p>
        </div>
      )}
    </div>
  );
}

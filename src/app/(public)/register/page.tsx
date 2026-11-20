"use client";
import Link from "next/link";
import { authPageHref, safeAuthReturn } from "@/lib/authReturn";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { trackEvent } from "@/lib/clientAnalytics";

function RegisterForm() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [signInFailed, setSignInFailed] = useState(false);
  const router = useRouter();
  const callbackUrl = safeAuthReturn(useSearchParams().get("callbackUrl"));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSignInFailed(false);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Blank means "not given" — the field is optional (no `required` here,
      // unlike email and password), so don't post an empty string for it.
      body: JSON.stringify({ ...form, name: form.name.trim() || undefined }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ? "Please check your details" : "Registration failed");
      return;
    }
    trackEvent("sign_up", { method: "email" });
    const result = await signIn("credentials", { email: form.email, password: form.password, redirect: false }).catch(() => null);
    if (!result?.ok || result.error) {
      setErr("Your account was created, but we couldn't sign you in. Please log in to continue.");
      setSignInFailed(true);
      return;
    }
    router.push(callbackUrl);
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Create account</h1>
      <div className="card space-y-3">
        <GoogleSignInButton callbackUrl={callbackUrl} />
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <div className="h-px flex-1 bg-brand-border" />
          <span>OR</span>
          <div className="h-px flex-1 bg-brand-border" />
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input aria-label="Full name" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          <input aria-label="Email" type="email" required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          <input aria-label="Password" type="password" required minLength={8} placeholder="Password (8+ chars)" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          {err && <div role="alert" className="text-sm text-red-400">{err}</div>}
          {signInFailed && <Link href={authPageHref("/login", callbackUrl)} className="inline-block text-sm text-brand underline">Log in</Link>}
          <button className="btn btn-primary w-full">Create account</button>
        </form>
      </div>
    </div>
  );
}

export default function RegisterPage() {
 return <Suspense fallback={<p className="text-sm text-gray-400">Loading…</p>}><RegisterForm /></Suspense>;
}

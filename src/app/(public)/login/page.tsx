"use client";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  "account-exists": "An account already exists with this email — log in with your password instead.",
};

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const oauthError = useSearchParams().get("error");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.ok) router.push("/dashboard");
    else setErr("Invalid credentials");
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Log in</h1>
      <div className="card space-y-3">
        {oauthError && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {OAUTH_ERROR_MESSAGES[oauthError] ?? "Something went wrong signing in — please try again."}
          </div>
        )}
        <GoogleSignInButton />
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <div className="h-px flex-1 bg-brand-border" />
          <span>OR</span>
          <div className="h-px flex-1 bg-brand-border" />
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          {err && <div className="text-sm text-red-400">{err}</div>}
          <button className="btn btn-primary w-full">Log in</button>
        </form>
      </div>
      <p className="mt-4 text-sm text-gray-400">
        No account? <Link href="/register" className="text-brand">Create one</Link>.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md"><div className="card text-gray-400">Loading…</div></div>}>
      <LoginForm />
    </Suspense>
  );
}

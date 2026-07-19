"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.ok) router.push("/dashboard");
    else setErr("Invalid credentials");
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Log in</h1>
      <form onSubmit={submit} className="card space-y-3">
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        {err && <div className="text-sm text-red-400">{err}</div>}
        <button className="btn btn-primary w-full">Log in</button>
      </form>
      <p className="mt-4 text-sm text-gray-400">
        No account? <Link href="/register" className="text-brand">Create one</Link>.
      </p>
    </div>
  );
}

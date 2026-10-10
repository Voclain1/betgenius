"use client";

import { useState } from "react";
import Link from "next/link";

export function UnsubscribeButton({ token, label }: { token: string; label: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const unsubscribe = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <p className="text-gray-300">
        Done — you won&apos;t get {label} any more. You can switch them back on in your{" "}
        <Link href="/notifications" className="font-medium text-brand underline">notification settings</Link>.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <button type="button" onClick={unsubscribe} disabled={state === "busy"} className="btn btn-primary disabled:opacity-60">
        {state === "busy" ? "Unsubscribing…" : "Unsubscribe"}
      </button>
      {state === "error" && <p className="text-sm text-red-400">That didn&apos;t work. Please try again, or turn emails off in your notification settings.</p>}
    </div>
  );
}

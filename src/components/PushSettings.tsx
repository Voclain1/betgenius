"use client";

import { useEffect, useState } from "react";

function urlBase64ToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/**
 * The registration from ServiceWorkerRegistration, registering it here if it
 * has not happened yet. Deliberately not `serviceWorker.ready`, which never
 * resolves when nothing is registered and would leave the button spinning.
 */
async function workerRegistration() {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function PushSettings() {
  const [state, setState] = useState<string>("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission);
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const enable = () => run(async () => {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) {
      setMessage("Push has not been configured by the site operator.");
      return;
    }
    const permission = await Notification.requestPermission();
    setState(permission);
    if (permission !== "granted") return;
    const reg = await workerRegistration();
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) }));
    const r = await fetch("/api/push-subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    setMessage(r.ok ? "Push enabled on this device." : (await r.json().catch(() => null))?.error || "Could not enable push.");
  });

  const disable = () => run(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push-subscriptions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setMessage("Push disabled on this device.");
  });

  const test = () => run(async () => {
    const r = await fetch("/api/push-test", { method: "POST" });
    const data = await r.json().catch(() => ({}));
    setMessage(r.ok ? `Sent to ${data.sent} device(s).` : data.error || "Could not send a test.");
  });

  return (
    <section className="card space-y-3">
      <h2 className="section-heading">Browser push</h2>
      {state === "unsupported" ? (
        <p className="text-sm text-gray-400">Push is unavailable in this browser. On iPhone or iPad, add BetGenius to the Home Screen first. Your inbox still works.</p>
      ) : (
        <>
          <p className="text-sm text-gray-400">
            {state === "denied"
              ? "Notifications are blocked for this site. Allow them in your browser settings to enable push."
              : "Permission is only requested when you choose Enable."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={enable} disabled={busy || state === "denied"}>Enable push</button>
            <button className="btn btn-ghost" onClick={disable} disabled={busy}>Disable on this device</button>
            <button className="btn btn-ghost" onClick={test} disabled={busy || state !== "granted"}>Send test notification</button>
          </div>
        </>
      )}
      {message && <p className="text-sm text-brand" role="status">{message}</p>}
    </section>
  );
}

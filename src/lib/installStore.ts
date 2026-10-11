"use client";

/**
 * The browser's install offer, held for every surface that wants it.
 *
 * Chrome/Edge/Samsung Internet fire `beforeinstallprompt` ONCE per page load,
 * and the event is the only way to open the real install dialog. The bottom
 * banner (InstallPrompt) captures it for itself; this module captures the same
 * event independently so the permanent "Get the app" entry points — the header
 * icon and the /app page — can offer the one-tap install too, including after
 * the banner was dismissed.
 *
 * Listening starts when this module is first evaluated, and the header imports
 * it on every public page, so the event is not missed. Both listeners call
 * preventDefault, which is harmless twice. The event can be prompted once; a
 * second prompt() throws, which `promptInstall` treats as "no offer".
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export function installedThisVisit(): boolean {
  return installed;
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the browser's own install dialog. Resolves to what the person chose, or null when there was no offer to open. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const event = deferred;
  if (!event) return null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // Single-use either way; a fresh one arrives on a later page load if the
    // app is still not installed.
    deferred = null;
    notify();
    return outcome;
  } catch {
    deferred = null;
    notify();
    return null;
  }
}

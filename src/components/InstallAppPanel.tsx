"use client";

import { useEffect, useState } from "react";
import { MoreVertical, Share, SquarePlus } from "lucide-react";
import { INSTALLED_KEY, isIosDevice, isRunningStandalone } from "@/lib/installPrompt";
import { canPromptInstall, installedThisVisit, promptInstall, subscribeInstall } from "@/lib/installStore";

/**
 * The one place that always offers the app, whatever happened to the banner.
 *
 * It picks the honest action for the device in front of it:
 *   - already inside the app → say so, nothing to do;
 *   - the browser offered an install (Chrome, Edge, Samsung Internet) → one
 *     tap opens the browser's own install dialog;
 *   - iPhone / iPad → Safari has no install API, so the Share-sheet steps;
 *   - any other Android browser, or Chrome before it has made its offer → the
 *     browser-menu steps, which always work;
 *   - desktop → the install icon in the address bar.
 */
type Platform = "standalone" | "ios" | "android" | "desktop";

function detect(): Platform {
  if (isRunningStandalone(window)) return "standalone";
  if (isIosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return "ios";
  if (/Android/i.test(navigator.userAgent)) return "android";
  return "desktop";
}

export function InstallAppPanel() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installedBefore, setInstalledBefore] = useState(false);
  const [status, setStatus] = useState<"idle" | "busy" | "installed" | "dismissed">("idle");

  useEffect(() => {
    setPlatform(detect());
    try {
      setInstalledBefore(window.localStorage.getItem(INSTALLED_KEY) === "1");
    } catch {
      /* storage blocked: treat as not installed */
    }
    const sync = () => {
      setCanPrompt(canPromptInstall());
      if (installedThisVisit()) setStatus("installed");
    };
    sync();
    return subscribeInstall(sync);
  }, []);

  const install = async () => {
    setStatus("busy");
    const outcome = await promptInstall();
    setStatus(outcome === "accepted" ? "installed" : outcome === "dismissed" ? "dismissed" : "idle");
  };

  if (!platform) return <div className="card h-40" aria-hidden="true" />;

  if (platform === "standalone" || status === "installed") {
    return (
      <div className="card space-y-2">
        <h2 className="text-lg font-semibold text-gray-100">{status === "installed" ? "Installed" : "You're using the app"}</h2>
        <p className="text-sm text-gray-400">
          {status === "installed"
            ? "BetGenius is on your home screen now. Open it from there any time."
            : "This is the BetGenius app. It updates itself, so there's nothing to download."}
        </p>
      </div>
    );
  }

  return (
    <div className="card space-y-5">
      {canPrompt && (
        <div className="space-y-2">
          <button type="button" onClick={install} disabled={status === "busy"} className="btn btn-primary w-full justify-center text-base disabled:opacity-60 sm:w-auto">
            {status === "busy" ? "Opening…" : "Install the app"}
          </button>
          <p className="text-sm text-gray-400">
            {status === "dismissed"
              ? "No problem — you can install it from here whenever you like."
              : "It installs like any other app and appears with your apps."}
          </p>
        </div>
      )}

      {platform === "ios" && (
        <Steps
          title="On iPhone or iPad"
          steps={[
            <>Open this page in <strong className="text-gray-100">Safari</strong>.</>,
            <>Tap <Share size={15} className="mx-0.5 inline align-[-2px]" aria-hidden="true" /> <strong className="text-gray-100">Share</strong> at the bottom of the screen.</>,
            <>Choose <SquarePlus size={15} className="mx-0.5 inline align-[-2px]" aria-hidden="true" /> <strong className="text-gray-100">Add to Home Screen</strong>, then <strong className="text-gray-100">Add</strong>.</>,
          ]}
        />
      )}

      {/* With the one-tap install on offer, the button is the whole story —
          the menu steps are only for browsers that can't offer it. */}
      {platform === "android" && !canPrompt && (
        <Steps
          title="On Android"
          steps={[
            <>Open this page in <strong className="text-gray-100">Chrome</strong> (Samsung Internet and Edge work too).</>,
            <>Tap the <MoreVertical size={15} className="mx-0.5 inline align-[-2px]" aria-hidden="true" /> menu at the top right.</>,
            <>Choose <strong className="text-gray-100">Install app</strong> or <strong className="text-gray-100">Add to Home screen</strong>.</>,
          ]}
        />
      )}

      {platform === "desktop" && !canPrompt && (
        <Steps
          title="On a computer"
          steps={[
            <>Open this page in <strong className="text-gray-100">Chrome</strong> or <strong className="text-gray-100">Edge</strong>.</>,
            <>Click the install icon at the right of the address bar, or open the browser menu and choose <strong className="text-gray-100">Install BetGenius</strong>.</>,
          ]}
        />
      )}

      {installedBefore && (
        <p className="text-sm text-gray-400">Already installed it on this device? Open BetGenius from your home screen or app list.</p>
      )}
    </div>
  );
}

function Steps({ title, steps }: { title: string; steps: React.ReactNode[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-gray-100">{title}</h2>
      <ol className="space-y-2 text-sm text-gray-300">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-5 shrink-0 font-semibold text-brand">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

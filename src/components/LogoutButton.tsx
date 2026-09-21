"use client";

import { useState } from "react";
import { logOut } from "@/lib/logout";

/**
 * The shared "Log out" control. Nav and DashboardShell both render this rather
 * than wiring their own handler, so neither can drift into a sign-out that
 * skips the push detachment — see src/lib/logout.ts for why that step exists.
 *
 * `onBeforeLogout` is for the caller's own UI (closing a drawer), and runs
 * before anything async so the click feels immediate.
 */
export function LogoutButton({
  className,
  callbackUrl,
  onBeforeLogout,
}: {
  className: string;
  callbackUrl?: string;
  onBeforeLogout?: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      data-logout
      disabled={pending}
      className={className}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        onBeforeLogout?.();
        try {
          await logOut({ callbackUrl });
        } catch {
          // Sign-out itself failed (offline). Re-enable so the user can retry.
          setPending(false);
        }
      }}
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

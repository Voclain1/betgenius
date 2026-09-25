"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { trackEvent } from "@/lib/clientAnalytics";

/** Records only a completed OAuth account creation, never a button click/login. */
export function SignupConfirmation({ method }: { method?: "google" | null }) {
  const { update } = useSession();
  const consumed = useRef(false);

  useEffect(() => {
    if (!method || consumed.current) return;
    consumed.current = true;
    trackEvent("sign_up", { method });
    // Any explicit session refresh clears the signed one-time marker server-side.
    void update();
  }, [method, update]);

  return null;
}

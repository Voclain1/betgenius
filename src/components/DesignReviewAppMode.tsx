"use client";
import { useEffect } from "react";
/** Only mounted by the opt-in design review route; never changes a reader's saved preferences. */
export function DesignReviewAppMode() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-standalone");
    root.setAttribute("data-standalone", "true");
    return () => {
      if (previous === null) root.removeAttribute("data-standalone");
      else root.setAttribute("data-standalone", previous);
    };
  }, []);
  return null;
}

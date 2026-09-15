"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RAIL_SLOT_ID } from "@/components/ads/railSlot";

/**
 * Moves a page's rail unit into the slot under the Top trends panel.
 *
 * The page decides WHICH unit it carries (see WithAdRail); the predictions
 * layout decides WHERE the right-hand column is. A portal is what lets the
 * two stay separate without editing every page that has a rail.
 *
 * Renders nothing until mounted, and nothing if the slot is missing — which
 * only happens if WithAdRail is used outside the predictions layout.
 */
export function RailPortal({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(RAIL_SLOT_ID)), []);
  return slot ? createPortal(children, slot) : null;
}

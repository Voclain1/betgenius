"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackEngagement } from "@/lib/engagement";
import type { HomePlacement, HomeTarget } from "@/lib/homeLinks";

/**
 * A homepage link that reports which destination was opened and from where,
 * then behaves exactly like a link. It sends two fixed words and nothing else
 * (see src/lib/homeLinks.ts); no label, name, id or prediction detail.
 */
export function HomeLink({ target, placement, href, className, children }: { target: HomeTarget; placement: HomePlacement; href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={className} onClick={() => trackEngagement("home_click", { target, placement })}>
      {children}
    </Link>
  );
}

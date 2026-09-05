"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { CalendarDays, Layers, Radio, Sparkles, User } from "lucide-react";
import { APP_TABS, activeTab, type AppTab } from "@/lib/appShell";

/**
 * The installed app's bottom tab bar.
 *
 * ALWAYS rendered, and hidden in a browser tab by CSS (`[data-app-only]`, see
 * globals.css) rather than by a mount-time check. That ordering matters: a
 * component that decides in useEffect whether to exist pops into place after
 * hydration on every app launch, and the point of this bar is that the app does
 * not look like a website for a frame first. `display: none` also takes it out
 * of the accessibility tree entirely, so a browser reader never meets it.
 *
 * The five destinations and the reasoning behind them live in
 * src/lib/appShell.ts — this file is the rendering only, so the tab set can be
 * asserted by a plain unit test with no DOM.
 */

const ICONS: Record<AppTab["icon"], typeof Sparkles> = {
  sparkles: Sparkles,
  radio: Radio,
  calendar: CalendarDays,
  layers: Layers,
  user: User,
};

export function AppTabBar() {
  const pathname = usePathname() ?? "/";
  const { data } = useSession();
  const signedIn = Boolean(data?.user);
  const current = activeTab(pathname);

  return (
    <nav
      data-app-only
      aria-label="App sections"
      // `fixed` rather than sticky: it must sit above page content at the
      // bottom of the viewport regardless of scroll position or how short the
      // page is. The safe-area padding clears the iOS home indicator and
      // Android's gesture bar — without it the labels sit under both.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-border bg-brand-bg/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {APP_TABS.map((tab) => {
          const Icon = ICONS[tab.icon];
          const isCurrent = current?.href === tab.href;
          // The Account tab is the one destination whose target depends on who
          // is asking. Everything else is the same URL for everyone.
          const href = tab.href === "/dashboard" && !signedIn ? "/login" : tab.href;

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={href}
                // aria-current is what tells a screen reader which section is
                // open; the colour alone carries that for sighted users only.
                aria-current={isCurrent ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition ${
                  isCurrent ? "text-brand" : "text-gray-400 hover:text-gray-100"
                }`}
              >
                <Icon size={20} aria-hidden="true" strokeWidth={isCurrent ? 2.4 : 1.8} />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

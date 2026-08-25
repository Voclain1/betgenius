"use client";

import { useCallback, useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { THEMES, THEME_STORAGE_KEY, DEFAULT_THEME, isTheme, type Theme } from "@/lib/theme";

const ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

/**
 * Applies a theme to the document.
 *
 * "system" REMOVES the attribute rather than writing a resolved value, so the
 * `prefers-color-scheme` block in globals.css takes over and the page keeps
 * following the OS if it changes later.
 *
 * The `theme-switching` class suppresses transitions for one frame. Without it,
 * every element carrying a `transition` animates its own colour on its own
 * schedule and the switch arrives as a ripple across the page rather than as a
 * single change.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  // Two frames: one for the attribute change to be committed, one for styles to
  // settle before transitions are allowed back.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

/**
 * Cycles light → dark → system.
 *
 * A three-way cycle rather than a two-way switch because "system" is a real
 * preference, and a binary toggle silently discards it the first time anyone
 * touches the control.
 *
 * Renders a stable placeholder until mounted. The stored preference lives in
 * localStorage, which the server cannot read, so rendering the real icon during
 * SSR would guarantee a hydration mismatch on every load where the choice is
 * not the default.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Private window, or site data blocked. Fall through to the default —
      // the page is already rendering it, so there is nothing to correct.
    }
    if (isTheme(stored)) setTheme(stored);
    setMounted(true);
  }, []);

  const cycle = useCallback(() => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The theme still applies for this page view; it just will not persist.
    }
  }, [theme]);

  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={cycle}
      // Both labels matter: the visible one is an icon, so the accessible name
      // has to carry the current state AND what pressing it will do.
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]]}`}
      title={`Theme: ${LABELS[theme]}`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-brand-border text-gray-400 transition hover:bg-brand-card hover:text-gray-100 ${className}`}
    >
      {/* Before mount the stored choice is unknown, so a neutral glyph is shown
          rather than one that might visibly swap a moment later. */}
      {mounted ? <Icon size={16} /> : <span className="h-4 w-4 rounded-full border border-current opacity-40" />}
    </button>
  );
}

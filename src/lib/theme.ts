/**
 * Theme selection, shared between the no-flash boot script and the toggle.
 *
 * Three states, not two. "system" is a real choice distinct from either fixed
 * theme: it means "follow the OS", and it is represented by the ABSENCE of the
 * data-theme attribute, which is what lets the `prefers-color-scheme` block in
 * globals.css apply. Storing "system" as a resolved "dark" instead would freeze
 * the choice at whatever the OS said the day it was made.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "betgenius-theme";

/** The theme applied when nothing is stored. Change this to flip the site default. */
export const DEFAULT_THEME: Theme = "dark";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * The script that runs BEFORE first paint, inlined into <head>.
 *
 * This exists solely to prevent the flash of wrong theme. React cannot do this
 * job: the server has no way to know a per-browser preference, so any
 * React-driven application of the theme necessarily happens after hydration —
 * one or more frames of the wrong colours, which on a dark-default site means a
 * white flash on every cold load.
 *
 * Deliberately tiny and defensive. It runs before anything else on the page,
 * so a throw here would take the whole document down; localStorage alone can
 * throw in a private window or with site data blocked, hence the try/catch and
 * the do-nothing fallback (which lands on the CSS default).
 *
 * Kept as a string rather than a real function because it has to be serialised
 * into a <script> tag — it cannot close over anything, so the storage key is
 * interpolated rather than imported.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}else if(t!=="system"&&${JSON.stringify(DEFAULT_THEME)}!=="system"){document.documentElement.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});}}catch(e){}})();`;

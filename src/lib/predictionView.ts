/**
 * The reader's Detailed / Compact preference for prediction category feeds.
 *
 * ONE key for every category, on purpose: a reader who switches to Compact on
 * Genius expects Banker, VIP and Goals to open Compact too. Per-category keys
 * would make the choice look forgotten every time they changed feed.
 *
 * Kept free of React and of `window` so the parsing and the storage failure
 * modes can be checked without a browser — see scripts/check-prediction-view.tsx.
 */
export const PREDICTION_VIEW_KEY = "betgenius-prediction-view";

export const PREDICTION_VIEWS = ["detailed", "compact"] as const;
export type PredictionView = (typeof PREDICTION_VIEWS)[number];

/**
 * What the server renders and what any unreadable preference falls back to.
 * Detailed is the page as it was before the toggle existed, so a reader with
 * no storage — private window, blocked site data — sees exactly that.
 */
export const DEFAULT_PREDICTION_VIEW: PredictionView = "detailed";

export function parsePredictionView(value: unknown): PredictionView {
  return value === "compact" || value === "detailed" ? value : DEFAULT_PREDICTION_VIEW;
}

type ViewStorage = Pick<Storage, "getItem" | "setItem">;

/** Never throws: a storage accessor that throws is treated like an empty one. */
export function readPredictionView(storage: ViewStorage | null | undefined): PredictionView {
  try {
    return parsePredictionView(storage?.getItem(PREDICTION_VIEW_KEY));
  } catch {
    return DEFAULT_PREDICTION_VIEW;
  }
}

/** Never throws: failing to remember the choice must not stop it applying. */
export function writePredictionView(storage: ViewStorage | null | undefined, view: PredictionView): void {
  try {
    storage?.setItem(PREDICTION_VIEW_KEY, view);
  } catch {
    // Quota, disabled storage or a sandboxed frame: the choice still applies
    // for this page view, it just won't carry over.
  }
}

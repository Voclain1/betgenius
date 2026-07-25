// Shared outcome-chip color mapping — kept in a plain (non "use client") module
// so server components (e.g. the homepage) can index into it directly; a
// server component can't dot into a value exported from a "use client" file.
export const OUTCOME_STYLES: Record<string, string> = {
  WON: "bg-emerald-500/20 text-emerald-300",
  LOST: "bg-red-500/20 text-red-300",
  VOID: "bg-gray-500/20 text-gray-300",
};

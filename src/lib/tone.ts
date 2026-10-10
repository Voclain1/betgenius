/**
 * A status colour without its tinted background: the design rules forbid pills
 * behind status text ("bg-emerald-500/20 text-emerald-300" -> "text-emerald-300").
 */
export const textTone = (classes: string) =>
  classes
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("bg-"))
    .join(" ");

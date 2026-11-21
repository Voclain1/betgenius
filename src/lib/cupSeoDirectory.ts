import { CUP_CONFIGS, cupById, type CupConfig } from "@/lib/cupConfig";
import { fitMetaDescription, fitMetadataTitleWithSuffix } from "@/lib/seo";

/** Editorial display priority, NOT a prediction ranking or confidence score.
 * Every existing cup is in exactly one group. New registry cups join 'other'
 * automatically, without another separate page and without new API calls.
 */
export const TOP_CUP_IDS = [2, 3, 848, 45, 48, 143, 137, 81, 66] as const;
export const MIDDLE_CUP_IDS = [96, 90, 147, 181, 206, 199, 220, 209, 121, 105, 115, 108, 112, 285, 347] as const;

export type CupDirectoryGroup = { key: "top" | "middle" | "other"; title: string; cups: CupConfig[] };

export function cupDirectoryGroups(): CupDirectoryGroup[] {
  const topSet = new Set<number>(TOP_CUP_IDS);
  const middleSet = new Set<number>(MIDDLE_CUP_IDS);
  const others = CUP_CONFIGS.filter((cup) => !topSet.has(cup.id) && !middleSet.has(cup.id));
  return [
    { key: "top", title: "Major European and domestic cups", cups: TOP_CUP_IDS.map((id) => cupById(id)!).filter(Boolean) },
    { key: "middle", title: "More national cup competitions", cups: MIDDLE_CUP_IDS.map((id) => cupById(id)!).filter(Boolean) },
    { key: "other", title: "Other cup competitions", cups: others },
  ];
}

/** Search intent labels describe fixture and result availability honestly.
 * Specific 'prediction' labels are limited to established flagship hubs.
 */
export function cupDirectoryLabel(cup: CupConfig): string {
  if (cup.id === 121) return "Danish Cup games, fixtures & results";
  if (cup.id === 81) return "DFB Pokal fixtures & results";
  if (cup.id === 2) return "Champions League predictions";
  if (cup.id === 3) return "Europa League predictions";
  if (cup.id === 848) return "Conference League predictions";
  return `${cup.name} fixtures & results`;
}
export function cupDirectoryDescription(cup: CupConfig): string {
  return `Browse ${cup.name} fixtures by round, recorded scores and links to match predictions where published.`;
}

/** Fallback for cups without a hand-researched metadata profile.
 * Top cups with unique, already-tested titles remain untouched.
 * Do not claim standings, odds or top scorers unless their data exist.
 */
export function cupSearchFallback(cup: CupConfig): { title: string; description: string } {
  return {
    title: fitMetadataTitleWithSuffix(cup.name, "Fixtures & Results"),
    description: fitMetaDescription(`Browse ${cup.name} games and fixtures by round, recent results and participating teams. BetGenius match predictions are linked where published.`),
  };
}

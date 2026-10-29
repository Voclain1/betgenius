import { fitMetadataTitleWithSuffix, fitMetaDescription } from "@/lib/seo";

/** Describe the visible team inventory without promising missing fixtures. */
export function teamSearchMetadata(name: string, pickCount: number, upcomingCount: number, settledCount: number) {
  const suffix = upcomingCount > 0 ? "Predictions & Fixtures"
    : settledCount > 0 ? "Predictions & Results" : "Predictions";
  const parts = [
    `${name} football predictions and match analysis.`,
    ...(upcomingCount > 0 ? [`${upcomingCount} upcoming ${upcomingCount === 1 ? "fixture" : "fixtures"}.`] : []),
    `${pickCount} published ${pickCount === 1 ? "pick" : "picks"}${settledCount > 0 ? " with settled results" : ""}.`,
  ];
  return {
    title: fitMetadataTitleWithSuffix(name, suffix),
    description: fitMetaDescription(parts.join(" ")),
  };
}

import type { Metadata } from "next";
import { PeriodPredictionsPage, periodMetadata } from "@/components/PeriodPredictionsPage";

/** A static segment, so it takes precedence over the sibling [category] route. */
export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return periodMetadata("midweek");
}

export default function Page() {
  return <PeriodPredictionsPage kind="midweek" />;
}

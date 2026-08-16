import { Suspense } from "react";
import FixturesClient from "./FixturesClient";
import { getPublishedMatchIndex } from "@/lib/predictionScope";

// Server shell over the client page, for one reason: the match-page link
// index is a DB read, and the fixture list itself stays client-side because
// it re-fetches on filter changes. Fixtures that have a published prediction
// link to their match page; the rest of the slate stays plain.
//
// Revalidated rather than left static: the index changes when predictions are
// published, not on every request. Without this it would freeze at build time
// and newly published matches would stay unlinked until the next deploy.
export const revalidate = 300;

export default async function FixturesPage() {
  const linkIndex = await getPublishedMatchIndex();
  // Suspense boundary because FixturesClient reads the filter state from
  // useSearchParams, which opts its subtree into client-side rendering.
  return (
    <Suspense fallback={null}>
      <FixturesClient linkIndex={linkIndex} />
    </Suspense>
  );
}

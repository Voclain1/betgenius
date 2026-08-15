import FixturesClient from "./FixturesClient";
import { getPublishedMatchIndex } from "@/lib/predictionScope";

// Revalidated rather than left static: the shell's only server data is the
// match-link index, which changes when predictions are published, not on
// every request. Without this the index would be frozen at build time and
// newly published matches would stay unlinked until the next deploy.
export const revalidate = 300;

// Server shell over the client page, for one reason: the match-page link
// index is a DB read, and the fixture list itself stays client-side because
// it re-fetches on date/tab changes. Fixtures that have a published
// prediction link to their match page; the rest of the slate stays plain.
export default async function FixturesPage() {
  return <FixturesClient linkIndex={await getPublishedMatchIndex()} />;
}

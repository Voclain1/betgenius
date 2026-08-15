import LivescoresClient from "./LivescoresClient";
import { getPublishedMatchIndex } from "@/lib/predictionScope";

// Same 5-minute revalidate as /fixtures, for the same reason — see its note.
export const revalidate = 300;

// Server shell over the client page — same reasoning as the Fixtures one:
// the match-page link index is a DB read, while the live feed keeps polling
// from the client.
export default async function LivescoresPage() {
  return <LivescoresClient linkIndex={await getPublishedMatchIndex()} />;
}

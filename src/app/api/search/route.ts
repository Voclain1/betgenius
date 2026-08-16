import { NextResponse } from "next/server";
import { getSearchIndex } from "@/lib/predictionScope";

// The nav search index. Fetched once, lazily, when a reader first focuses the
// search box — never on page load — then filtered client-side. Revalidated
// rather than dynamic because it only changes when predictions are published.
export const revalidate = 300;

export async function GET() {
  return NextResponse.json(await getSearchIndex());
}

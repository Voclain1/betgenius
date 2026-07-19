import { NextResponse } from "next/server";
import { getLiveFixtures } from "@/lib/football/api-football";

export const revalidate = 15;

export async function GET() {
  const rows = (await getLiveFixtures()) ?? [];
  return NextResponse.json({ live: rows });
}

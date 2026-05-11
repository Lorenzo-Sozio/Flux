import { type NextRequest, NextResponse } from "next/server";

import { searchCities } from "@/actions/geo";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const countryId = searchParams.get("country_id");
  if (!countryId) return NextResponse.json([]);
  const cities = await searchCities(q, countryId);
  return NextResponse.json(cities);
}

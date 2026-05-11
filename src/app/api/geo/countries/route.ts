import { NextResponse } from "next/server";

import { getCountries } from "@/actions/geo";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const countries = await getCountries();
  return NextResponse.json(countries);
}

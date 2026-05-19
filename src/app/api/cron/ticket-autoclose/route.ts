import { NextResponse } from "next/server";

import { autoCloseResolvedTickets } from "@/actions/support";
import { verifyCronRequest } from "@/lib/cron-auth";

export async function GET(req: Request) {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const count = await autoCloseResolvedTickets();
  return NextResponse.json({ closed: count });
}

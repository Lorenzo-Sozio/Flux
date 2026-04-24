import { autoCloseResolvedTickets } from "@/actions/support";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const secret = req.headers.get("authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await autoCloseResolvedTickets();
  return NextResponse.json({ closed: count });
}

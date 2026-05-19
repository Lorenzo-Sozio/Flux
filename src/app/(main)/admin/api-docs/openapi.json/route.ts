import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/admin-session";
import { openApiSpec } from "@/lib/openapi/spec";

export async function GET() {
  const adminSession = await getAdminSession();
  if (!adminSession || (adminSession.role !== "admin" && adminSession.role !== "owner")) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.json(openApiSpec, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

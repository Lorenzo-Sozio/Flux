import { NextResponse } from "next/server";

import { openApiSpec } from "@/lib/openapi/spec";

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

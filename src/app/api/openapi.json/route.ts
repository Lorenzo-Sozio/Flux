import { NextResponse } from "next/server";

import { publicOpenApi } from "@/lib/api-docs/to-openapi";
import { getAppUrlOrNull } from "@/lib/app-url";

/**
 * The public API as OpenAPI 3, for whoever integrates: generated from the same entries the
 * /developers page draws (src/lib/api-docs/public-api.ts). No session — it describes what a
 * key can do and opens nothing; the staff spec with internal routes stays behind /admin.
 */
export async function GET() {
  return NextResponse.json(publicOpenApi(getAppUrlOrNull()), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

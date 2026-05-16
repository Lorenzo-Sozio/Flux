import { NextResponse } from "next/server";

import { openApiSpec } from "@/lib/openapi/spec";
import { toPostmanCollection } from "@/lib/openapi/to-postman";

// Public endpoint — no auth required so Postman's servers can fetch the collection
// via the "Run in Postman" URL (https://app.getpostman.com/run-collection?url=...).
// The collection only contains API structure and template variables, no secrets.
export async function GET() {
  const collection = toPostmanCollection(openApiSpec);

  return NextResponse.json(collection, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
      "Content-Disposition": 'attachment; filename="flux-crm-postman-collection.json"',
    },
  });
}

import type { NextRequest } from "next/server";

import { handleCsvImport } from "@/lib/csv-import-route";

/** CSV import from the leads list. Everything it does is in src/lib/csv-import-route.ts. */
export async function POST(req: NextRequest) {
  return handleCsvImport(req, "leads");
}

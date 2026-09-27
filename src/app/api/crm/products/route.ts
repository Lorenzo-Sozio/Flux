import type { NextRequest } from "next/server";

import { gateApiRequest } from "@/lib/api-import-auth";
import { listResponse } from "@/lib/api-read-route";

/** What a key must hold to call this (src/lib/api-scopes.ts). */
const READ_SCOPE = { entity: "products", access: "read" } as const;

/**
 * The catalogue, a page at a time, oldest change first (src/lib/api-read.ts). With
 * `companyId`, each product also carries `customerPrice` — what that customer pays under their
 * price list — and `priceSource` (`base`, `percent` or `override`). Nothing is written.
 */
export async function GET(req: NextRequest) {
  const gate = await gateApiRequest(req, READ_SCOPE);
  if (gate.response) return gate.response;
  return listResponse(req, gate.auth, "products");
}

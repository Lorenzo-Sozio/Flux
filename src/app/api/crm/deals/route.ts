import type { NextRequest } from "next/server";

import { gateApiRequest } from "@/lib/api-import-auth";
import { listResponse } from "@/lib/api-read-route";

/** What a key must hold to call this (src/lib/api-scopes.ts). */
const READ_SCOPE = { entity: "deals", access: "read" } as const;

/**
 * A page of deals, oldest change first, with their stage's name; `updatedSince` and
 * `cursor` to reconcile (src/lib/api-read.ts). Deals are closed through `/api/crm/close`;
 * there is no write here, so nothing is logged.
 */
export async function GET(req: NextRequest) {
  const gate = await gateApiRequest(req, READ_SCOPE);
  if (gate.response) return gate.response;
  return listResponse(req, gate.auth, "deals");
}

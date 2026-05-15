import { type NextRequest, NextResponse } from "next/server";

import { dispatchWebhook } from "@/actions/webhooks";
import { activities } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildActivityPayload, validateActivityInput } from "@/lib/api-import-validators";
import { getDb } from "@/lib/tenant-context";

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { errors, data } = validateActivityInput(body);
  if (errors.length > 0 || !data) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
  }

  const db = await getDb();
  const [created] = await db.insert(activities).values(buildActivityPayload(data, authResult.userId)).returning();
  dispatchWebhook("activity.created", { activity: created });

  return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
}

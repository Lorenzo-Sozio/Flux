import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { leads } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildLeadPayload, parseOnDuplicate, validateLeadInput } from "@/lib/api-import-validators";
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

  const { errors, data } = validateLeadInput(body);
  if (errors.length > 0 || !data) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
  }

  const onDuplicate = parseOnDuplicate(body as Record<string, unknown>);
  const db = await getDb();

  if (data.email) {
    const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, data.email));

    if (existing) {
      if (onDuplicate === "error") {
        return NextResponse.json(
          { error: "Conflict", reason: "duplicate_email", existingId: existing.id },
          { status: 409 },
        );
      }

      if (onDuplicate === "update") {
        const [updated] = await db
          .update(leads)
          .set(buildLeadPayload(data, authResult.userId))
          .where(eq(leads.id, existing.id))
          .returning();
        dispatchWebhook("lead.updated", { lead: updated });
        return NextResponse.json({ status: "updated", id: updated.id, data: updated });
      }

      return NextResponse.json({ status: "skipped", reason: "duplicate_email", existingId: existing.id });
    }
  }

  const [created] = await db.insert(leads).values(buildLeadPayload(data, authResult.userId)).returning();
  dispatchWebhook("lead.created", { lead: created });

  return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
}

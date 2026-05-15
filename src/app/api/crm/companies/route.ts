import { type NextRequest, NextResponse } from "next/server";

import { ilike } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { companies } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildCompanyPayload, parseOnDuplicate, validateCompanyInput } from "@/lib/api-import-validators";
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

  const { errors, data } = validateCompanyInput(body);
  if (errors.length > 0 || !data) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
  }

  const onDuplicate = parseOnDuplicate(body as Record<string, unknown>);
  const db = await getDb();

  const [existing] = await db.select({ id: companies.id }).from(companies).where(ilike(companies.name, data.name));

  if (existing) {
    if (onDuplicate === "error") {
      return NextResponse.json(
        { error: "Conflict", reason: "duplicate_name", existingId: existing.id },
        { status: 409 },
      );
    }

    if (onDuplicate === "update") {
      const [updated] = await db
        .update(companies)
        .set(buildCompanyPayload(data, authResult.userId))
        .where(ilike(companies.name, data.name))
        .returning();
      dispatchWebhook("company.updated", { company: updated });
      return NextResponse.json({ status: "updated", id: updated.id, data: updated });
    }

    return NextResponse.json({ status: "skipped", reason: "duplicate_name", existingId: existing.id });
  }

  const [created] = await db.insert(companies).values(buildCompanyPayload(data, authResult.userId)).returning();
  dispatchWebhook("company.created", { company: created });

  return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
}

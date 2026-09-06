import { after, type NextRequest, NextResponse } from "next/server";

import { and, eq, inArray } from "drizzle-orm";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { createTenantDb } from "@/db";
import { customFieldDefinitions, customFieldValues } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { findByContactPoint, readContactPoint, whereToNote } from "@/lib/contact-point";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * Record, on a person's own record, values an integration collected from them.
 *
 * Body: `{ "contactPoint": "+39 333 111 2223", "fields": { "budget": "8000" } }`.
 *
 * ## ⚠️⚠️ Why this is not the notes endpoint with another name
 *
 * A note is prose a salesperson reads. These are **named values an automation rule can
 * compare against a threshold**. Until this existed, an assistant could write «budget:
 * 8000» onto the timeline and no rule could act on it — nothing knows how to find a number
 * inside a sentence, and teaching a rule to would be teaching it our prose.
 *
 * ## ⚠️⚠️ It writes into the custom fields this CRM already has
 *
 * The first design added a `custom_fields` jsonb column to `lead` and `contact`. That was
 * wrong: `custom_field_definition` and `custom_field_value` exist, the settings screen
 * already manages them, and a second place holding the same thing is a second place to
 * diverge — the day they did, the field the owner renamed in the UI would stop matching the
 * one the assistant writes.
 *
 * ⚠️ **A definition that does not exist yet is created**, as text. The owner has already
 * declared that field: they typed it into the assistant's «information to collect» knob.
 * Refusing would mean declaring the same field twice, in two products, before the first
 * conversation could work — and the failure would arrive as a 422 nobody can act on
 * quickly. Created here, it also shows up in the CRM's own screens, where it can be renamed
 * or retyped.
 *
 * ## The rules run, and that is the whole point
 *
 * `runAutomations` gets the collected values as `customFields`, before and after: the
 * thresholds, the segments and the funnel stages live where the fields to judge them live,
 * and this is the moment they get something to judge. Without this call the values would
 * land and nothing would happen.
 *
 * ⚠️ **Nobody found is a 404**, like the notes endpoint and for the same reason: an
 * assistant that believes it has recorded what it collected, onto a record that does not
 * exist, is worse than one that knows it could not.
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!authResult.tenantId) {
    return NextResponse.json(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      { status: 400 },
    );
  }

  // Counts the call against the plan, like every other /api/crm route. Opt-out and
  // erasure are deliberately excluded: refusing either because a plan limit was reached
  // means carrying on contacting somebody who asked you to stop, and missing a deadline
  // that is not ours to move.
  try {
    await checkAndTrackApiCall(authResult.tenantId);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const dati = (body ?? {}) as Record<string, unknown>;
  const contactPoint = typeof dati.contactPoint === "string" ? dati.contactPoint.trim() : "";
  const grezzi = dati.fields;
  const oggetto = typeof grezzi === "object" && grezzi !== null && !Array.isArray(grezzi);
  if (!contactPoint || !oggetto) {
    return NextResponse.json(
      {
        error: "Validation failed",
        errors: [
          ...(contactPoint ? [] : [{ field: "contactPoint", message: "contactPoint is required" }]),
          ...(oggetto ? [] : [{ field: "fields", message: "fields must be an object of named values" }]),
        ],
      },
      { status: 422 },
    );
  }

  // ⚠️ Only scalars, trimmed. A nested object here would be a shape no rule condition can
  // compare, and the caller has no way of learning that from a silent success.
  const campi: Record<string, string> = {};
  for (const [chiave, valore] of Object.entries(grezzi as Record<string, unknown>)) {
    if (typeof valore !== "string" && typeof valore !== "number") continue;
    const testo = String(valore).trim();
    if (chiave.trim() && testo) campi[chiave.trim()] = testo.slice(0, 500);
  }
  if (Object.keys(campi).length === 0) {
    return NextResponse.json(
      { error: "Validation failed", errors: [{ field: "fields", message: "no usable named values" }] },
      { status: 422 },
    );
  }

  // The raw string from the request, and the pair it parses into, are two
  // different things and need two names.
  let parsed: { email: string | null; digits: string | null };
  try {
    parsed = readContactPoint(contactPoint);
  } catch (_err) {
    return NextResponse.json(
      {
        error: "Validation failed",
        errors: [{ field: "contactPoint", message: "must be an email address or a phone number" }],
      },
      { status: 422 },
    );
  }

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  // ⚠️ The same rule as a note: the contact wins over the lead when both exist. Two
  // definitions of «where this person's record is» drift, and the day they do the values
  // land on the page nobody opens any more while the notes land on the one they read.
  const dove = whereToNote(await findByContactPoint(db, parsed.email, parsed.digits));
  if (!dove) {
    return NextResponse.json({ error: "No person reachable at that contact point" }, { status: 404 });
  }
  const entityId = dove.contactId ?? (dove.leadId as string);
  const entityType = dove.contactId ? "contact" : "lead";

  const slug = Object.keys(campi);
  const candidate: { id: string; slug: string; entityType: string }[] = await db
    .select({
      id: customFieldDefinitions.id,
      slug: customFieldDefinitions.slug,
      entityType: customFieldDefinitions.entityType,
    })
    .from(customFieldDefinitions)
    .where(inArray(customFieldDefinitions.slug, slug));

  // ⚠️⚠️ **The entity is filtered here rather than in the query**, and that is not an
  // oversight. A "budget" declared for leads and one declared for contacts are two separate
  // definitions: reusing the first on a contact would attach the value to a definition the
  // contact screens never read, and the owner would see the field empty despite having been
  // given it. Inside the SQL clause this line would be a guarantee no test with a database
  // double can reach — by this project's rule, a guarantee that does not exist. There are a
  // handful of slugs at most: filtering them here costs nothing and can be defended.
  const perSlug = new Map(candidate.filter((d) => d.entityType === entityType).map((d) => [d.slug, d.id]));
  for (const nome of slug) {
    if (perSlug.has(nome)) continue;
    const [creata] = await db
      .insert(customFieldDefinitions)
      // `text` and not a guessed type: «80 mq» and «circa 8 mila» are what people say, and
      // a number field would reject the answer instead of recording it. The owner can
      // retype the field in the CRM once they see what actually arrives.
      .values({ name: nome, slug: nome, entityType, fieldType: "text" })
      .returning({ id: customFieldDefinitions.id });
    perSlug.set(nome, creata.id);
  }

  const ids = [...perSlug.values()];
  const prima = await leggiValori(db, entityType, entityId, ids, perSlug);

  for (const [nome, valore] of Object.entries(campi)) {
    const fieldId = perSlug.get(nome) as string;
    // ⚠️ Upsert per field, and **only the fields that arrived**: a later collection carries
    // only what it learned this time, and replacing the whole set would silently drop
    // everything gathered before — the rule that watches for a full picture would never
    // see one.
    const [gia] = await db
      .select({ id: customFieldValues.id })
      .from(customFieldValues)
      .where(and(eq(customFieldValues.fieldId, fieldId), eq(customFieldValues.entityId, entityId)));
    if (gia) {
      await db
        .update(customFieldValues)
        .set({ value: valore, updatedAt: new Date() })
        .where(eq(customFieldValues.id, gia.id));
    } else {
      await db.insert(customFieldValues).values({ fieldId, entityType, entityId, value: valore });
    }
  }

  const dopo = await leggiValori(db, entityType, entityId, ids, perSlug);

  // After the response, like every other write that runs rules: the owner's thresholds may
  // send an email or fire a webhook, and none of that belongs inside the request the
  // assistant is waiting on.
  //
  // ⚠️⚠️ The values travel as `customFields`, which is the path a condition uses:
  // `customFields.budget`. The evaluator already walks dots, so nothing new was needed
  // there — but a snapshot that omitted them would make every such rule silently false.
  after(() =>
    runAutomations({
      entityType,
      entityId,
      event: "onUpdate",
      oldData: { id: entityId, customFields: prima },
      newData: { id: entityId, customFields: dopo },
    }),
  );

  return NextResponse.json({ status: "updated", entity: entityType, id: entityId, fields: dopo }, { status: 200 });
}

/**
 * The collected values of one record, keyed by the name the owner used.
 *
 * ⚠️ Keyed by slug and not by id: a condition is written by a person, and «the field whose
 * id is 3f2a…» is not something a person writes.
 */
async function leggiValori(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
  entityType: string,
  entityId: string,
  ids: string[],
  perSlug: Map<string, string>,
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const righe: { fieldId: string; value: string | null }[] = await db
    .select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value })
    .from(customFieldValues)
    .where(and(eq(customFieldValues.entityType, entityType), eq(customFieldValues.entityId, entityId)));
  const nomeDi = new Map([...perSlug.entries()].map(([nome, id]) => [id, nome]));
  const fuori: Record<string, string> = {};
  for (const r of righe) {
    const nome = nomeDi.get(r.fieldId);
    if (nome && r.value !== null) fuori[nome] = r.value;
  }
  return fuori;
}

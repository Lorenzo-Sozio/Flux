"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth-guard";
import { countByContactPoint, type ErasureReport, eraseByContactPoint } from "@/lib/erasure";
import { exportByContactPoint } from "@/lib/subject-access";
import { getDb } from "@/lib/tenant-context";

/**
 * A person's data from their record: export it, or erase them (§13.8).
 *
 * ⚠️ The engines are the ones the API has used all along (src/lib/erasure.ts,
 * src/lib/subject-access.ts): the buttons change who can reach them — an administrator
 * rather than whoever holds an API key and `curl` — and nothing about what they do.
 */

type Refusal = { ok: false; reason: "invalid" };

function invalid(err: unknown): Refusal | null {
  const message = err instanceof Error ? err.message : "";
  return message.startsWith("a contact point must be") || message.startsWith("no contact point")
    ? { ok: false, reason: "invalid" }
    : null;
}

/** Everything held about the person, as one JSON document to hand them. */
export async function exportPersonAction(
  contactPoint: string,
): Promise<{ ok: true; filename: string; json: string } | Refusal> {
  await requireCapability("privacy:manage");
  try {
    const data = await exportByContactPoint(await getDb(), contactPoint);
    return {
      ok: true,
      filename: `personal-data-${data.generatedAt.slice(0, 10)}.json`,
      json: JSON.stringify(data, null, 2),
    };
  } catch (err) {
    const refused = invalid(err);
    if (refused) return refused;
    throw err;
  }
}

/** Who an erasure would reach, before anybody commits to it: the same lookup it uses. */
export async function previewErasureAction(
  contactPoint: string,
): Promise<{ ok: true; found: { lead: number; contact: number } } | Refusal> {
  await requireCapability("privacy:manage");
  try {
    return { ok: true, found: await countByContactPoint(await getDb(), contactPoint) };
  } catch (err) {
    const refused = invalid(err);
    if (refused) return refused;
    throw err;
  }
}

/**
 * Erases the person. The report says what went, what stayed without them and why — which
 * is what whoever answers the person has to be able to tell them.
 */
export async function erasePersonAction(contactPoint: string): Promise<{ ok: true; report: ErasureReport } | Refusal> {
  await requireCapability("privacy:manage");
  try {
    const report = await eraseByContactPoint(await getDb(), contactPoint);
    revalidatePath("/dashboard/contacts");
    revalidatePath("/dashboard/leads");
    return { ok: true, report };
  } catch (err) {
    const refused = invalid(err);
    if (refused) return refused;
    throw err;
  }
}

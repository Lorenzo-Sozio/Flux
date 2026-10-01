"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth-guard";
import { VISIBILITY_MODES, type VisibilityMode, writeVisibilityMode } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

/**
 * Who sees which records in this workspace: the usual rules (`team`) or everybody everything
 * (`all`). An administrator's decision, like who belongs to which group.
 */
export async function setRecordVisibilityAction(mode: VisibilityMode): Promise<{ ok: boolean }> {
  await requireCapability("user:manage");
  if (!(VISIBILITY_MODES as readonly string[]).includes(mode)) return { ok: false };
  await writeVisibilityMode(await getDb(), mode);
  // Every list, record and figure changes for everybody who is not an administrator.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

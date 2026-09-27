"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { getPipelineMembers } from "@/actions/pipeline-members";
import { webForms } from "@/db/schema";
import { getAppUrlOrNull } from "@/lib/app-url";
import { requireCapability } from "@/lib/auth-guard";
import { getTenantById } from "@/lib/get-tenant";
import { can } from "@/lib/permissions";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { turnstileSiteKey } from "@/lib/turnstile";
import { ensureWebForms, WEB_FORM_KINDS, type WebFormKind } from "@/lib/web-forms";

/**
 * Settings → Forms: the workspace's two public forms (src/lib/web-forms.ts), opened,
 * closed and given an owner by whoever manages the workspace.
 */

export interface WebFormSettings {
  kind: WebFormKind;
  enabled: boolean;
  ownerId: string | null;
  /** The hosted page; null without a public origin to put in front of it. */
  url: string | null;
  token: string;
}

export async function getWebFormSettings(): Promise<{
  forms: WebFormSettings[];
  workspace: string | null;
  endpoint: string | null;
  owners: { id: string; name: string }[];
  turnstile: boolean;
}> {
  await requireCapability("settings:manage");
  const tenantId = await getCurrentTenantId();
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  const base = getAppUrlOrNull();
  const rows = await ensureWebForms(await getDb());
  const members = await getPipelineMembers();
  const workspace = tenant?.subdomain ?? null;
  return {
    forms: WEB_FORM_KINDS.map((kind) => {
      const row = rows.find((r) => r.kind === kind);
      return {
        kind,
        enabled: Boolean(row?.enabled),
        ownerId: row?.ownerId ?? null,
        token: row?.id ?? "",
        url: base && workspace && row ? `${base}/f/${workspace}/${row.id}` : null,
      };
    }),
    workspace,
    endpoint: base ? `${base}/api/forms` : null,
    // Somebody who may write: a lead given to a viewer is a lead nobody can work.
    owners: members
      .filter((m) => !m.former && can(m.role ?? null, "record:write"))
      .map((m) => ({ id: m.id, name: m.name ?? m.email ?? m.id })),
    turnstile: turnstileSiteKey() !== null,
  };
}

export async function saveWebFormAction(
  kind: WebFormKind,
  input: { enabled: boolean; ownerId: string | null },
): Promise<{ ok: boolean }> {
  await requireCapability("settings:manage");
  if (!(WEB_FORM_KINDS as readonly string[]).includes(kind)) return { ok: false };
  const db = await getDb();
  await ensureWebForms(db);
  await db
    .update(webForms)
    .set({ enabled: Boolean(input.enabled), ownerId: input.ownerId || null, updatedAt: new Date() })
    .where(eq(webForms.kind, kind));
  revalidatePath("/dashboard/settings/forms");
  return { ok: true };
}

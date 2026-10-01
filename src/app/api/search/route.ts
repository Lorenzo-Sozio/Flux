import { type NextRequest, NextResponse } from "next/server";

import { getActor, getTenantEntitlements } from "@/lib/auth-guard";
import { phoneSearchPatterns, workspaceCallingCode } from "@/lib/contact-point";
import { ENTITIES, type EntityType, entityInPlan } from "@/lib/entities";
import { can } from "@/lib/permissions";
import { recordScope } from "@/lib/record-visibility";
import { SEARCH_PROVIDERS, type SearchHit } from "@/lib/search/providers";
import { getDb } from "@/lib/tenant-context";

/**
 * Global search: every entity in src/lib/entities.ts the person may read and the
 * plan includes, in the registry's order.
 *
 * ⚠️ It searched seven entities by hand-written query, with no capability and no
 * plan check: a workspace without the support module still got tickets back, and
 * invoices, contracts, credit notes, tasks, appointments, campaigns, sequences,
 * products and documents could not be found at all. Adding an entity is now a
 * registry entry and a provider, and the tests fail until both exist.
 *
 * `?types=invoice,quote` narrows it, for the filter chips in the dialog.
 */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ groups: [] });

  const wanted = new Set(
    (req.nextUrl.searchParams.get("types") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
  const entitlements = await getTenantEntitlements().catch(() => null);
  const enabled = entitlements?.enabledModules ?? null;
  const searchable = ENTITIES.filter(
    (def) => can(actor, def.read) && entityInPlan(def, enabled) && (wanted.size === 0 || wanted.has(def.type)),
  );

  const db = await getDb();
  // The workspace's dialling code is read only for a number typed with "+" or "00": a search
  // without one costs what it always did (src/lib/contact-point.ts, `phoneSearchPatterns`).
  const international = /^\s*(\+|00)/.test(q) && q.replace(/\D/g, "").length >= 4;
  const callingCode = international ? await workspaceCallingCode(db) : null;
  const terms = { like: `%${q}%`, phoneLike: phoneSearchPatterns(q, callingCode), scope: await recordScope() };

  // One entity failing (a table a workspace has not migrated yet, say) must not
  // blank the whole palette.
  const settled = await Promise.allSettled(searchable.map((def) => SEARCH_PROVIDERS[def.type](db, terms)));
  const groups: { type: EntityType; hits: SearchHit[] }[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      if (result.value.length) groups.push({ type: searchable[i].type, hits: result.value });
    } else {
      console.error(`[search] ${searchable[i].type} failed`, result.reason);
    }
  });

  return NextResponse.json({ groups });
}

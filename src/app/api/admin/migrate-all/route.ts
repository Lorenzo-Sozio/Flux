import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { platformDb } from "@/db";
import { applyTenantMigrations } from "@/db/migrate-tenant";
import { tenants } from "@/db/schema";
import { requireAdminPanelAccess } from "@/lib/auth-guard";
import { decryptDbUrl } from "@/lib/tenant-db";

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  try {
    await requireAdminPanelAccess();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const allTenants = await platformDb
    .select({ id: tenants.id, subdomain: tenants.subdomain, dbUrl: tenants.dbUrl })
    .from(tenants)
    .orderBy(tenants.createdAt);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let passed = 0;
      let failed = 0;

      for (const tenant of allTenants) {
        try {
          const dbUrl = decryptDbUrl(tenant.dbUrl);
          const sql = neon(dbUrl);
          const db = drizzle(sql);

          // Migrations are embedded in the build rather than read from disk. The
          // drizzle migrator wanted `meta/_journal.json` at runtime, which a
          // deployed server does not carry and a Worker cannot have, so this
          // failed for every tenant with "Can't find meta/_journal.json file".
          const { applied, skipped } = await applyTenantMigrations(db);

          await platformDb.update(tenants).set({ lastMigratedAt: new Date() }).where(eq(tenants.id, tenant.id));

          passed++;
          controller.enqueue(
            enc.encode(
              sseEvent({
                subdomain: tenant.subdomain,
                success: true,
                // Say what actually happened: "nothing to do" and "applied three
                // migrations" both used to render as a bare tick.
                applied,
                alreadyApplied: skipped.length,
              }),
            ),
          );
        } catch (err) {
          failed++;
          controller.enqueue(
            enc.encode(
              sseEvent({
                subdomain: tenant.subdomain,
                success: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            ),
          );
        }
      }

      controller.enqueue(enc.encode(sseEvent({ type: "done", passed, failed, total: allTenants.length })));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

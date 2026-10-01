/**
 * The workspace's logo, as the emails it sends show it.
 *
 * A mail client fetches an email's images with no session, so this route has none: the
 * workspace comes from the signed token (src/lib/brand-logo-token.ts), and the only thing it
 * can return is that workspace's logo.
 *
 * ⚠️ `getDb()` must never be called from this file — there is no `x-tenant-id` here, and it
 * would throw on every request (see CLAUDE.md, "Never call getDb() from a cron route, a
 * webhook, or any public page").
 */
import { NextResponse } from "next/server";

import { verifyBrandLogoToken } from "@/lib/brand-logo-token";
import { openTenantDb } from "@/lib/tenant-resolve";
import { loadWorkspaceLogo } from "@/lib/workspace-logo";

export async function GET(_req: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const tenantId = verifyBrandLogoToken(token);
  if (!tenantId) return new NextResponse("Not found", { status: 404 });

  const db = await openTenantDb(tenantId).catch(() => null);
  const logo = db ? await loadWorkspaceLogo(db) : null;
  if (!logo) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      // The address changes with the logo (`?v=`), so a day of caching serves nobody an old one
      // for long, and every email opened in that day costs no database.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

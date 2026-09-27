import { NextResponse } from "next/server";

import { hasCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";
import { loadWorkspaceLogo } from "@/lib/workspace-logo";

/**
 * The workspace's logo, for the preview in Settings → General. Signed-in members only:
 * the logo reaches customers inside the documents, not from here.
 */
export async function GET() {
  if (!(await hasCapability("record:read").catch(() => false))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const logo = await loadWorkspaceLogo(await getDb());
  if (!logo) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: { "Content-Type": logo.contentType, "Cache-Control": "private, no-store" },
  });
}

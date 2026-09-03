/**
 * /api/documents/[id]  — authenticated file download
 *
 * Security:
 *  - Requires valid session (files are NOT publicly accessible)
 *  - Document ownership check
 *  - Content-Disposition: attachment  (prevents inline execution / XSS)
 *  - X-Content-Type-Options: nosniff  (prevents MIME sniffing)
 *  - Content-Security-Policy: default-src 'none'  (belt-and-suspenders)
 *  - Resolves path via DB record only (no user-controlled path input)
 */

import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { documents } from "@/db/schema";
import { getStorage, isValidStorageKey } from "@/lib/storage";
import { getDb } from "@/lib/tenant-context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const view = req.nextUrl.searchParams.get("view") === "1";
  const db = await getDb();

  // Validate ID format to reject path traversal attempts at the param level
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // ── Fetch record ─────────────────────────────────────────────────────────────
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) {
    return new NextResponse("Not found", { status: 404 });
  }

  // ── Ownership check ──────────────────────────────────────────────────────────
  // ownerId is null for system-created documents (e.g. inbound email attachments).
  // Those are accessible to any authenticated CRM user; user-uploaded docs require ownership.
  if (doc.ownerId !== null && doc.ownerId !== session.user.id) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // ── Read the bytes from object storage ───────────────────────────────────────
  //
  // The key is checked against the shape this application produces before it is
  // used, so a row tampered with in the database still cannot address another
  // object. Rows written before object storage hold a relative disk path
  // ("uploads/<uuid>.pdf"); those are read through the local driver, which is the
  // only place they can be.
  const storage = await getStorage();
  const key = doc.url;

  if (!isValidStorageKey(key) && !/^uploads[/\\][0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/i.test(key)) {
    console.error("[documents] refusing an unrecognised storage key", { id: doc.id });
    return new NextResponse("Forbidden", { status: 403 });
  }

  let fileBuffer: Uint8Array | null;
  try {
    fileBuffer = await storage.get(key);
  } catch (err) {
    console.error("[documents] read failed", { driver: storage.name, err });
    return new NextResponse("Could not read the file.", { status: 502 });
  }

  if (!fileBuffer) {
    // A row whose bytes are gone: the ordinary case for anything uploaded before
    // object storage, since that disk does not survive a deploy.
    return new NextResponse("This file is no longer available.", { status: 404 });
  }

  // ── Safe display filename for Content-Disposition ────────────────────────────
  // RFC 5987 encoding for non-ASCII characters
  const safeAscii = doc.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(doc.name);
  // PDFs with ?view=1 are served inline (browser renders them); all others force download.
  const disposition = view && doc.mimeType === "application/pdf" ? "inline" : "attachment";
  const contentDisposition = `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${encodedName}`;

  return new NextResponse(fileBuffer.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Disposition": contentDisposition,
      "Content-Length": String(fileBuffer.length),
      // Prevent MIME sniffing — the browser must respect Content-Type above
      "X-Content-Type-Options": "nosniff",
      // Belt-and-suspenders: even if somehow rendered inline, block all resources
      "Content-Security-Policy": "default-src 'none'",
      // No caching of sensitive documents
      "Cache-Control": "private, no-store",
    },
  });
}

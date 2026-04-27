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

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join, basename, normalize } from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const view = req.nextUrl.searchParams.get("view") === "1";

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

  // ── Resolve disk path (DB-controlled, not user-controlled) ───────────────────
  // Extra safety: normalize and confirm the resolved path stays inside <cwd>/uploads/
  const uploadsRoot = join(process.cwd(), "uploads");
  const resolved    = normalize(join(process.cwd(), doc.url));
  if (!resolved.startsWith(uploadsRoot + "/") && !resolved.startsWith(uploadsRoot + "\\")) {
    console.error("Path traversal attempt blocked:", doc.url);
    return new NextResponse("Forbidden", { status: 403 });
  }

  // ── Read file ─────────────────────────────────────────────────────────────────
  let fileBuffer: Buffer;
  try {
    fileBuffer = await readFile(resolved);
  } catch {
    return new NextResponse("File not found on server.", { status: 404 });
  }

  // ── Safe display filename for Content-Disposition ────────────────────────────
  // RFC 5987 encoding for non-ASCII characters
  const safeAscii   = doc.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(doc.name);
  // PDFs with ?view=1 are served inline (browser renders them); all others force download.
  const disposition = view && doc.mimeType === "application/pdf" ? "inline" : "attachment";
  const contentDisposition =
    `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${encodedName}`;

  return new NextResponse(fileBuffer.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":           doc.mimeType ?? "application/octet-stream",
      "Content-Disposition":    contentDisposition,
      "Content-Length":         String(fileBuffer.length),
      // Prevent MIME sniffing — the browser must respect Content-Type above
      "X-Content-Type-Options": "nosniff",
      // Belt-and-suspenders: even if somehow rendered inline, block all resources
      "Content-Security-Policy": "default-src 'none'",
      // No caching of sensitive documents
      "Cache-Control":           "private, no-store",
    },
  });
}

/**
 * Secure document upload endpoint.
 *
 * Security measures:
 *  - MIME type strict whitelist (no SVG, HTML, JS, PHP, etc.)
 *  - File extension whitelist cross-checked against declared MIME type
 *  - Magic bytes verification (rejects MIME spoofing)
 *  - UUID-based storage filename (prevents directory traversal & collisions)
 *  - Files stored OUTSIDE /public (not directly accessible; served via auth route)
 *  - Entity type limited to known CRM entities
 *  - Authenticated session required
 *  - 10 MB max size
 */

import { type NextRequest, NextResponse } from "next/server";

import { extname } from "node:path";

import { sql } from "drizzle-orm";

import { auth } from "@/auth";
import { documents } from "@/db/schema";
import { EntitlementError, requirePlanLimit } from "@/lib/auth-guard";
import { getStorage, newStorageKey } from "@/lib/storage";
import { getDb } from "@/lib/tenant-context";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/** Strict whitelist: declared MIME → allowed file extensions */
const ALLOWED: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
};

/**
 * Entities a document can be attached to.
 *
 * The upload route allowed four and the list route five, so a ticket attachment
 * could be listed and never uploaded through the UI. Quotes and orders were
 * missing from both — the two places where "here is the signed copy" matters most
 * (audit rilievo B-06).
 */
const VALID_ENTITY_TYPES = new Set(["contact", "lead", "company", "deal", "ticket", "quote", "order"]);

/**
 * Verify file magic bytes against the declared MIME type.
 * Returns false if the content does not match the claimed type.
 */
function verifyMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (buf.length < 12) return false;

  switch (mimeType) {
    case "application/pdf":
      // %PDF
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;

    case "image/jpeg":
      // FF D8 FF
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

    case "image/png":
      // 89 50 4E 47 0D 0A 1A 0A
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

    case "image/gif":
      // GIF87a or GIF89a
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;

    case "image/webp":
      // RIFF....WEBP
      return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";

    // OOXML formats (docx / xlsx / pptx) are ZIP archives
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      // PK\x03\x04
      return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

    // Legacy Office formats (OLE Compound Document)
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      // D0 CF 11 E0
      return buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;

    // Text formats — no reliable magic bytes; rely on extension + MIME whitelist
    case "text/plain":
    case "text/csv":
      return true;

    default:
      return false;
  }
}

export async function POST(req: NextRequest) {
  const db = await getDb();
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // ── Parse form data ─────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const entityType = (formData.get("entityType") as string | null)?.trim();
  const entityId = (formData.get("entityId") as string | null)?.trim();

  // ── Validate inputs ─────────────────────────────────────────────────────────
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }
  if (!entityType || !VALID_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json({ error: "Invalid entity type." }, { status: 400 });
  }
  if (!entityId || !/^[a-zA-Z0-9_-]{1,128}$/.test(entityId)) {
    return NextResponse.json({ error: "Invalid entity ID." }, { status: 400 });
  }

  // ── MIME type check ─────────────────────────────────────────────────────────
  const declaredMime = file.type.toLowerCase().split(";")[0].trim();
  const allowedExts = ALLOWED[declaredMime];
  if (!allowedExts) {
    return NextResponse.json({ error: `File type "${declaredMime}" is not allowed.` }, { status: 415 });
  }

  // ── Extension check (cross-validate against MIME) ───────────────────────────
  const originalExt = extname(file.name).toLowerCase();
  if (!allowedExts.includes(originalExt)) {
    return NextResponse.json(
      { error: `Extension "${originalExt}" does not match the declared file type.` },
      { status: 415 },
    );
  }

  // ── Magic bytes check ────────────────────────────────────────────────────────
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (!verifyMagicBytes(buffer, declaredMime)) {
    return NextResponse.json(
      { error: "File content does not match the declared type (magic bytes mismatch)." },
      { status: 415 },
    );
  }

  // ── Plan storage quota ──────────────────────────────────────────────────────
  //
  // `storageGb` was declared on every plan and checked nowhere, so the limit the
  // customer is paying for did not exist (audit rilievo D-07). Counted from the
  // rows rather than from the bucket: the rows are what the customer can reach,
  // and an orphaned object is our problem, not theirs.
  try {
    const [used] = await db.select({ bytes: sql<number>`coalesce(sum(${documents.size}), 0)::bigint` }).from(documents);
    const usedGb = Number(used?.bytes ?? 0) / 1_000_000_000;
    await requirePlanLimit("storageGb", usedGb + file.size / 1_000_000_000);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    // A quota check that cannot run must not block an upload.
    console.error("[documents] storage quota check failed", err);
  }

  // ── Store the bytes ─────────────────────────────────────────────────────────
  //
  // Object storage, not the local disk. On Workers there is no disk; on Vercel
  // there is one, which is worse — the write succeeds and the file is gone by the
  // next deploy, leaving a document row that points at nothing (rilievo B-06).
  //
  // The key carries nothing from the uploaded filename except a validated
  // extension, so an attacker-controlled name never reaches a path.
  const storage = await getStorage();
  const storageKey = newStorageKey(file.name);

  try {
    await storage.put(storageKey, new Uint8Array(buffer), declaredMime);
  } catch (err) {
    console.error("[documents] upload failed", { driver: storage.name, err });
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  // ── Persist record ──────────────────────────────────────────────────────────
  // `url` holds the storage key. It has never held a public URL; the serve route
  // is the only way to read a document.
  try {
    const [doc] = await db
      .insert(documents)
      .values({
        name: file.name, // original display name
        url: storageKey,
        mimeType: declaredMime,
        size: file.size,
        entityType,
        entityId,
        ownerId: userId,
      })
      .returning();

    return NextResponse.json({ success: true, document: doc });
  } catch (err) {
    // The row is what makes a file reachable, so a stored object without one is
    // unreferenced bytes accruing cost. Remove it.
    await storage.delete(storageKey).catch(() => undefined);
    console.error("[documents] record insert failed", err);
    return NextResponse.json({ error: "Failed to save document record." }, { status: 500 });
  }
}

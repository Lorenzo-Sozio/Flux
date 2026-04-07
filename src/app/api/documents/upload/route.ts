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

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { writeFile, mkdir } from "fs/promises";
import { join, extname } from "path";

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

/** CRM entity types that accept attachments */
const VALID_ENTITY_TYPES = new Set(["contact", "lead", "company"]);

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
      return (
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      );

    case "image/gif":
      // GIF87a or GIF89a
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;

    case "image/webp":
      // RIFF....WEBP
      return (
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WEBP"
      );

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
  const entityId   = (formData.get("entityId")   as string | null)?.trim();

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
  const allowedExts  = ALLOWED[declaredMime];
  if (!allowedExts) {
    return NextResponse.json(
      { error: `File type "${declaredMime}" is not allowed.` },
      { status: 415 }
    );
  }

  // ── Extension check (cross-validate against MIME) ───────────────────────────
  const originalExt = extname(file.name).toLowerCase();
  if (!allowedExts.includes(originalExt)) {
    return NextResponse.json(
      { error: `Extension "${originalExt}" does not match the declared file type.` },
      { status: 415 }
    );
  }

  // ── Magic bytes check ────────────────────────────────────────────────────────
  const bytes  = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (!verifyMagicBytes(buffer, declaredMime)) {
    return NextResponse.json(
      { error: "File content does not match the declared type (magic bytes mismatch)." },
      { status: 415 }
    );
  }

  // ── Store file OUTSIDE /public using a UUID filename ────────────────────────
  // UUID-based name prevents directory traversal and filename collisions.
  const storageId   = crypto.randomUUID();
  const storageName = `${storageId}${originalExt}`;          // e.g. "uuid.pdf"
  const storagePath = join("uploads", storageName);           // relative
  const diskPath    = join(process.cwd(), storagePath);

  try {
    await mkdir(join(process.cwd(), "uploads"), { recursive: true });
    await writeFile(diskPath, buffer);
  } catch (err) {
    console.error("Upload write error:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  // ── Persist record ──────────────────────────────────────────────────────────
  // `url` stores the relative path used by the serve route.
  try {
    const [doc] = await db
      .insert(documents)
      .values({
        name:       file.name,          // original display name
        url:        storagePath,        // relative disk path (NOT a public URL)
        mimeType:   declaredMime,
        size:       file.size,
        entityType,
        entityId,
        ownerId:    userId,
      })
      .returning();

    return NextResponse.json({ success: true, document: doc });
  } catch (err) {
    // Clean up orphaned file on DB failure
    const { unlink } = await import("fs/promises");
    await unlink(diskPath).catch(() => {});
    console.error("Document DB insert error:", err);
    return NextResponse.json({ error: "Failed to save document record." }, { status: 500 });
  }
}

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

import { auth } from "@/auth";
import { documents } from "@/db/schema";
import { EntitlementError, requirePlanLimit } from "@/lib/auth-guard";
import { serverT } from "@/lib/i18n-server";
import { getStorage, newStorageKey } from "@/lib/storage";
import { storageBytesUsed } from "@/lib/storage-usage";
import { getDb } from "@/lib/tenant-context";
import { checkUpload } from "@/lib/upload-validation";

/**
 * Entities a document can be attached to.
 *
 * The upload route allowed four and the list route five, so a ticket attachment
 * could be listed and never uploaded through the UI. Quotes and orders were
 * missing from both — the two places where "here is the signed copy" matters most
 * (audit rilievo B-06).
 */
const VALID_ENTITY_TYPES = new Set(["contact", "lead", "company", "deal", "ticket", "quote", "order"]);

export async function POST(req: NextRequest) {
  const db = await getDb();
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: (await serverT())("generic.unauthenticated") }, { status: 401 });
  }
  const userId = session.user.id;

  // ── Parse form data ─────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: (await serverT("serverErrors.documents"))("invalidRequest") }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const entityType = (formData.get("entityType") as string | null)?.trim();
  const entityId = (formData.get("entityId") as string | null)?.trim();

  // ── Validate inputs ─────────────────────────────────────────────────────────
  if (!entityType || !VALID_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json(
      { error: (await serverT("serverErrors.documents"))("invalidEntityType") },
      { status: 400 },
    );
  }
  if (!entityId || !/^[a-zA-Z0-9_-]{1,128}$/.test(entityId)) {
    return NextResponse.json({ error: (await serverT("serverErrors.documents"))("invalidEntityId") }, { status: 400 });
  }

  // ── Type, extension and magic bytes: the checks every upload shares ─────────
  const checked = await checkUpload(file);
  if (!checked.ok) {
    return NextResponse.json(
      { error: (await serverT("serverErrors.documents"))(checked.error, checked.values) },
      { status: checked.status },
    );
  }
  const declaredMime = checked.mime;
  const buffer = checked.bytes;
  // Narrowed by the check above: a file that passed it exists.
  const upload = file as File;

  // ── Plan storage quota ──────────────────────────────────────────────────────
  //
  // `storageGb` was declared on every plan and checked nowhere, so the limit the
  // customer is paying for did not exist (audit rilievo D-07). Counted from the
  // rows rather than from the bucket: the rows are what the customer can reach,
  // and an orphaned object is our problem, not theirs.
  try {
    // Documents and chat files together: one quota, whichever way the bytes came in.
    const usedGb = (await storageBytesUsed(db)) / 1_000_000_000;
    await requirePlanLimit("storageGb", usedGb + upload.size / 1_000_000_000);
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
  const storageKey = newStorageKey(upload.name);

  try {
    await storage.put(storageKey, buffer, declaredMime);
  } catch (err) {
    console.error("[documents] upload failed", { driver: storage.name, err });
    return NextResponse.json({ error: (await serverT("serverErrors.documents"))("uploadFailed") }, { status: 500 });
  }

  // ── Persist record ──────────────────────────────────────────────────────────
  // `url` holds the storage key. It has never held a public URL; the serve route
  // is the only way to read a document.
  try {
    const [doc] = await db
      .insert(documents)
      .values({
        name: upload.name, // original display name
        url: storageKey,
        mimeType: declaredMime,
        size: upload.size,
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
    return NextResponse.json({ error: (await serverT("serverErrors.documents"))("saveFailed") }, { status: 500 });
  }
}

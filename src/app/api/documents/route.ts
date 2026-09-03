/**
 * /api/documents
 *
 * GET  ?entityType=contact&entityId=xxx  — list documents for an entity
 * DELETE ?id=xxx                          — delete a document (owner only)
 */

import { type NextRequest, NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { documents } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { getDb } from "@/lib/tenant-context";

const VALID_ENTITY_TYPES = new Set(["contact", "lead", "company", "deal", "ticket", "quote", "order"]);

export async function GET(req: NextRequest) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entityType = req.nextUrl.searchParams.get("entityType");
  const entityId = req.nextUrl.searchParams.get("entityId");

  if (!entityType || !VALID_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json({ error: "Invalid entity type." }, { status: 400 });
  }
  if (!entityId || !/^[a-zA-Z0-9_-]{1,128}$/.test(entityId)) {
    return NextResponse.json({ error: "Invalid entity ID." }, { status: 400 });
  }

  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId)))
    .orderBy(documents.createdAt);

  return NextResponse.json({ documents: docs });
}

export async function DELETE(req: NextRequest) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return NextResponse.json({ error: "Invalid document ID." }, { status: 400 });
  }

  // Verify the document exists and belongs to this user
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Remove the row first: it is what makes the file reachable. If the object then
  // fails to delete, the result is unreferenced bytes rather than a document the
  // user was told was gone and can still open.
  await db.delete(documents).where(eq(documents.id, id));

  if (doc.url) {
    const storage = await getStorage();
    await storage.delete(doc.url).catch((err) => {
      console.error("[documents] object delete failed, row already removed", { id, err });
    });
  }
  return NextResponse.json({ success: true });
}

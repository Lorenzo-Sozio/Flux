/**
 * GET /api/chat/attachments/[id] — a file sent in the chat, to members of its conversation.
 *
 * ⚠️ Membership is checked on every read, not at send time only: someone who left a
 * group can no longer open what was shared in it, and a link forwarded outside the
 * conversation opens for nobody else.
 *
 * Images may be shown inline (`?view=1`), which is how a thread previews them; every
 * other type is a download. Either way `nosniff` and a CSP that allows nothing, the
 * same belt-and-braces as the document route.
 */
import { type NextRequest, NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { dmAttachments, dmConversationMembers } from "@/db/schema";
import { getStorage, isValidStorageKey } from "@/lib/storage";
import { getDb } from "@/lib/tenant-context";
import { INLINE_IMAGE_TYPES } from "@/lib/upload-validation";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return new NextResponse("Not found", { status: 404 });

  const db = await getDb();
  const [file] = await db
    .select({
      storageKey: dmAttachments.storageKey,
      name: dmAttachments.name,
      mimeType: dmAttachments.mimeType,
    })
    .from(dmAttachments)
    .innerJoin(
      dmConversationMembers,
      and(
        eq(dmConversationMembers.conversationId, dmAttachments.conversationId),
        eq(dmConversationMembers.userId, session.user.id),
      ),
    )
    .where(eq(dmAttachments.id, id));
  // Not a member and no such file answer the same: a 403 would confirm the id exists.
  if (!file) return new NextResponse("Not found", { status: 404 });

  if (!isValidStorageKey(file.storageKey)) {
    console.error("[chat] refusing an unrecognised storage key", { id });
    return new NextResponse("Forbidden", { status: 403 });
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await (await getStorage()).get(file.storageKey);
  } catch (err) {
    console.error("[chat] attachment read failed", err);
    return new NextResponse("Could not read the file.", { status: 502 });
  }
  if (!bytes) return new NextResponse("This file is no longer available.", { status: 404 });

  const inline = req.nextUrl.searchParams.get("view") === "1" && INLINE_IMAGE_TYPES.has(file.mimeType);
  const safeAscii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`;

  return new NextResponse(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
}

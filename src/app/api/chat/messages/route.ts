/**
 * POST /api/chat/messages — a chat message carrying a file.
 *
 * A route rather than a server action because of the body: server actions take one
 * megabyte by default, and a chat file may be ten. Everything else is the path a
 * text message takes (src/lib/chat-send.ts): the same membership check, the same
 * notifications, the same read mark.
 *
 * The file goes through the checks every upload shares (src/lib/upload-validation.ts):
 * declared type against a whitelist, extension against the type, first bytes against
 * both. Its key carries nothing from the filename but a validated extension, and it is
 * served back only through /api/chat/attachments/[id], to members of the conversation.
 */
import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { EntitlementError, requirePlanLimit } from "@/lib/auth-guard";
import { NotAMemberError, postChatMessage } from "@/lib/chat-send";
import { serverT } from "@/lib/i18n-server";
import { getStorage, newStorageKey } from "@/lib/storage";
import { storageBytesUsed } from "@/lib/storage-usage";
import { getDb } from "@/lib/tenant-context";
import { checkUpload } from "@/lib/upload-validation";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: (await serverT())("generic.unauthenticated") }, { status: 401 });
  }
  const tDocs = await serverT("serverErrors.documents");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: tDocs("invalidRequest") }, { status: 400 });
  }

  const conversationId = String(form.get("conversationId") ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(conversationId)) {
    return NextResponse.json({ error: tDocs("invalidRequest") }, { status: 400 });
  }
  const content = String(form.get("content") ?? "");
  let mentionIds: string[] = [];
  try {
    const raw = JSON.parse(String(form.get("mentionIds") ?? "[]"));
    if (Array.isArray(raw)) mentionIds = raw.filter((x): x is string => typeof x === "string").slice(0, 50);
  } catch {
    // No mentions is a message still worth sending.
  }

  const checked = await checkUpload(form.get("file") as File | null);
  if (!checked.ok) {
    return NextResponse.json({ error: tDocs(checked.error, checked.values) }, { status: checked.status });
  }
  const file = form.get("file") as File;

  const db = await getDb();
  try {
    await requirePlanLimit("storageGb", ((await storageBytesUsed(db)) + file.size) / 1_000_000_000);
  } catch (err) {
    if (err instanceof EntitlementError) return NextResponse.json({ error: err.message }, { status: 402 });
    // A quota check that cannot run must not block a message.
    console.error("[chat] storage quota check failed", err);
  }

  const storage = await getStorage();
  const storageKey = newStorageKey(file.name);
  try {
    await storage.put(storageKey, checked.bytes, checked.mime);
  } catch (err) {
    console.error("[chat] attachment upload failed", { driver: storage.name, err });
    return NextResponse.json({ error: tDocs("uploadFailed") }, { status: 500 });
  }

  try {
    const message = await postChatMessage(
      db,
      { id: session.user.id, name: session.user.name, email: session.user.email },
      conversationId,
      content,
      { attachment: { storageKey, name: file.name, mimeType: checked.mime, size: file.size }, mentionIds },
    );
    return NextResponse.json({ message });
  } catch (err) {
    // The row is what makes the bytes reachable: without it they are cost and nothing else.
    await storage.delete(storageKey).catch(() => undefined);
    if (err instanceof NotAMemberError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[chat] message with attachment failed", err);
    return NextResponse.json({ error: tDocs("saveFailed") }, { status: 500 });
  }
}

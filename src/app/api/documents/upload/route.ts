/**
 * Simple document upload endpoint.
 * Saves files to /public/uploads/<userId>/<filename> in development.
 * In production, replace writeFile with an S3/R2/Uploadthing call.
 *
 * To use Uploadthing in production:
 *   1. npm install uploadthing @uploadthing/react
 *   2. Add UPLOADTHING_SECRET + UPLOADTHING_APP_ID to .env
 *   3. Replace the fs.writeFile section below with uploadthing SDK call
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const entityType = formData.get("entityType") as string | null;
  const entityId = formData.get("entityId") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });

  // Sanitise filename
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueName = `${Date.now()}_${safeName}`;
  const userId = session.user.id;

  try {
    // --- LOCAL DEV: save to /public/uploads ---
    const uploadDir = join(process.cwd(), "public", "uploads", userId);
    await mkdir(uploadDir, { recursive: true });
    const bytes = await file.arrayBuffer();
    await writeFile(join(uploadDir, uniqueName), Buffer.from(bytes));
    const url = `/uploads/${userId}/${uniqueName}`;
    // -----------------------------------------

    const [doc] = await db
      .insert(documents)
      .values({
        name: file.name,
        url,
        mimeType: file.type,
        size: file.size,
        entityType: entityType ?? undefined,
        entityId: entityId ?? undefined,
        ownerId: userId,
      })
      .returning();

    return NextResponse.json({ success: true, document: doc });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}

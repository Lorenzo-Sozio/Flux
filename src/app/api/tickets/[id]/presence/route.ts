import { NextResponse } from "next/server";

import { auth } from "@/auth";

interface PresenceRecord {
  userId: string;
  userName: string;
  action: "viewing" | "typing";
  updatedAt: number;
}

// In-memory store: ticketId → Map<userId, PresenceRecord>
// Intentionally module-level — survives across requests in same instance.
const store = new Map<string, Map<string, PresenceRecord>>();

const TTL_MS = 30_000;

function getTicketPresence(ticketId: string): PresenceRecord[] {
  const ticket = store.get(ticketId);
  if (!ticket) return [];
  const now = Date.now();
  const active: PresenceRecord[] = [];
  for (const [userId, record] of ticket.entries()) {
    if (now - record.updatedAt > TTL_MS) {
      ticket.delete(userId);
    } else {
      active.push(record);
    }
  }
  return active;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  return NextResponse.json(getTicketPresence(id));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action: "viewing" | "typing" = body.action === "typing" ? "typing" : "viewing";

  if (!store.has(id)) store.set(id, new Map());
  store.get(id)!.set(session.user.id, {
    userId: session.user.id,
    userName: session.user.name ?? session.user.email ?? "Agent",
    action,
    updatedAt: Date.now(),
  });

  return NextResponse.json({ ok: true });
}

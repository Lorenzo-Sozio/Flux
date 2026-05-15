import { auth } from "@/auth";

import { timingSafeEqual } from "node:crypto";

export interface ApiAuthResult {
  via: "session" | "apikey";
  userId: string | null;
  role: string;
}

export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult | null> {
  const authHeader = req.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const provided = authHeader.slice(7).trim();
    const apiKey = process.env.IMPORT_API_KEY?.trim();

    if (apiKey && provided) {
      try {
        const a = Buffer.from(provided);
        const b = Buffer.from(apiKey);
        if (a.length === b.length && timingSafeEqual(a, b)) {
          return { via: "apikey", userId: null, role: "editor" };
        }
      } catch (_err) {
        // ignore buffer/comparison errors
      }
    }

    return null;
  }

  const session = await auth();
  if (!session?.user?.id) return null;

  const role = (session.user as { role?: string }).role ?? "viewer";
  if (role === "viewer") return null;

  return { via: "session", userId: session.user.id, role };
}

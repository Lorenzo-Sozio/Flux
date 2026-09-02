import { type NextRequest, NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron-auth";
import { getDb } from "@/lib/tenant-context";
import { riprova } from "@/lib/webhook-retry";

/**
 * Riprova le consegne di webhook fallite.
 *
 *   Vercel:   vercel.json → { "crons": [{ "path": "/api/cron/webhook-retry", "schedule": "*␣/5 * * * *" }] }
 *   Esterno:  curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/webhook-retry
 *
 * ⚠️ **Senza questo, un evento perso è perso**, e chi lo aspettava non ha modo di saperlo:
 * un'integrazione che riceve gli eventi «quasi sempre» è un'integrazione di cui non ci si
 * può fidare per decidere qualcosa.
 *
 * Che cosa riprovare lo decide `lib/webhook-retry`, che è pura e testata: qui c'è solo
 * l'autenticazione del cron e il database.
 */
export async function GET(req: NextRequest) {
  const rifiuto = verifyCronRequest(req);
  if (rifiuto) return rifiuto;

  const db = await getDb();
  return NextResponse.json(await riprova(db));
}

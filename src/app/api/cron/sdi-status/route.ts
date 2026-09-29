import { inArray } from "drizzle-orm";

import { invoices } from "@/db/schema";
import { runCronJob } from "@/lib/cron-runner";
import { notifyMany } from "@/lib/notify";
import { changesToTell, pollSdiStatuses } from "@/lib/sdi/transmit";
import type { SdiStatus } from "@/lib/sdi/types";

/**
 * What SDI said about the invoices handed to the workspace's intermediary, for every workspace.
 *
 *   Esterno:  curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/sdi-status
 *
 * ⚠️⚠️ **Without this a discarded invoice looks issued.** SDI answers hours later; an invoice it
 * discards (scartata) was never issued for the tax authority, and the customer never receives
 * it. The person who issued it is told, once: only the run whose conditional update wrote the
 * change notifies (`changesToTell`), so two runs crossing do not ring twice.
 */
const KEYS: Partial<
  Record<SdiStatus, "sdiRejected" | "sdiNotDelivered" | "sdiRefused" | "sdiError" | "sdiSendFailed">
> = {
  rejected: "sdiRejected",
  not_delivered: "sdiNotDelivered",
  refused: "sdiRefused",
  error: "sdiError",
  send_failed: "sdiSendFailed",
};

export async function GET(req: Request) {
  return runCronJob("sdi-status", req, async (db) => {
    const run = await pollSdiStatuses(db);
    const tell = changesToTell(run.changes);
    if (tell.length > 0) {
      const rows: { id: string; documentNumber: string | null; issuedBy: string | null }[] = await db
        .select({ id: invoices.id, documentNumber: invoices.documentNumber, issuedBy: invoices.issuedBy })
        .from(invoices)
        .where(
          inArray(
            invoices.id,
            tell.map((c) => c.invoiceId),
          ),
        );
      await notifyMany(
        tell.flatMap((c) => {
          const invoice = rows.find((r) => r.id === c.invoiceId);
          const key = KEYS[c.to];
          return invoice?.issuedBy && key
            ? [
                {
                  userId: invoice.issuedBy,
                  type: "sdi_status",
                  key,
                  params: { number: invoice.documentNumber ?? "" },
                  link: `/dashboard/sales/invoices/${invoice.id}`,
                },
              ]
            : [];
        }),
      );
    }
    return { checked: run.checked, changed: run.changes.length, interrupted: run.interrupted };
  });
}

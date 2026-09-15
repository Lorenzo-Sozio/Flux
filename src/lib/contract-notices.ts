import { and, eq, isNull, ne, or } from "drizzle-orm";

import { contracts } from "@/db/schema";
import {
  addDays,
  contractPhase,
  currentTermEnd,
  noticeDeadline,
  type StoredContract,
  termsOf,
  today,
} from "@/lib/contract-terms";
import { notify } from "@/lib/notify";
import { tolerateUnmigrated } from "@/lib/schema-ready";

/**
 * Telling a contract's owner that a renewal decision is coming.
 *
 * Runs inside the daily `task-overdue-check` job, once per workspace: no new cron
 * trigger, because the Free plan has none left.
 *
 * ⚠️⚠️ **Once per term, and the write decides.** The job runs every day for the
 * whole month a contract is due, and more than once on a day it is retried. The
 * row is claimed with a conditional update on `notice_sent_for` before anyone is
 * told, so two runs racing produce one notification, and the next term of a
 * self-renewing contract — a different end date — gets its own.
 *
 * ⚠️ If the notification cannot be written, the claim is given back, so tomorrow's
 * run tries again instead of the renewal passing in silence.
 */

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

type NoticeRow = StoredContract & {
  id: string;
  title: string;
  ownerId: string | null;
  createdBy: string | null;
  noticeSentFor: string | null;
};

export async function sendContractNotices(db: AnyDb, on = today()) {
  const rows: NoticeRow[] = await tolerateUnmigrated(
    "contracts",
    () =>
      db
        .select({
          id: contracts.id,
          title: contracts.title,
          ownerId: contracts.ownerId,
          createdBy: contracts.createdBy,
          noticeSentFor: contracts.noticeSentFor,
          status: contracts.status,
          amount: contracts.amount,
          billingPeriod: contracts.billingPeriod,
          startDate: contracts.startDate,
          endDate: contracts.endDate,
          autoRenew: contracts.autoRenew,
          renewalTermMonths: contracts.renewalTermMonths,
          noticeDays: contracts.noticeDays,
        })
        .from(contracts)
        .where(eq(contracts.status, "active")),
    [],
  );

  let due = 0;
  let notified = 0;
  let unowned = 0;

  for (const row of rows) {
    const terms = termsOf(row);
    if (contractPhase(terms, on) !== "renewal_due") continue;
    const end = currentTermEnd(terms, on);
    if (!end || row.noticeSentFor === end) continue;
    due++;

    // Nobody to tell is not a reason to mark it told: it stays due until someone owns it.
    const recipient = row.ownerId ?? row.createdBy;
    if (!recipient) {
      unowned++;
      continue;
    }

    const claimed = await db
      .update(contracts)
      .set({ noticeSentFor: end })
      .where(and(eq(contracts.id, row.id), or(isNull(contracts.noticeSentFor), ne(contracts.noticeSentFor, end))))
      .returning({ id: contracts.id });
    if (claimed.length === 0) continue; // another run got there first

    const deadline = noticeDeadline(end, terms.noticeDays);
    const message = terms.autoRenew
      ? `It renews itself on ${addDays(end, 1)} unless notice is given by ${deadline}.`
      : `It ends on ${end}. Notice to renew or cancel is due by ${deadline}.`;
    try {
      await notify({
        userId: recipient,
        type: "contract_renewal",
        title: `Contract "${row.title}" is due for a decision`,
        message,
        link: "/dashboard/sales/contracts?view=renewal_due",
      });
      notified++;
    } catch (err) {
      await db
        .update(contracts)
        .set({ noticeSentFor: row.noticeSentFor })
        .where(and(eq(contracts.id, row.id), eq(contracts.noticeSentFor, end)));
      throw err;
    }
  }

  return { due, notified, unowned };
}

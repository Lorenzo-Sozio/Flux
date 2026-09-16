"use server";

import { revalidatePath } from "next/cache";

import { asc, eq } from "drizzle-orm";

import { companies, contacts, contracts, users } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import {
  type ContractInput,
  type ContractPhase,
  cleanContract,
  contractPhase,
  currentTermEnd,
  monthlyRecurringRevenue,
  monthlyValue,
  noticeDeadline,
  termsOf,
  today,
} from "@/lib/contract-terms";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";

const PAGE = "/dashboard/sales/contracts";

export type ContractRow = typeof contracts.$inferSelect & {
  companyName: string | null;
  ownerName: string | null;
  phase: ContractPhase;
  termEnd: string | null;
  noticeBy: string | null;
  monthly: number;
};

export type ContractResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Every contract, with where it stands today.
 *
 * The phase is computed here, on the server, from one notion of "today" — so the
 * list, its filters and its totals cannot disagree about which contracts are due.
 */
export async function getContracts(): Promise<{ rows: ContractRow[]; on: string; mrr: number }> {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();
  const on = today();

  const rows = await tolerateUnmigrated(
    "contracts",
    () =>
      db
        .select({ contract: contracts, companyName: companies.name, ownerName: users.name })
        .from(contracts)
        .leftJoin(companies, eq(companies.id, contracts.companyId))
        .leftJoin(users, eq(users.id, contracts.ownerId))
        .orderBy(asc(contracts.endDate), asc(contracts.title)),
    [],
  );

  const out: ContractRow[] = rows.map(({ contract, companyName, ownerName }) => {
    const terms = termsOf(contract);
    const termEnd = currentTermEnd(terms, on);
    return {
      ...contract,
      companyName,
      ownerName,
      phase: contractPhase(terms, on),
      termEnd,
      noticeBy: termEnd ? noticeDeadline(termEnd, terms.noticeDays) : null,
      monthly: monthlyValue(terms),
    };
  });

  return {
    rows: out,
    on,
    mrr: monthlyRecurringRevenue(
      rows.map((r) => termsOf(r.contract)),
      on,
    ),
  };
}

/**
 * Recurring revenue for the dashboard: the monthly figure and how many renewals
 * are in their notice period today.
 *
 * ⚠️ Reads only contracts not cancelled or in draft; which of those are earning is
 * decided by the same function the contracts page uses.
 */
export async function getRecurringRevenueSummary(): Promise<{ mrr: number; earning: number; renewalsDue: number }> {
  await requireCapability("record:read");
  const db = await getDb();
  const on = today();
  const rows = await tolerateUnmigrated(
    "contracts",
    () => db.select().from(contracts).where(eq(contracts.status, "active")),
    [],
  );
  const terms = rows.map(termsOf);
  const phases = terms.map((c) => contractPhase(c, on));
  return {
    mrr: monthlyRecurringRevenue(terms, on),
    earning: phases.filter((p) => p === "active" || p === "renewal_due").length,
    renewalsDue: phases.filter((p) => p === "renewal_due").length,
  };
}

/** One contract, for the edit page. */
export async function getContract(id: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const [row] = await db.select().from(contracts).where(eq(contracts.id, id));
  return row ?? null;
}

/**
 * The pickers the contract form needs, loaded on the server.
 *
 * Same reason as the quote form: fetching them from the browser draws the page with
 * three empty selects and fills them a round trip later.
 */
export async function getContractFormData() {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();
  const [companyList, contactList, userList] = await Promise.all([
    db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(asc(companies.name)),
    db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        companyId: contacts.companyId,
      })
      .from(contacts)
      .orderBy(asc(contacts.firstName), asc(contacts.lastName)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)),
  ]);
  return { companies: companyList, contacts: contactList, users: userList };
}

export async function createContract(input: ContractInput): Promise<ContractResult> {
  const actor = await requireCapability("contract:write");
  await requirePlanModule("sales");
  const cleaned = cleanContract(input);
  if (!cleaned.ok) return cleaned;

  const db = await getDb();
  const [row] = await db
    .insert(contracts)
    .values({
      ...cleaned.value,
      amount: String(cleaned.value.amount),
      ownerId: cleaned.value.ownerId ?? actor.userId,
      cancelledAt: cleaned.value.status === "cancelled" ? new Date() : null,
      createdBy: actor.userId,
    })
    .returning({ id: contracts.id });
  revalidatePath(PAGE);
  return { ok: true, id: row.id };
}

export async function updateContract(id: string, input: ContractInput): Promise<ContractResult> {
  await requireCapability("contract:write");
  await requirePlanModule("sales");
  const cleaned = cleanContract(input);
  if (!cleaned.ok) return cleaned;

  const db = await getDb();
  const [existing] = await db
    .select({ status: contracts.status, cancelledAt: contracts.cancelledAt })
    .from(contracts)
    .where(eq(contracts.id, id));
  if (!existing) return { ok: false, error: "This contract no longer exists." };

  const cancelling = cleaned.value.status === "cancelled";
  await db
    .update(contracts)
    .set({
      ...cleaned.value,
      amount: String(cleaned.value.amount),
      // When it was cancelled is kept from the first time, and cleared if it is reinstated.
      cancelledAt: cancelling ? (existing.cancelledAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, id));
  revalidatePath(PAGE);
  return { ok: true, id };
}

export async function deleteContract(id: string): Promise<{ ok: true }> {
  await requireCapability("contract:delete");
  await requirePlanModule("sales");
  const db = await getDb();
  await db.delete(contracts).where(eq(contracts.id, id));
  revalidatePath(PAGE);
  return { ok: true };
}

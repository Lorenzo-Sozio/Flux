import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { unparse } from "papaparse";

import { companies } from "@/db/schema";
import {
  EntitlementError,
  ForbiddenError,
  requireCapability,
  requirePlanModule,
  UnauthenticatedError,
} from "@/lib/auth-guard";
import { customerStatement } from "@/lib/customer-statement";
import { serverT } from "@/lib/i18n-server";
import { getDb } from "@/lib/tenant-context";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A customer's statement of account as CSV (I14): `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both optional.
 * The rows are src/lib/customer-statement.ts; this writes them in the reader's language, and for
 * Italian with a semicolon and a decimal comma, which is what Excel opens in Italy.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // ⚠️ The guards throw, and a route handler that lets them go answers 500.
  try {
    await requireCapability("record:export");
    await requirePlanModule("sales");
  } catch (err) {
    if (err instanceof UnauthenticatedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof ForbiddenError || err instanceof EntitlementError) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
  const { id } = await params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return new Response("Bad date", { status: 400 });

  const [db, timeZone, locale, t] = await Promise.all([
    getDb(),
    getWorkspaceTimeZone(),
    getLocale(),
    serverT("statement"),
  ]);
  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, id));
  if (!company) return new Response("Not found", { status: 404 });

  const statements = await customerStatement(db, { companyId: id, timeZone, from, to });
  const italian = locale === "it";
  const num = (n: number) => (n === 0 ? "" : italian ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  const rows: Record<string, string>[] = [];
  for (const s of statements) {
    rows.push({
      [t("date")]: from ?? "",
      [t("currency")]: s.currency,
      [t("kind")]: t("opening"),
      [t("document")]: "",
      [t("reference")]: "",
      [t("debit")]: "",
      [t("credit")]: "",
      [t("balance")]: italian ? s.opening.toFixed(2).replace(".", ",") : s.opening.toFixed(2),
    });
    for (const r of s.rows)
      rows.push({
        [t("date")]: r.date,
        [t("currency")]: s.currency,
        [t("kind")]: t(`kinds.${r.kind}`),
        [t("document")]: r.document ?? "",
        [t("reference")]: r.reference ?? "",
        [t("debit")]: num(r.debit),
        [t("credit")]: num(r.credit),
        [t("balance")]: italian ? r.balance.toFixed(2).replace(".", ",") : r.balance.toFixed(2),
      });
  }
  // The header row even when there is nothing to list: an empty file reads as a broken download.
  const fields = ["date", "currency", "kind", "document", "reference", "debit", "credit", "balance"].map((k) => t(k));
  // A cell starting with = + - @ is escaped: a description is written by the payer, and a
  // formula in it would run in the accountant's spreadsheet.
  const csv = unparse(
    { fields, data: rows.map((r) => fields.map((f) => r[f])) },
    { delimiter: italian ? ";" : ",", escapeFormulae: true },
  );
  const slug =
    company.name
      .normalize("NFD")
      .replace(/[^\w]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "cliente";
  // A byte-order mark, so Excel reads the accents as UTF-8.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${t("fileName")}-${slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

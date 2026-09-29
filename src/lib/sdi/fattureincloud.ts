import { invoiceTotals } from "@/lib/fatturapa/totals";

import {
  type OutgoingInvoice,
  type SdiContext,
  SdiHttpError,
  type SdiProvider,
  type SdiStatus,
  type SendOutcome,
  type StatusOutcome,
} from "./types";

/**
 * Fatture in Cloud (TeamSystem), API v2 (https://developers.fattureincloud.it).
 *
 * ⚠️⚠️ **It does not take a FatturaPA file.** Its API sends to SDI only documents created in
 * Fatture in Cloud, from JSON, and builds the XML itself ("Externally generated XML": not
 * possible). So the invoice Flux issued is created there — same number, date, customer, lines,
 * rates, installments — and then sent.
 *
 * ⚠️⚠️ **Its totals are its own.** Fatture in Cloud recomputes net, VAT and gross from the lines
 * and does not round as SDI's per-rate rule does (its maintainers: "a matter of rounding that we
 * cannot intervene on"). A file carrying another total than the invoice Flux issued must never
 * reach SDI, so after creating the document its three totals are compared with the frozen ones;
 * on any difference of a cent the document is deleted and nothing is sent — the invoice page says
 * which figures differ, and the invoice can go by another channel.
 *
 * ⚠️ The file SDI receives is Fatture in Cloud's; it is fetched after the send and kept
 * (`sentXml`), so the XML downloaded from Flux is the one that was transmitted.
 *
 * ⚠️ `ei_status` has no "delivered": a B2B invoice stays `sent`. SDI must notify a discard within
 * five days of transmission, so `sent` is read as delivered once `DISCARD_WINDOW_DAYS` have passed
 * with nothing else said — never earlier, because a status only moves forward and a discard after
 * "delivered" would be refused as going back.
 *
 * Signed in with a token the user makes in Fatture in Cloud (Settings → Connected applications),
 * which does not expire; `accountId` is the company.
 *
 * ⚠️ **No real Fatture in Cloud account has been through this.** Written against the official API
 * and its TypeScript SDK's models (2.1.3), tested with recorded answers.
 */

const BASE = "https://api-v2.fattureincloud.it";
export const DISCARD_WINDOW_DAYS = 6;

const STATUSES: Record<string, SdiStatus> = {
  attempt: "pending",
  not_sent: "pending",
  pending: "pending",
  processing: "pending",
  sent: "pending",
  missing: "error",
  error: "error",
  discarded: "rejected",
  not_delivered: "not_delivered",
  accepted: "accepted",
  manual_accepted: "accepted",
  rejected: "refused",
  manual_rejected: "refused",
  no_response: "expired",
};

export function ficStatus(value: unknown, sentAt: Date | null, now: Date): SdiStatus | null {
  if (typeof value !== "string") return null;
  const status = STATUSES[value] ?? null;
  // No discard within the window SDI has to discard in: delivered, for every practical purpose.
  if (value === "sent" && sentAt && now.getTime() - sentAt.getTime() > DISCARD_WINDOW_DAYS * 86_400_000) {
    return "delivered";
  }
  return status;
}

async function call<T>(ctx: SdiContext, path: string, init: RequestInit = {}): Promise<{ body: T; text: string }> {
  let res: Response;
  try {
    res = await ctx.fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers as Record<string, string>),
        Authorization: `Bearer ${ctx.password}`,
      },
    });
  } catch (err) {
    throw new SdiHttpError(`Fatture in Cloud unreachable: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new SdiHttpError(`Fatture in Cloud answered ${res.status}: ${ficError(text)}`, res.status);
  let body = {} as T;
  try {
    body = (text ? JSON.parse(text) : {}) as T;
  } catch {
    // Not JSON: the XML download answers with the file itself.
  }
  return { body, text };
}

/** Fatture in Cloud's own error words, which say what to fix. */
function ficError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; validation_result?: unknown } };
    const detail = parsed.error?.validation_result ? ` ${JSON.stringify(parsed.error.validation_result)}` : "";
    return `${parsed.error?.message ?? text.slice(0, 300)}${detail}`.slice(0, 600);
  } catch {
    return text.slice(0, 300);
  }
}

function failure(err: unknown): { reason: "auth" | "invalid" | "unavailable" | "rate_limited"; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof SdiHttpError) {
    if (err.status === 401 || err.status === 403) return { reason: "auth", message };
    if (err.status === 429) return { reason: "rate_limited", message };
    if (err.status === 400 || err.status === 409 || err.status === 422) return { reason: "invalid", message };
  }
  return { reason: "unavailable", message };
}

interface VatType {
  id?: number | null;
  value?: number | null;
  ei_type?: string | null;
  is_disabled?: boolean | null;
}

/** The workspace's VAT rate for a line: same percentage, and the same Natura (or none). */
export function vatIdFor(types: VatType[], rate: number, nature: string | null): number | null {
  const wanted = nature?.trim().toUpperCase() || null;
  const match = types.find(
    (t) =>
      !t.is_disabled &&
      Math.abs(Number(t.value ?? Number.NaN) - rate) < 0.001 &&
      (t.ei_type?.trim().toUpperCase() || null) === wanted,
  );
  return match?.id ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The document Fatture in Cloud is asked to create: Flux's invoice as its JSON. The lines are the
 * XML's detail lines — the document discount already shared out per rate, the stamp recharge a
 * line — so both files add up line by line.
 */
export function ficDocument(document: OutgoingInvoice["document"], vatTypes: VatType[]) {
  const totals = invoiceTotals(document.lines, document.discountPercent);
  const missing: string[] = [];
  const items = totals.details.map((d) => {
    const id = vatIdFor(vatTypes, d.rate, d.nature);
    if (id === null) missing.push(`${d.rate}%${d.nature ? ` ${d.nature}` : ""}`);
    return {
      name: d.description.slice(0, 1000),
      qty: d.quantity ?? 1,
      net_price: d.unitPrice,
      discount: d.discountPercent || 0,
      vat: { id },
    };
  });
  const customer = document.customer;
  const installments =
    document.installments && document.installments.length > 1
      ? document.installments.map((i) => ({ amount: round2(i.amount), due_date: i.dueDate, status: "not_paid" }))
      : [{ amount: totals.total, due_date: document.dueDate ?? document.issueDate, status: "not_paid" }];
  return {
    missing: [...new Set(missing)],
    totals,
    body: {
      data: {
        type: document.documentType === "TD04" ? "credit_note" : "invoice",
        number: document.number,
        numeration: document.series ? `/${document.series}` : "",
        date: document.issueDate,
        currency: { id: document.currency },
        entity: {
          name: customer.name ?? "",
          vat_number: customer.vatNumber ?? "",
          tax_code: customer.fiscalCode ?? "",
          address_street: customer.street ?? "",
          address_postal_code: customer.zipCode ?? "",
          address_city: customer.city ?? "",
          address_province: customer.province ?? "",
          country_iso: customer.country ?? "IT",
          certified_email: customer.pec ?? "",
          ei_code: customer.sdiCode ?? "",
        },
        items_list: items,
        payments_list: installments,
        stamp_duty: document.stampDuty ? 2 : 0,
        e_invoice: true,
        ei_data: {
          payment_method: document.paymentMethod,
          ...(document.issuer.iban ? { bank_iban: document.issuer.iban } : {}),
          ...(document.originalInvoice
            ? {
                invoice_number: document.originalInvoice.documentNumber,
                invoice_date: document.originalInvoice.issueDate,
              }
            : {}),
        },
        notes: document.notes ?? "",
      },
      // The installments are Flux's: Fatture in Cloud must not recompute them.
      options: { fix_payments: false },
    },
  };
}

interface Created {
  data?: { id?: number | null; amount_net?: number | null; amount_vat?: number | null; amount_gross?: number | null };
}

export const fattureInCloudProvider: SdiProvider = {
  id: "fattureincloud",
  label: "Fatture in Cloud",
  credentials: ["token", "accountId"],
  hasDemo: false,
  // It builds its own file, with its own transmitter.
  transmitter: null,

  async check(ctx) {
    try {
      const { body } = await call<{ data?: { companies?: { id?: number; name?: string }[] } }>(ctx, "/user/companies");
      const accounts = (body.data?.companies ?? []).map((c) => ({ id: String(c.id), name: c.name ?? "" }));
      if (ctx.accountId && !accounts.some((a) => a.id === ctx.accountId)) {
        return { ok: false, reason: "account", message: accounts.map((a) => `${a.id} ${a.name}`).join(", ") };
      }
      return { ok: true, accounts };
    } catch (err) {
      const f = failure(err);
      return { ok: false, reason: f.reason === "auth" ? "auth" : "unavailable", message: f.message };
    }
  },

  async send(ctx, invoice): Promise<SendOutcome> {
    const company = ctx.accountId;
    if (!company) return { ok: false, reason: "auth", message: "No Fatture in Cloud company chosen" };
    if (invoice.document.documentType === "TD02") {
      // A deposit invoice is TD02 in the XML; Fatture in Cloud's JSON has no field for it that
      // Flux has verified. Refused rather than sent as an ordinary invoice.
      return { ok: false, reason: "invalid", message: "TD02" };
    }
    const base = `/c/${encodeURIComponent(company)}/issued_documents`;
    let vatTypes: VatType[];
    try {
      vatTypes =
        (await call<{ data?: VatType[] }>(ctx, `/c/${encodeURIComponent(company)}/info/vat_types`)).body.data ?? [];
    } catch (err) {
      return { ok: false, ...failure(err) };
    }
    const doc = ficDocument(invoice.document, vatTypes);
    if (doc.missing.length > 0) return { ok: false, reason: "invalid", message: `vat:${doc.missing.join(", ")}` };

    let id: number;
    let created: Created;
    try {
      created = (await call<Created>(ctx, base, { method: "POST", body: JSON.stringify(doc.body) })).body;
      if (!created.data?.id)
        return { ok: false, reason: "unavailable", message: "Fatture in Cloud created no document" };
      id = created.data.id;
    } catch (err) {
      return { ok: false, ...failure(err) };
    }
    const remove = () => call(ctx, `${base}/${id}`, { method: "DELETE" }).catch(() => undefined);

    // ⚠️⚠️ Its totals against the frozen ones, to the cent: another total must never reach SDI.
    const theirs = {
      net: Number(created.data?.amount_net ?? Number.NaN),
      vat: Number(created.data?.amount_vat ?? Number.NaN),
      gross: Number(created.data?.amount_gross ?? Number.NaN),
    };
    const ours = { net: doc.totals.taxableAmount, vat: doc.totals.taxAmount, gross: doc.totals.total };
    const differs = (["net", "vat", "gross"] as const).filter((k) => !(Math.abs(theirs[k] - ours[k]) < 0.005));
    if (differs.length > 0) {
      await remove();
      return {
        ok: false,
        reason: "invalid",
        message: `totals:${differs.map((k) => `${k} ${theirs[k]} ≠ ${ours[k]}`).join("; ")}`,
      };
    }

    let fileName: string;
    try {
      const sent = await call<{ data?: { name?: string | null } }>(ctx, `${base}/${id}/e_invoice/send`, {
        method: "POST",
        body: JSON.stringify({ data: {}, options: { dry_run: false } }),
      });
      fileName = sent.body.data?.name ?? `fic-${id}.xml`;
    } catch (err) {
      // Not sent: nothing of it may stay in Fatture in Cloud holding the invoice's number.
      await remove();
      return { ok: false, ...failure(err) };
    }

    // The file SDI received, kept by Flux. A failure here loses nothing: it is also in Fatture in Cloud.
    let sentXml: string | null = null;
    try {
      const xml = await call<{ data?: string }>(ctx, `${base}/${id}/e_invoice/xml`, {
        headers: { Accept: "application/xml, application/json" },
      });
      sentXml = xml.text.trimStart().startsWith("<") ? xml.text : (xml.body.data ?? null);
    } catch {
      sentXml = null;
    }
    return { ok: true, fileName, ref: String(id), sentXml };
  },

  async status(ctx, sent): Promise<StatusOutcome> {
    if (!ctx.accountId || !sent.ref) return { ok: false, reason: "not_found", message: "No Fatture in Cloud document" };
    const base = `/c/${encodeURIComponent(ctx.accountId)}/issued_documents/${encodeURIComponent(sent.ref)}`;
    let raw: string | null | undefined;
    try {
      const doc = await call<{ data?: { ei_status?: string | null } }>(ctx, `${base}?fieldset=detailed`);
      raw = doc.body.data?.ei_status;
    } catch (err) {
      if (err instanceof SdiHttpError && err.status === 404)
        return { ok: false, reason: "not_found", message: err.message };
      const f = failure(err);
      return { ok: false, reason: f.reason === "invalid" ? "unavailable" : f.reason, message: f.message };
    }
    const status = ficStatus(raw, sent.sentAt, ctx.now?.() ?? new Date());
    if (!status) return { ok: false, reason: "unavailable", message: `Unknown Fatture in Cloud status: ${raw}` };
    let message: string | null = null;
    if (status === "rejected" || status === "error" || status === "refused") {
      try {
        const reason = await call<{
          data?: { reason?: string | null; code?: string | null; solution?: string | null };
        }>(ctx, `${base}/e_invoice/error_reason`);
        const d = reason.body.data;
        message = [d?.code, d?.reason, d?.solution].filter(Boolean).join(" — ") || null;
      } catch {
        message = null;
      }
    }
    return { ok: true, status, sdiId: null, message };
  },
};

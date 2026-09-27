import "server-only";

import { after } from "next/server";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { notify } from "@/lib/notify";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveTenantBySubdomain } from "@/lib/tenant-resolve";
import { turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";
import {
  readLeadSubmission,
  readTicketSubmission,
  submitLeadForm,
  submitTicketForm,
  type WebForm,
  type WebFormKind,
  webFormByToken,
} from "@/lib/web-forms";

/**
 * The public forms, for a visitor with no session (src/lib/web-forms.ts).
 *
 * ⚠️ Inside `runWithTenant`: notifications and the owner's rules read the workspace from
 * the request, and there is none here. The rules run after the response — a lead filed
 * from the site is a lead like any other, and "when a lead arrives, assign it" has to fire.
 */

/** Marks the note a web form writes: a symbol, since the note is read in either language. */
const NOTE_MARK = "🌐";

async function resolve(workspace: string, token: string) {
  const found = await resolveTenantBySubdomain(workspace);
  if (!found) return null;
  const form: WebForm | null = await webFormByToken(found.db, token).catch(() => null);
  if (!form?.enabled) return null;
  return { tenantId: found.tenant.id, workspaceName: found.tenant.name ?? workspace, db: found.db, form };
}

export interface WebFormPage {
  kind: WebFormKind;
  workspaceName: string;
  /** Turnstile's site key when the deployment has one. */
  siteKey: string | null;
}

export async function loadWebFormPage(workspace: string, token: string): Promise<WebFormPage | null> {
  const r = await resolve(workspace, token);
  return r ? { kind: r.form.kind as WebFormKind, workspaceName: r.workspaceName, siteKey: turnstileSiteKey() } : null;
}

export type WebFormResult =
  | { ok: true; kind: "lead" }
  | { ok: true; kind: "ticket"; ticketNumber: string }
  | { ok: false; reason: "notFound" | "invalid" | "captcha" };

export async function submitWebForm(
  workspace: string,
  token: string,
  body: Record<string, unknown>,
  ip: string | null,
): Promise<WebFormResult> {
  const r = await resolve(workspace, token);
  if (!r) return { ok: false, reason: "notFound" };
  const captcha = body["cf-turnstile-response"] ?? body.turnstileToken;
  if (!(await verifyTurnstile(typeof captcha === "string" ? captcha : null, ip))) {
    return { ok: false, reason: "captcha" };
  }

  return runWithTenant(r.tenantId, async (): Promise<WebFormResult> => {
    if (r.form.kind === "lead") {
      const s = readLeadSubmission(body);
      if (!s) return { ok: false, reason: "invalid" };
      const result = await submitLeadForm(r.db, r.form, s, NOTE_MARK);
      if (result.ownerId) {
        await notify({
          userId: result.ownerId,
          type: "lead_assigned",
          key: "webFormLead",
          params: { who: s.name },
          link: result.leadId
            ? `/dashboard/leads/${result.leadId}`
            : `/dashboard/contacts/${result.kind === "known" ? result.contactId : ""}`,
        }).catch((err) => console.error("[web-form] lead filed, owner not told:", err));
      }
      if (result.kind === "created") {
        after(() =>
          runWithTenant(r.tenantId, () =>
            runAutomations({
              entityType: "lead",
              entityId: result.leadId,
              event: "onCreate",
              oldData: {},
              newData: result.row,
            }),
          ).catch(() => undefined),
        );
      }
      return { ok: true, kind: "lead" };
    }

    const s = readTicketSubmission(body);
    if (!s) return { ok: false, reason: "invalid" };
    const ticket = await submitTicketForm(r.db, s);
    if (r.form.ownerId) {
      await notify({
        userId: r.form.ownerId,
        type: "ticket_created",
        key: "webFormTicket",
        params: { number: ticket.ticketNumber, subject: s.subject },
        link: `/dashboard/support/tickets/${ticket.ticketId}`,
      }).catch((err) => console.error("[web-form] ticket opened, owner not told:", err));
    }
    after(() =>
      runWithTenant(r.tenantId, () =>
        runAutomations({
          entityType: "ticket",
          entityId: ticket.ticketId,
          event: "onCreate",
          oldData: {},
          newData: ticket.row,
        }),
      ).catch(() => undefined),
    );
    return { ok: true, kind: "ticket", ticketNumber: ticket.ticketNumber };
  });
}

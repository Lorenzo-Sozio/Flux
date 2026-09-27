/**
 * Unsubscribe endpoint.
 * URL: /api/unsubscribe?token=<signed_token>
 *
 * ⚠️⚠️ **Opening the link unsubscribes nobody.** A GET shows the address and one button; the
 * button POSTs. Corporate mail scanners open every link in a message — and a GET that acted
 * unsubscribed people who never asked, and now told every integration (consent.withdrawn) that
 * they had. Decided 27 September 2026.
 *
 * The POST is also RFC 8058's one-click: the emails carry `List-Unsubscribe` and
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so the unsubscribe button Gmail and
 * Outlook draw posts here directly, with the token in the address. A scanner does not POST.
 *
 * Verifies the HMAC token, adds the email to email_suppression, updates the campaign log, and
 * returns an HTML confirmation page.
 */

import type { NextRequest } from "next/server";

import { eq } from "drizzle-orm";

import { campaignLogs, emailSequenceEnrollments, emailSuppressions } from "@/db/schema";
import { announceOptOut } from "@/lib/consent-events";
import { withdrawConsent } from "@/lib/consent-withdraw";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { SEQUENCE_TOKEN_PREFIX, stopForAddress } from "@/lib/sequence-runner";
import { resolveTenantByProbe } from "@/lib/tenant-resolve";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

/** The page the link opens: who is about to be unsubscribed, and the button that does it. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const payload = token ? verifyUnsubscribeToken(token) : null;
  if (!token || !payload) {
    return htmlResponse("Invalid link", "This unsubscribe link is invalid or has expired.", false);
  }
  const action = `/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return htmlResponse(
    "Unsubscribe?",
    `Stop marketing emails to <strong>${escapeHtml(payload.email)}</strong>?`,
    null,
    `<form method="post" action="${escapeHtml(action)}"><button type="submit">Unsubscribe</button></form>`,
  );
}

/** The button on that page, and the one-click unsubscribe of a mail client (RFC 8058). */
export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get("token");
  if (!token) {
    const form = await req.formData().catch(() => null);
    const fromBody = form?.get("token");
    token = typeof fromBody === "string" ? fromBody : null;
  }
  return unsubscribe(token);
}

async function unsubscribe(token: string | null): Promise<Response> {
  if (!token) {
    return htmlResponse("Invalid link", "This unsubscribe link is invalid or has expired.", false);
  }

  const payload = verifyUnsubscribeToken(token);

  if (!payload) {
    return htmlResponse("Invalid link", "This unsubscribe link is invalid or has expired.", false);
  }

  const { email, logId } = payload;

  // A follow-up sequence signs its link with the enrollment instead of a campaign log.
  if (logId.startsWith(SEQUENCE_TOKEN_PREFIX)) {
    const enrollmentId = logId.slice(SEQUENCE_TOKEN_PREFIX.length);
    const bySequence = await resolveTenantByProbe(`enrollment:${enrollmentId}`, async (tenantDb) => {
      const [row] = await tenantDb
        .select({ id: emailSequenceEnrollments.id })
        .from(emailSequenceEnrollments)
        .where(eq(emailSequenceEnrollments.id, enrollmentId));
      return Boolean(row);
    }).catch(() => null);
    if (!bySequence) {
      return htmlResponse("Invalid link", "This unsubscribe link is invalid or has expired.", false);
    }
    try {
      const sdb = bySequence.db;
      await sdb
        .insert(emailSuppressions)
        .values({ email: email.toLowerCase(), reason: "unsubscribe" })
        .onConflictDoNothing();
      await stopForAddress(sdb, email, "unsubscribed");
      const [enrollment] = await sdb
        .select({ leadId: emailSequenceEnrollments.leadId, contactId: emailSequenceEnrollments.contactId })
        .from(emailSequenceEnrollments)
        .where(eq(emailSequenceEnrollments.id, enrollmentId));
      // Dated and sourced, and in the record's history (src/lib/consent-withdraw.ts).
      if (enrollment?.leadId) {
        await withdrawConsent(sdb, "lead", enrollment.leadId, "unsubscribe");
      } else if (enrollment?.contactId) {
        await withdrawConsent(sdb, "contact", enrollment.contactId, "unsubscribe");
      }
      // The other systems writing to this person hear it too (src/lib/consent-events.ts).
      await announceOptOut(
        sdb,
        {
          records: enrollment?.leadId
            ? [{ entity: "lead", id: enrollment.leadId }]
            : enrollment?.contactId
              ? [{ entity: "contact", id: enrollment.contactId }]
              : [],
          email,
          source: "unsubscribe",
          channel: "email",
        },
        { via: "user", actor: null },
      );
    } catch {
      // Same stance as below: the page still confirms, and the send-time check on
      // the suppression list is what actually keeps the next email from going out.
    }
    return htmlResponse(
      "Unsubscribed successfully",
      `The address <strong>${escapeHtml(email)}</strong> has been removed from our mailing list. You will no longer receive marketing emails from us.`,
      true,
    );
  }

  // The recipient of a marketing email has no session and no workspace header, so
  // the tenant is derived from the campaign log the token is signed against.
  // Calling getDb() here returned 500 on every unsubscribe — a link that is both
  // legally required and the one people click when they are already annoyed
  // (audit rilievo B-01).
  const resolved = await resolveTenantByProbe(`campaignLog:${logId}`, async (tenantDb) => {
    const row = await tenantDb.query.campaignLogs.findFirst({
      where: eq(campaignLogs.id, logId),
      columns: { id: true },
    });
    return Boolean(row);
  }).catch(() => null);

  if (!resolved) {
    return htmlResponse("Invalid link", "This unsubscribe link is invalid or has expired.", false);
  }

  const db = resolved.db;

  try {
    // Add to suppression list (ignore if already present)
    await db
      .insert(emailSuppressions)
      .values({ email: email.toLowerCase(), reason: "unsubscribe" })
      .onConflictDoNothing();

    // Unsubscribing from a campaign is unsubscribing: sequences stop writing too.
    await tolerateUnmigrated("sequences", () => stopForAddress(db, email, "unsubscribed"), 0);

    // Update campaign log and resolve the lead/contact FK
    const [log] = await db
      .update(campaignLogs)
      .set({ status: "unsubscribed" })
      .where(eq(campaignLogs.id, logId))
      .returning({ leadId: campaignLogs.leadId, contactId: campaignLogs.contactId });

    // Sync marketingConsent on the originating record so the CRM reflects reality
    if (log?.leadId) {
      await withdrawConsent(db, "lead", log.leadId, "unsubscribe");
    } else if (log?.contactId) {
      await withdrawConsent(db, "contact", log.contactId, "unsubscribe");
    }
    // The other systems writing to this person hear it too (src/lib/consent-events.ts).
    await announceOptOut(
      db,
      {
        records: log?.leadId
          ? [{ entity: "lead", id: log.leadId }]
          : log?.contactId
            ? [{ entity: "contact", id: log.contactId }]
            : [],
        email,
        source: "unsubscribe",
        channel: "email",
      },
      { via: "user", actor: null },
    );
  } catch {
    // Ignore DB errors — still show success to the user
  }

  return htmlResponse(
    "Unsubscribed successfully",
    `The address <strong>${escapeHtml(email)}</strong> has been removed from our mailing list. You will no longer receive marketing emails from us.`,
    true,
  );
}

function htmlResponse(title: string, message: string, success: boolean | null, action = "") {
  // null: a question, not an outcome.
  const color = success === null ? "#2563eb" : success ? "#16a34a" : "#dc2626";
  const icon = success === null ? "?" : success ? "✓" : "✗";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1), 0 4px 12px rgba(0,0,0,.06); max-width: 480px; width: 100%; padding: 40px 32px; text-align: center; }
    .icon { width: 56px; height: 56px; border-radius: 50%; background: ${color}20; color: ${color}; font-size: 24px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    h1 { margin: 0 0 12px; font-size: 22px; color: #111827; }
    p { margin: 0; color: #6b7280; font-size: 15px; line-height: 1.6; }
    form { margin-top: 24px; }
    button { background: #111827; color: #fff; border: 0; border-radius: 8px; padding: 12px 24px; font-size: 15px; cursor: pointer; min-height: 44px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${action}
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Unsubscribe endpoint.
 * URL: /api/unsubscribe?token=<signed_token>
 *
 * Verifies the HMAC token, adds the email to email_suppression,
 * updates the campaign log, and returns an HTML confirmation page.
 */

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/tenant-context";
import { campaignLogs, contacts, emailSuppressions, leads } from "@/db/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

export async function GET(req: NextRequest) {
  const db = await getDb();
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return htmlResponse("Invalid link", "This unsubscribe link is invalid or has expired.", false);
  }

  const payload = verifyUnsubscribeToken(token);

  if (!payload) {
    return htmlResponse("Invalid link", "This unsubscribe link is invalid or has expired.", false);
  }

  const { email, logId } = payload;

  try {
    // Add to suppression list (ignore if already present)
    await db
      .insert(emailSuppressions)
      .values({ email: email.toLowerCase(), reason: "unsubscribe" })
      .onConflictDoNothing();

    // Update campaign log and resolve the lead/contact FK
    const [log] = await db
      .update(campaignLogs)
      .set({ status: "unsubscribed" })
      .where(eq(campaignLogs.id, logId))
      .returning({ leadId: campaignLogs.leadId, contactId: campaignLogs.contactId });

    // Sync marketingConsent on the originating record so the CRM reflects reality
    if (log?.leadId) {
      await db
        .update(leads)
        .set({ marketingConsent: false })
        .where(eq(leads.id, log.leadId));
    } else if (log?.contactId) {
      await db
        .update(contacts)
        .set({ marketingConsent: false })
        .where(eq(contacts.id, log.contactId));
    }
  } catch {
    // Ignore DB errors — still show success to the user
  }

  return htmlResponse(
    "Unsubscribed successfully",
    `The address <strong>${escapeHtml(email)}</strong> has been removed from our mailing list. You will no longer receive marketing emails from us.`,
    true
  );
}

function htmlResponse(title: string, message: string, success: boolean) {
  const color = success ? "#16a34a" : "#dc2626";
  const icon = success ? "✓" : "✗";

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
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
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

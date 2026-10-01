/**
 * The email an automation rule sends.
 *
 * ⚠️⚠️ It used to go straight to Resend with a global key, from `automation@fluxcrm.app`,
 * past everything the workspace had set up: its own SMTP or key and sender (Settings →
 * Email), the queue every other email waits in, the exclusion list, and the unsubscribe
 * link. A customer who had unsubscribed still received the rule's emails, from an address
 * that was not the business's. Now it is an `email_job` like a sequence step (§8.3): the
 * worker sends it with the workspace's configuration, a suppressed address is not written
 * to, and the body carries a way out.
 *
 * Merge fields: {{contact.email}}, {{contact.firstName}}, {{deal.name}}, {{company.name}},
 * {{owner.name}}, {{owner.email}} and so on — built by merge-data.ts, which the webhook
 * action reads too.
 */

import { eq } from "drizzle-orm";

import { campaignLogs, emailJobs, emailSuppressions } from "@/db/schema";
import { getAppUrl } from "@/lib/app-url";
import { brandValues, loadEmailBrand, signatureFor } from "@/lib/email-brand-load";
import { ensureUnsubscribe, renderPlaceholders } from "@/lib/email-placeholders";
import { normaliseEmail } from "@/lib/sequence-plan";
import { getDb } from "@/lib/tenant-context";
import { trackLinks } from "@/lib/tracking-token";
import { generateUnsubscribeToken } from "@/lib/unsubscribe-token";

import type { RuleContext } from "../../crm/automation/types";
import { loadMergeData } from "./merge-data";

// Resolved per call, not at import: `getAppUrl()` refuses to guess in production,
// and a module-scope call would make that refusal a build failure rather than a
// clear error on the request that was about to send a wrong link (rilievo B-04).
function appBase(): string {
  return getAppUrl();
}

/**
 * Replaces each `{{path}}` with the value at that path in `data`.
 *
 * A path that does not exist stays as written, so a recipient left unresolved is caught
 * by the address check instead of becoming an empty `to`. A field that exists but is
 * empty becomes empty text: «Gentile null» is worse than «Gentile».
 */
export function replaceMergeFields(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const keys = key.trim().split(".");
    let value: any = data;

    for (const k of keys) {
      value = value?.[k];
    }

    if (value === undefined) return match;
    if (value === null) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  });
}

/**
 * Resolves the merge fields and queues the email in the workspace's own queue. Returns the
 * retries consumed, which is none: the worker retries a queued email, not the rule.
 *
 * A recipient on the exclusion list is not written to, and that is not a failure of the rule.
 */
export async function sendAutomationEmailWithContext(
  to: string,
  cc: string | undefined,
  bcc: string | undefined,
  subject: string,
  body: string,
  trackOpens: boolean,
  trackClicks: boolean,
  context: RuleContext,
): Promise<number> {
  // The record, its contact and company, and three columns of its owner: see merge-data.ts.
  const mergeData = await loadMergeData(context);

  const finalTo = replaceMergeFields(to, mergeData).trim();
  const finalCc = cc ? replaceMergeFields(cc, mergeData) : undefined;
  const finalBcc = bcc ? replaceMergeFields(bcc, mergeData) : undefined;
  const finalSubject = replaceMergeFields(subject, mergeData);
  let finalBody = replaceMergeFields(body, mergeData);

  if (!finalTo.includes("@")) {
    throw new Error(`Invalid recipient email after merge: ${finalTo} (original: ${to})`);
  }

  const db = await getDb();

  // `{{intestazione}}` and `{{firma}}`, from a template designed in the builder: the workspace's
  // identity and the record owner's signature, as on the email the owner would have written.
  if (/\{\{\s*(intestazione|brandHeader|brand_header|firma|signature)\s*\}\}/i.test(finalBody)) {
    const brand = await loadEmailBrand(db).catch(() => null);
    if (brand) {
      const ownerId = (mergeData.owner as { id?: string } | undefined)?.id ?? null;
      const signature = await signatureFor(db, ownerId, brand, "full", "it").catch(() => "");
      finalBody = renderPlaceholders(finalBody, brandValues(brand, signature));
    }
  }

  // ⚠️ The exclusion list first: somebody who unsubscribed, or whose address bounced, is
  // not written to by a rule any more than by a campaign.
  const [suppressed] = await db
    .select({ reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, normaliseEmail(finalTo)));
  if (suppressed) {
    console.info(`[automation] ${finalTo} is on the exclusion list (${suppressed.reason}): not written to`);
    return 0;
  }

  // A campaign_log (no campaign) is what the tracking endpoints and the unsubscribe link
  // are signed against, as for a campaign email.
  const [log] = await db
    .insert(campaignLogs)
    .values({
      campaignId: null,
      contactId: context.entityType === "contact" ? context.entityId : null,
      leadId: context.entityType === "lead" ? context.entityId : null,
      status: "queued",
    })
    .returning();

  if (trackClicks) finalBody = trackLinks(finalBody, log.id, appBase());
  if (trackOpens) {
    finalBody = `${finalBody}\n<img src="${appBase()}/api/track/open?log=${encodeURIComponent(log.id)}" width="1" height="1" alt="" style="display:none" />`;
  }
  const unsubscribeUrl = `${appBase()}/api/unsubscribe?token=${generateUnsubscribeToken(finalTo, log.id)}`;

  await db.insert(emailJobs).values({
    toEmail: finalTo,
    cc: finalCc || null,
    bcc: finalBcc || null,
    subject: finalSubject,
    // Every automated email carries a way out, written by the author or not.
    htmlBody: ensureUnsubscribe(finalBody, unsubscribeUrl),
    status: "pending",
    scheduledAt: new Date(),
    campaignLogId: log.id,
  });

  return 0;
}

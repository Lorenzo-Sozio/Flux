// NOT "use server" — this is a plain server-side lib callable from both
// server actions (with auth) and API routes (cron, no session).

import { revalidatePath } from "next/cache";

import { and, eq, inArray, lte } from "drizzle-orm";

import {
  campaignLogs,
  contacts,
  emailJobs,
  emailSuppressions,
  emailTemplates,
  leads,
  marketingCampaigns,
} from "@/db/schema";
import { getAppUrl } from "@/lib/app-url";
import { resolveSegmentIds } from "@/lib/campaign-segment";
import { ensureUnsubscribe, renderPlaceholders, valuesForRecipient } from "@/lib/email-placeholders";
import { getDb } from "@/lib/tenant-context";
import { signTrackingUrl } from "@/lib/tracking-token";
import { generateUnsubscribeToken } from "@/lib/unsubscribe-token";

// Resolved per call, not at import: `getAppUrl()` refuses to guess in production,
// and a module-scope call would make that refusal a build failure rather than a
// clear error on the request that was about to send a wrong link (rilievo B-04).
function appBase(): string {
  return getAppUrl();
}

type Recipient = { id: string; email: string | null; firstName: string; lastName: string };

function wrapLinksForTracking(html: string, logId: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url: string) => {
    if (url.includes("/api/track/") || url.includes("/api/unsubscribe")) return match;
    const sig = signTrackingUrl(logId, url);
    const tracked =
      `${appBase()}/api/track/click` +
      `?log=${encodeURIComponent(logId)}` +
      `&url=${encodeURIComponent(url)}` +
      `&sig=${encodeURIComponent(sig)}`;
    return `href="${tracked}"`;
  });
}

export async function executeCampaignSend(data: {
  campaignId: string;
  recipientType: "contacts" | "leads";
  recipientIds?: string[];
  /** A saved filter to send to, instead of everyone eligible. */
  filterId?: string | null;
  /**
   * Whose authority the segment is resolved under: a user id when a person asked
   * for this, null when the scheduler is sending a filter that was already
   * checked and stored on the campaign.
   */
  actorId: string | null;
}): Promise<{ success: true; queued: number; skipped: number; total: number } | { error: string }> {
  const db = await getDb();
  const { campaignId, recipientType } = data;

  // A segment resolves to a list of ids. Null means none was chosen and everybody
  // eligible is the audience; an empty list means one was chosen and it matches
  // nobody, which must not quietly become everybody.
  const segmentIds = await resolveSegmentIds(recipientType, data.filterId, data.actorId);
  const recipientIds = segmentIds ?? data.recipientIds;
  // ⚠️ Returning here would skip the status write at the end and leave a
  // scheduled campaign saying "sending" for ever, which the scheduler never picks
  // up again. The empty segment travels as an empty audience instead, through the
  // same path, so the campaign finishes the way every other one does.
  const segmentIsEmpty = segmentIds !== null && segmentIds.length === 0;

  const [campaign] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));

  if (!campaign?.templateId) return { error: "Campaign or template not found." };

  const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, campaign.templateId));

  if (!template) return { error: "Email template not found." };

  const suppressions = await db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  const suppressedEmails = new Set(suppressions.map((s) => s.email.toLowerCase()));

  let recipients: Recipient[] = [];

  if (segmentIsEmpty) {
    // Chosen and matching nobody. Not the same as choosing nothing, and the
    // difference has to survive all the way to the query.
    recipients = [];
  } else if (recipientType === "contacts") {
    const filter = recipientIds?.length
      ? and(eq(contacts.marketingConsent, true), inArray(contacts.id, recipientIds))
      : eq(contacts.marketingConsent, true);
    recipients = await db
      .select({ id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(filter);
  } else {
    const filter = recipientIds?.length
      ? and(eq(leads.marketingConsent, true), eq(leads.isConverted, false), inArray(leads.id, recipientIds))
      : and(eq(leads.marketingConsent, true), eq(leads.isConverted, false));
    recipients = await db
      .select({ id: leads.id, email: leads.email, firstName: leads.firstName, lastName: leads.lastName })
      .from(leads)
      .where(filter);
  }

  let queued = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    if (!recipient.email) {
      skipped++;
      continue;
    }
    if (suppressedEmails.has(recipient.email.toLowerCase())) {
      skipped++;
      continue;
    }

    const [log] = await db
      .insert(campaignLogs)
      .values({
        campaignId,
        [recipientType === "contacts" ? "contactId" : "leadId"]: recipient.id,
        status: "queued",
        sentAt: new Date(),
      })
      .returning();

    const unsubToken = generateUnsubscribeToken(recipient.email, log.id);
    const unsubscribeUrl = `${appBase()}/api/unsubscribe?token=${unsubToken}`;
    const values = valuesForRecipient({ ...recipient, unsubscribeUrl });

    // The unsubscribe link is added when the author left it out. A marketing
    // email without one is not a rendering defect but an unlawful one, and the
    // send reported success either way (audit rilievo S-08).
    let html = ensureUnsubscribe(renderPlaceholders(template.body, values), unsubscribeUrl);

    // The subject was never substituted at all, so a line reading "A question for
    // {{nome}}" went out saying exactly that.
    const subject = renderPlaceholders(template.subject, values);

    html = wrapLinksForTracking(html, log.id);
    html = `${html}\n<img src="${appBase()}/api/track/open?log=${encodeURIComponent(log.id)}" width="1" height="1" alt="" style="display:none" />`;

    await db.insert(emailJobs).values({
      campaignId,
      campaignLogId: log.id,
      toEmail: recipient.email,
      subject,
      htmlBody: html,
      status: "pending",
      scheduledAt: new Date(),
    });

    queued++;
  }

  await db
    .update(marketingCampaigns)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(marketingCampaigns.id, campaignId));

  revalidatePath("/dashboard/marketing/campaigns");
  return { success: true, queued, skipped, total: recipients.length };
}

/** Queries due campaigns, marks them as "sending" to prevent re-dispatch, then sends each. */
export async function dispatchDueCampaigns(): Promise<Array<{ id: string; name: string; result: unknown }>> {
  const db = await getDb();
  const due = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.status, "scheduled"), lte(marketingCampaigns.scheduledAt, new Date())));

  if (due.length === 0) return [];

  // Mark all as "sending" before dispatch — prevents re-dispatch if one fails mid-loop.
  await db
    .update(marketingCampaigns)
    .set({ status: "sending", updatedAt: new Date() })
    .where(
      inArray(
        marketingCampaigns.id,
        due.map((c) => c.id),
      ),
    );

  const results: Array<{ id: string; name: string; result: unknown }> = [];
  for (const campaign of due) {
    const recipientType = (campaign.recipientType as "contacts" | "leads") ?? "contacts";
    const result = await executeCampaignSend({
      campaignId: campaign.id,
      recipientType,
      // The segment chosen when it was scheduled, not everybody eligible now.
      filterId: campaign.recipientFilterId,
      // No session here, and none needed: this id was checked against its owner
      // when the campaign was scheduled and has been on the row ever since.
      actorId: null,
    });
    results.push({ id: campaign.id, name: campaign.name, result });
  }
  return results;
}

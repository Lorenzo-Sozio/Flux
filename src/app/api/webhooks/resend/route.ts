/**
 * Resend webhook handler.
 * Configure in the Resend dashboard → Webhooks → Events: email.bounced, email.complained, email.delivered
 * Set the webhook URL to: https://your-domain.com/api/webhooks/resend
 * Add the signing secret to .env: RESEND_WEBHOOK_SECRET=whsec_xxxx
 *
 * Signature verification uses the Svix algorithm (SHA-256 HMAC).
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { campaignLogs, emailSuppressions } from "@/db/schema";

export async function POST(req: NextRequest) {
  const body = await req.text();

  // Verify Svix signature — mandatory; reject if secret is not configured
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook/resend] RESEND_WEBHOOK_SECRET is not set — rejecting request");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (!verifySvixSignature(body, req.headers, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type: string = event.type ?? "";
  const data = event.data ?? {};
  const messageId: string = data.email_id ?? data.id ?? "";

  try {
    switch (type) {
      case "email.delivered": {
        // Optionally mark as confirmed delivered (currently "sent" already covers this)
        break;
      }

      case "email.bounced": {
        const email: string = data.to?.[0] ?? data.to ?? "";
        if (email) {
          // Add to suppressions
          await db
            .insert(emailSuppressions)
            .values({ email: email.toLowerCase(), reason: "bounce_hard" })
            .onConflictDoNothing();

          // Update campaign log if we can correlate by messageId
          if (messageId) {
            await db
              .update(campaignLogs)
              .set({ status: "bounced" })
              .where(eq(campaignLogs.messageId, messageId));
          }
        }
        break;
      }

      case "email.complained": {
        // Spam complaint — add to suppressions immediately
        const email: string = data.to?.[0] ?? data.to ?? "";
        if (email) {
          await db
            .insert(emailSuppressions)
            .values({ email: email.toLowerCase(), reason: "complaint" })
            .onConflictDoNothing();

          if (messageId) {
            await db
              .update(campaignLogs)
              .set({ status: "complained" })
              .where(eq(campaignLogs.messageId, messageId));
          }
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge without processing
        break;
    }
  } catch (err) {
    console.error("[webhook/resend] DB error:", err);
    // Return 200 so Resend doesn't retry (DB errors are not delivery issues)
  }

  return NextResponse.json({ received: true });
}

// ─── Svix signature verification ─────────────────────────────────────────────

function verifySvixSignature(payload: string, headers: Headers, secret: string): boolean {
  try {
    const msgId = headers.get("svix-id") ?? "";
    const msgTimestamp = headers.get("svix-timestamp") ?? "";
    const msgSignature = headers.get("svix-signature") ?? "";

    if (!msgId || !msgTimestamp || !msgSignature) return false;

    // Reject if timestamp is older than 5 minutes
    const ts = parseInt(msgTimestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

    const signed = `${msgId}.${msgTimestamp}.${payload}`;

    // Secret format from Resend dashboard: "whsec_XXXXXXX" (base64 after the prefix)
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const computed = createHmac("sha256", secretBytes).update(signed).digest("base64");

    // Header may contain multiple space-separated signatures like "v1,BASE64 v1,BASE64"
    const provided = msgSignature.split(" ").map((s) => s.replace(/^v1,/, ""));

    return provided.some((sig) => {
      try {
        const a = Buffer.from(sig, "base64");
        const b = Buffer.from(computed, "base64");
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

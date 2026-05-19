/**
 * Resend Inbound email webhook adapter.
 *
 * Configure in the Resend dashboard:
 *   Receiving → your domain → Webhook URL: https://your-domain.com/api/webhooks/resend-inbound
 *   Copy the signing secret → add to .env: RESEND_INBOUND_WEBHOOK_SECRET=whsec_xxxx
 *
 * Flow:
 *   1. Resend posts an "email.received" event (Svix-signed, metadata only)
 *   2. We verify the signature, then fetch the raw email via the download URL
 *   3. mailparser extracts html, text and real attachments (skips inline images)
 *   4. Normalized payload is passed to processInboundEmail() → creates/updates ticket
 */

import { type NextRequest, NextResponse } from "next/server";

import { simpleParser } from "mailparser";
import { Resend } from "resend";

import type { InboundAttachment } from "@/lib/ticket-from-email";
import { processInboundEmail } from "@/lib/ticket-from-email";

import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Svix signature verification ─────────────────────────────────────────────

function verifySvixSignature(payload: string, headers: Headers, secret: string): boolean {
  try {
    const msgId = headers.get("svix-id") ?? "";
    const msgTimestamp = headers.get("svix-timestamp") ?? "";
    const msgSignature = headers.get("svix-signature") ?? "";

    if (!msgId || !msgTimestamp || !msgSignature) return false;

    const ts = parseInt(msgTimestamp, 10);
    if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

    const signed = `${msgId}.${msgTimestamp}.${payload}`;
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const computed = createHmac("sha256", secretBytes).update(signed).digest("base64");

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

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook/resend-inbound] RESEND_INBOUND_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const body = await req.text();

  if (!verifySvixSignature(body, req.headers, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ received: true, skipped: "not_email_received" });
  }

  const eventData = event.data ?? {};
  const emailId: string = eventData.email_id ?? "";

  if (!emailId) {
    return NextResponse.json({ error: "Missing email_id" }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error("[webhook/resend-inbound] RESEND_API_KEY is not set");
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  // Fetch email metadata + raw download URL
  const resend = new Resend(resendApiKey);
  const { data: emailMeta, error } = await resend.emails.receiving.get(emailId);

  if (error || !emailMeta) {
    console.error("[webhook/resend-inbound] Failed to fetch email metadata:", error);
    return NextResponse.json({ error: "Failed to fetch email metadata" }, { status: 502 });
  }

  const fromRaw: string = eventData.from ?? "";
  const subject: string = (eventData.subject ?? "").trim();

  if (!fromRaw || !subject) {
    return NextResponse.json({ error: "Missing from or subject" }, { status: 400 });
  }

  // Parse the raw email to extract html, text and real attachments
  let htmlBody = "";
  let textBody = "";
  let inboundMessageId: string | null = eventData.message_id ?? null;
  let inReplyTo: string | null = null;
  const attachments: InboundAttachment[] = [];

  const rawUrl: string | undefined = (emailMeta as any).raw?.download_url;
  if (rawUrl) {
    try {
      const rawResponse = await fetch(rawUrl);
      const rawText = await rawResponse.text();
      const parsed = await simpleParser(rawText, { skipImageLinks: true });

      htmlBody = typeof parsed.html === "string" ? parsed.html : "";
      textBody = parsed.text ?? "";

      // Threading headers
      inboundMessageId = inboundMessageId ?? parsed.messageId ?? null;
      inReplyTo = parsed.inReplyTo ?? null;

      // Collect real attachments, skip inline images (contentId set = embedded in HTML)
      for (const att of parsed.attachments) {
        if (att.contentDisposition === "inline" && att.contentId) continue;
        if (!att.content || att.content.length === 0) continue;

        attachments.push({
          filename: att.filename ?? "attachment",
          contentType: att.contentType ?? "application/octet-stream",
          content: att.content,
        });
      }
    } catch (parseErr) {
      console.error("[webhook/resend-inbound] Raw email parse error:", parseErr);
      // Fall back to metadata only — body will be empty but ticket still gets created
    }
  } else {
    // Raw email not available — use html/text from SDK response if present
    htmlBody = (emailMeta as any).html ?? "";
    textBody = (emailMeta as any).text ?? "";
  }

  const result = await processInboundEmail({
    fromRaw,
    subject,
    htmlBody,
    textBody,
    inboundMessageId,
    inReplyTo,
    attachments,
  });

  if (result.skipped) return NextResponse.json({ ok: true, skipped: result.skipped });
  if (!result.ok) return NextResponse.json({ error: "Processing failed" }, { status: 500 });

  return NextResponse.json(result);
}

/**
 * Generic inbound email webhook.
 * Accepts emails forwarded by Cloudmailin, Mailgun, SendGrid Inbound Parse,
 * or any other SMTP-to-webhook bridge.
 *
 * Security: protected by INBOUND_EMAIL_SECRET environment variable.
 * Configure your bridge to POST to: https://your-domain.com/api/webhooks/email-inbound
 * with the header  X-Webhook-Secret: <INBOUND_EMAIL_SECRET>
 *
 * Expected JSON body (normalized form):
 * {
 *   from:      "Name <email@example.com>",
 *   to:        "support@yourdomain.com",
 *   subject:   "Re: [TKT-202401-ABCDEF] Issue title",
 *   html:      "<p>Reply body...</p>",
 *   text:      "Reply body...",
 *   messageId: "<unique-id@mail.example.com>",   // optional
 *   inReplyTo: "<previous-id@mail.example.com>", // optional
 *   attachments: [                               // optional
 *     {
 *       filename:     "document.pdf",
 *       content_type: "application/pdf",
 *       content:      "BASE64_ENCODED_CONTENT",  // base64 string
 *       size:         12345                      // bytes (optional)
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from "next/server";

import type { InboundAttachment } from "@/lib/ticket-from-email";
import { processInboundEmail } from "@/lib/ticket-from-email";

function parseAttachments(raw: unknown): InboundAttachment[] {
  if (!Array.isArray(raw)) return [];

  const result: InboundAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    // Normalize field names across providers:
    // Cloudmailin uses content / content_type / file_name
    // Mailgun uses  content-type / name / data (base64)
    // SendGrid uses type / filename / content (base64)
    const filename: string =
      item.filename ?? item.file_name ?? item.name ?? "attachment";
    const contentType: string =
      item.content_type ?? item["content-type"] ?? item.type ?? "application/octet-stream";
    const base64: string =
      item.content ?? item.data ?? item.body ?? "";

    if (!base64) continue;

    try {
      const content = Buffer.from(base64, "base64");
      result.push({ filename, contentType, content });
    } catch {
      // Malformed base64 — skip
    }
  }
  return result;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret");
  if (!process.env.INBOUND_EMAIL_SECRET || secret !== process.env.INBOUND_EMAIL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fromRaw: string = body.from ?? "";
  const subject: string = (body.subject ?? "").trim();

  if (!fromRaw || !subject) {
    return NextResponse.json({ error: "Missing from or subject" }, { status: 400 });
  }

  const result = await processInboundEmail({
    fromRaw,
    subject,
    htmlBody: body.html ?? "",
    textBody: body.text ?? "",
    inboundMessageId: body.messageId ?? body.message_id ?? null,
    inReplyTo: body.inReplyTo ?? body.in_reply_to ?? null,
    attachments: parseAttachments(body.attachments),
  });

  if (result.skipped) return NextResponse.json({ ok: true, skipped: result.skipped });
  if (!result.ok) return NextResponse.json({ error: "Processing failed" }, { status: 500 });

  return NextResponse.json(result);
}

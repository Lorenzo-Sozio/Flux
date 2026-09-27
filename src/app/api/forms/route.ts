import { type NextRequest, NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { submitWebForm } from "@/lib/web-forms-public";

/**
 * A public form's submission — from its hosted page, or from the customer's own site
 * (src/lib/web-forms.ts). JSON, or an ordinary HTML form post.
 *
 * ⚠️ Open to any origin, on purpose: the point is a form on somebody else's website. That
 * is safe because nothing here reads a session or a cookie — the workspace and the form
 * come from the fields, and the proxy rate-limits the path by address.
 *
 * ⚠️ `website` is a field no person sees; a submission that fills it is a script, answered
 * as if it had worked and written nowhere.
 *
 * `redirect`, for an HTML form with no script: where to send the browser afterwards. Only
 * an http(s) address, and only on success — an open redirect on failure would be a free
 * phishing hop with our name on it.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
    const form = await req.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  } catch {
    return null;
  }
}

function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return json({ ok: false, reason: "invalid" }, 400);
  const redirect = safeRedirect(body.redirect);

  if (typeof body.website === "string" && body.website.trim()) {
    return redirect ? NextResponse.redirect(redirect, { status: 303, headers: CORS }) : json({ ok: true });
  }

  const workspace = typeof body.workspace === "string" ? body.workspace.trim().toLowerCase() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!workspace || !token) return json({ ok: false, reason: "invalid" }, 422);

  const ip = clientIp(req.headers);
  const result = await submitWebForm(workspace, token, body, ip);
  if (result.ok) {
    return redirect ? NextResponse.redirect(redirect, { status: 303, headers: CORS }) : json(result);
  }
  const status = result.reason === "notFound" ? 404 : result.reason === "captcha" ? 403 : 422;
  return json(result, status);
}

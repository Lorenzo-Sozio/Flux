import { type NextRequest, NextResponse } from "next/server";

import { updateAttendeeRsvp } from "@/actions/appointments";
import { getAppUrl } from "@/lib/app-url";

// Resolved per call, not at import: `getAppUrl()` refuses to guess in production,
// and a module-scope call would make that refusal a build failure rather than a
// clear error on the request that was about to send a wrong link (rilievo B-04).
function appBase(): string {
  return getAppUrl();
}

const RESPONSE_LABELS: Record<string, string> = {
  accept: "Partecipazione confermata",
  decline: "Partecipazione rifiutata",
  tentative: "Risposta: Forse",
};

const RESPONSE_COLORS: Record<string, string> = {
  accept: "#16a34a",
  decline: "#dc2626",
  tentative: "#d97706",
};

const RESPONSE_ICONS: Record<string, string> = {
  accept: "✓",
  decline: "✗",
  tentative: "?",
};

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const response = req.nextUrl.searchParams.get("r") ?? "";

  if (!token || !["accept", "decline", "tentative"].includes(response)) {
    return new NextResponse(errorPage("Link non valido o scaduto."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const result = await updateAttendeeRsvp(token, response as "accept" | "decline" | "tentative");

  if (!result.success) {
    return new NextResponse(errorPage(result.error ?? "Errore sconosciuto."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const label = RESPONSE_LABELS[response] ?? "Risposta registrata";
  const color = RESPONSE_COLORS[response] ?? "#2563eb";
  const icon = RESPONSE_ICONS[response] ?? "✓";

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${label}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f9fafb; display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 48px 40px; max-width: 420px;
      width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.08);
    }
    .icon {
      width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center;
      justify-content: center; margin: 0 auto 24px; font-size: 32px;
      background: ${color}20; color: ${color};
    }
    h1 { margin: 0 0 8px; font-size: 22px; color: #111; }
    p  { margin: 0 0 32px; color: #6b7280; font-size: 15px; }
    a  {
      display: inline-block; padding: 12px 28px; background: ${color}; color: #fff;
      border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;
    }
    a:hover { opacity: .9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${label}</h1>
    <p>La tua risposta è stata registrata correttamente.</p>
    <a href="${appBase()}/dashboard/calendar">Vai al calendario</a>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <title>Errore</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; background: #f9fafb; }
    .card { background: #fff; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; }
    h1 { color: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Errore</h1>
    <p>${escHtml(message)}</p>
  </div>
</body>
</html>`;
}

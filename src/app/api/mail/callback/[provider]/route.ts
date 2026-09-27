import { type NextRequest, NextResponse } from "next/server";

import { appUrl } from "@/lib/app-url";
import { getActor } from "@/lib/auth-guard";
import { disconnectMailbox, loadConnection, saveConnection } from "@/lib/mail-connection";
import { finishOAuth, OAUTH_COOKIE } from "@/lib/mail-oauth";
import { isProviderId, mayConnect, providerFor } from "@/lib/mail-providers/registry";
import { can } from "@/lib/permissions";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

/**
 * Where Google or Microsoft sends the person back after consent. Everything the trip was
 * tied to is checked before the code is redeemed (src/lib/mail-oauth.ts): the signature, the
 * cookie, the person signed in, the workspace open.
 *
 * ⚠️ Not under a public prefix on purpose: the proxy gives it the signed-in person's
 * workspace like any dashboard call, and a callback nobody is signed in to connects nothing.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const back = (outcome: string) => {
    const res = NextResponse.redirect(appUrl(`/dashboard/profile?mail=${outcome}`));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/mail/callback", maxAge: 0 });
    return res;
  };
  const actor = await getActor();
  if (!actor) return NextResponse.redirect(appUrl("/login"));
  const { provider } = await params;
  if (!isProviderId(provider)) return new NextResponse("Not found", { status: 404 });

  const q = req.nextUrl.searchParams;
  // The person said no at the consent screen: nothing to do, nothing to log.
  if (q.get("error")) return back("denied");

  const check = finishOAuth({ state: q.get("state"), cookie: req.cookies.get(OAUTH_COOKIE)?.value, provider });
  if (!check.ok) {
    console.warn(`[mail-callback] refused: ${check.reason}`);
    return back("error");
  }
  if (check.state.userId !== actor.userId || check.state.tenantId !== (await getCurrentTenantId())) {
    console.warn("[mail-callback] refused: another person or workspace than the one that started");
    return back("error");
  }
  const client = providerFor(provider);
  const code = q.get("code");
  if (!client || !code || !mayConnect(provider, actor) || !can(actor, "record:write")) return back("unavailable");

  try {
    const tokens = await client.exchangeCode({
      code,
      redirectUri: appUrl(`/api/mail/callback/${provider}`),
      codeVerifier: check.codeVerifier,
    });
    const [mailbox, cursor] = await Promise.all([
      client.mailbox(tokens.accessToken),
      client.startCursor(tokens.accessToken, new Date()),
    ]);
    const db = await getDb();
    // Another mailbox replacing one: the old grant is withdrawn, not left working at the
    // provider with nothing here to remember it.
    const previous = await loadConnection(db, actor.userId);
    if (previous && (previous.provider !== provider || previous.email !== mailbox.email)) {
      await disconnectMailbox(db, actor.userId, providerFor(previous.provider as typeof provider));
    }
    await saveConnection(db, { userId: actor.userId, provider, email: mailbox.email, tokens, cursor });
  } catch (err) {
    console.error("[mail-callback] connection failed", err instanceof Error ? err.message : err);
    return back("error");
  }
  return back("connected");
}

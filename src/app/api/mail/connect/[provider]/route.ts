import { type NextRequest, NextResponse } from "next/server";

import { appUrl } from "@/lib/app-url";
import { getActor } from "@/lib/auth-guard";
import { beginOAuth, OAUTH_COOKIE, OAUTH_TTL_SECONDS } from "@/lib/mail-oauth";
import { isProviderId, mayConnect, providerFor } from "@/lib/mail-providers/registry";
import { can } from "@/lib/permissions";
import { getCurrentTenantId } from "@/lib/tenant-context";

/**
 * Starts connecting the signed-in person's own mailbox (V3.2): off to the provider's consent
 * screen, with a signed state and a cookie that must both come back (src/lib/mail-oauth.ts).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const back = (outcome: string) => NextResponse.redirect(appUrl(`/dashboard/profile?mail=${outcome}`));
  const actor = await getActor();
  if (!actor) return NextResponse.redirect(appUrl("/login"));
  const { provider } = await params;
  if (!isProviderId(provider)) return new NextResponse("Not found", { status: 404 });
  // Dormant until it may run: an unverified provider is for Flux's own staff to try. And never
  // for a read-only member: what the sync files is written on the records in their name.
  if (!mayConnect(provider, actor) || !can(actor, "record:write")) return back("unavailable");
  const client = providerFor(provider);
  const tenantId = await getCurrentTenantId();
  if (!client || !tenantId) return back("unavailable");

  const trip = beginOAuth({ tenantId, userId: actor.userId, provider });
  const res = NextResponse.redirect(
    client.authorizeUrl({
      state: trip.state,
      redirectUri: appUrl(`/api/mail/callback/${provider}`),
      codeChallenge: trip.codeChallenge,
      loginHint: actor.email ?? undefined,
    }),
  );
  res.cookies.set(OAUTH_COOKIE, trip.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the provider's redirect back is a top-level GET, which Lax lets through.
    sameSite: "lax",
    path: "/api/mail/callback",
    maxAge: OAUTH_TTL_SECONDS,
  });
  return res;
}

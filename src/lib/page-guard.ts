/**
 * page-guard.ts — capability guards for Server Components.
 *
 * Server Actions throw (the client turns that into a message). Pages cannot
 * throw usefully during navigation, so they redirect — but to a page that
 * *explains*, carrying the reason in the query string. The old behaviour bounced
 * the user to the dashboard with no message at all, which read as the app
 * ignoring the click (audit rilievo P-01, D-08).
 */
import { redirect } from "next/navigation";

import { getActor } from "@/lib/auth-guard";
import { type Actor, type Capability, can } from "@/lib/permissions";

/**
 * The single sign-in route.
 *
 * There were two parallel auth interfaces (`/auth/v1/*` and `/auth/v2/*`) and
 * three ways in, with the code redirecting to `/login` in thirteen places and to
 * the full path in three. The v2 screens were unreachable from the product and
 * had drifted (audit rilievo M-07). `/login` still redirects here so nothing that
 * links to it breaks.
 */
export const LOGIN_PATH = "/auth/v1/login";

/**
 * Requires a capability to render the page. Redirects to the sign-in page when
 * unauthenticated, or to /unauthorized with the missing capability when the
 * actor is signed in but not allowed.
 *
 *   export default async function Page() {
 *     const actor = await requirePageCapability("settings:manage");
 *     …
 *   }
 */
export async function requirePageCapability(capability: Capability, returnTo?: string): Promise<Actor> {
  const actor = await getActor();

  if (!actor) {
    const target = returnTo ? `${LOGIN_PATH}?next=${encodeURIComponent(returnTo)}` : LOGIN_PATH;
    redirect(target);
  }

  if (!can(actor, capability)) {
    redirect(`/unauthorized?need=${encodeURIComponent(capability)}`);
  }

  return actor;
}

/** Requires only a signed-in session. */
export async function requirePageActor(returnTo?: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    const target = returnTo ? `${LOGIN_PATH}?next=${encodeURIComponent(returnTo)}` : LOGIN_PATH;
    redirect(target);
  }
  return actor;
}

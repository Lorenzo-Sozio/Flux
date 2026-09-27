import "server-only";

/**
 * Cloudflare Turnstile on the public forms (src/lib/web-forms.ts), when the deployment has
 * a key pair: `TURNSTILE_SITE_KEY` drawn into the page, `TURNSTILE_SECRET_KEY` checked here.
 *
 * ⚠️ Optional, and said so: without the keys the forms rely on the hidden field and the
 * proxy's rate limit. A check that cannot be made is not failed — a workspace without
 * Turnstile would otherwise have forms that refuse every person.
 *
 * ⚠️ The site key is handed to the page by the server, never inlined as `NEXT_PUBLIC_*`:
 * the Cloudflare build does not have the runtime variables, and an empty key compiled into
 * the bundle would break the widget on every page long after anybody was looking.
 */

export function turnstileSiteKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.TURNSTILE_SITE_KEY?.trim() || null;
}

export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Cloudflare unreachable: a person should not be refused for it; the rate limit holds.
    return true;
  }
}

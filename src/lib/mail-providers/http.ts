import { type FetchLike, ProviderError } from "./types";

/** One call to a provider: JSON back, or a ProviderError carrying the status. */
export async function callJson<T>(
  fetchImpl: FetchLike,
  label: string,
  url: string,
  init: RequestInit & { token?: string; json?: unknown; form?: Record<string, string> } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  }
  const res = await fetchImpl(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Never the request body in the message: it can hold a token or a customer's email.
    throw new ProviderError(`${label} answered ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A token response, the same few fields at both providers. */
export function tokenSet(
  raw: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string },
  now = Date.now(),
): {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
} {
  return {
    accessToken: raw.access_token,
    ...(raw.refresh_token ? { refreshToken: raw.refresh_token } : {}),
    // A minute early: a token that expires between the check and the call is a failed call.
    expiresAt: new Date(now + ((raw.expires_in ?? 3600) - 60) * 1000),
    scopes: (raw.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

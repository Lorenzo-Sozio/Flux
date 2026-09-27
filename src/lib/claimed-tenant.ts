/**
 * The internal name under which the proxy passes on the workspace a machine caller claims
 * with `X-Tenant-ID` (src/proxy.ts → src/lib/api-import-auth.ts). A module of its own: the
 * proxy imports it without pulling in the API's authentication.
 */
export const CLAIMED_TENANT_HEADER = "x-flux-claimed-tenant";

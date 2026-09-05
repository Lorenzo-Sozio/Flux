/**
 * The boundary that decides *whose database* a machine-to-machine write lands in.
 *
 * These are the first tests in this project, and they are here rather than somewhere else
 * for a reason: every other bug in this repository costs a wrong screen. A bug here costs
 * one customer's data written into another customer's database — and it would not look
 * like a failure, it would look like a successful `201`.
 *
 * The history they defend: authorisation used to be a single global `IMPORT_API_KEY`, with
 * the target tenant taken from the `X-Tenant-ID` header. The header was validated for
 * existence, never bound to the caller, so one key reached every tenant.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getTenantById = vi.fn();
const getTenantByApiKeyHash = vi.fn();
const auth = vi.fn();

vi.mock("@/lib/get-tenant", () => ({
  getTenantById: (...a: unknown[]) => getTenantById(...a),
  getTenantByApiKeyHash: (...a: unknown[]) => getTenantByApiKeyHash(...a),
}));
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

const { authenticateApiRequest } = await import("@/lib/api-import-auth");

const CHIAVE_PIATTAFORMA = "platform-key-for-tests";
const CHIAVE_TENANT = "flx_a_tenants_own_key";
const IMPRONTA = createHash("sha256").update(CHIAVE_TENANT).digest("hex");

const ACME = { id: "tenant-acme", name: "Acme", subdomain: "acme" };
const ALTRO = { id: "tenant-altro", name: "Altro", subdomain: "altro" };

function richiesta(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/crm/leads", { method: "POST", headers });
}

function conChiave(chiave: string, extra: Record<string, string> = {}): Request {
  return richiesta({ authorization: `Bearer ${chiave}`, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.IMPORT_API_KEY = CHIAVE_PIATTAFORMA;
  auth.mockResolvedValue(null);
  getTenantById.mockImplementation(async (id: string) => (id === ACME.id ? ACME : id === ALTRO.id ? ALTRO : null));
  getTenantByApiKeyHash.mockImplementation(async (hash: string) => (hash === IMPRONTA ? ACME : null));
});

describe("a tenant's own key carries its tenant", () => {
  it("resolves the tenant from the key, with no header at all", async () => {
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_TENANT));

    expect(outcome).not.toBeNull();
    expect(outcome?.via).toBe("apikey");
    expect(outcome?.tenantId).toBe(ACME.id);
    // The caller sends nothing about the tenant, so there is nothing to forge.
    expect(getTenantByApiKeyHash).toHaveBeenCalledWith(IMPRONTA);
  });

  it("looks the key up by its SHA-256, never by the key itself", async () => {
    await authenticateApiRequest(conChiave(CHIAVE_TENANT));

    const [[argomento]] = getTenantByApiKeyHash.mock.calls;
    expect(argomento).toBe(IMPRONTA);
    expect(argomento).not.toBe(CHIAVE_TENANT);
    expect(String(argomento)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("REFUSES a header naming another tenant instead of quietly ignoring it", async () => {
    // The failure this prevents is not a leak, it is a silence: ignoring the header would
    // let a misconfigured integration write happily into its own tenant while its operator
    // believes it is writing into another one. Nobody finds out until the wrong customer
    // gets a message.
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_TENANT, { "x-tenant-id": ALTRO.id }));

    expect(outcome).toBeNull();
  });

  it("accepts a header that agrees, so an explicit caller is not punished", async () => {
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_TENANT, { "x-tenant-id": ACME.id }));

    expect(outcome?.tenantId).toBe(ACME.id);
  });

  it("rejects a key nobody minted", async () => {
    expect(await authenticateApiRequest(conChiave("flx_never_minted"))).toBeNull();
  });
});

describe("the platform key stays the platform key", () => {
  it("still works, and still takes its tenant from the header", async () => {
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_PIATTAFORMA, { "x-tenant-id": ALTRO.id }));

    expect(outcome?.via).toBe("apikey");
    expect(outcome?.tenantId).toBe(ALTRO.id);
    // It is the one credential allowed to name a tenant — a deliberate choice, so that
    // integrations that already exist keep working. It must therefore never be handed to
    // a single customer's integration.
    expect(getTenantByApiKeyHash).not.toHaveBeenCalled();
  });

  it("refuses a tenant id that is not in the registry", async () => {
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_PIATTAFORMA, { "x-tenant-id": "forged" }));

    // Authentication succeeds — the key is genuine — but no tenant is resolved, and every
    // route treats a null tenantId as "tenant context required".
    expect(outcome?.tenantId).toBeNull();
  });

  it("is not a fallback: with IMPORT_API_KEY unset, nothing becomes the platform key", async () => {
    // An empty or missing platform key must not turn every request into an authorised one.
    process.env.IMPORT_API_KEY = "";

    expect(await authenticateApiRequest(conChiave(""))).toBeNull();
    expect(await authenticateApiRequest(conChiave("anything"))).toBeNull();
    // ...while a real tenant key keeps working, because it does not depend on it.
    expect((await authenticateApiRequest(conChiave(CHIAVE_TENANT)))?.tenantId).toBe(ACME.id);
  });
});

describe("what is not a bearer token", () => {
  it("falls back to the session, and a viewer gets nothing", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "viewer" } });

    expect(await authenticateApiRequest(richiesta({}))).toBeNull();
  });

  it("gives a session user the tenant the middleware injected", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "editor" } });

    const outcome = await authenticateApiRequest(richiesta({ "x-tenant-id": ACME.id }));

    expect(outcome).toEqual({ via: "session", userId: "u1", role: "editor", tenantId: ACME.id });
  });

  it("never reaches the session path when a bearer token is present but wrong", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "admin" } });

    expect(await authenticateApiRequest(conChiave("wrong"))).toBeNull();
    // A bad key must not be silently upgraded by whatever cookie happens to ride along.
    expect(auth).not.toHaveBeenCalled();
  });
});

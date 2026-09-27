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
// A scoped key is looked up in its workspace's database: which one was opened is recorded.
const opened: string[] = [];
vi.mock("@/db", () => ({
  createTenantDb: (id: string) => {
    opened.push(id);
    return { id };
  },
}));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: (u: string) => u }));
const findScopedKey = vi.fn();
vi.mock("@/lib/api-keys", async (original) => ({
  ...(await original<typeof import("@/lib/api-keys")>()),
  findScopedKey: (...a: unknown[]) => findScopedKey(...a),
}));

const { authenticateApiRequest, gateApiRequest } = await import("@/lib/api-import-auth");
const { CLAIMED_TENANT_HEADER } = await import("@/lib/claimed-tenant");
const { newScopedKey } = await import("@/lib/api-keys");
const { WRITE_ALL } = await import("@/lib/api-scopes");

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
  opened.length = 0;
  findScopedKey.mockResolvedValue(null);
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
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_TENANT, { [CLAIMED_TENANT_HEADER]: ALTRO.id }));

    expect(outcome).toBeNull();
  });

  it("accepts a header that agrees, so an explicit caller is not punished", async () => {
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_TENANT, { [CLAIMED_TENANT_HEADER]: ACME.id }));

    expect(outcome?.tenantId).toBe(ACME.id);
  });

  it("rejects a key nobody minted", async () => {
    expect(await authenticateApiRequest(conChiave("flx_never_minted"))).toBeNull();
  });
});

describe("the platform key stays the platform key", () => {
  it("still works, and still takes its tenant from the header", async () => {
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_PIATTAFORMA, { [CLAIMED_TENANT_HEADER]: ALTRO.id }));

    expect(outcome?.via).toBe("apikey");
    expect(outcome?.tenantId).toBe(ALTRO.id);
    // It is the one credential allowed to name a tenant — a deliberate choice, so that
    // integrations that already exist keep working. It must therefore never be handed to
    // a single customer's integration.
    expect(getTenantByApiKeyHash).not.toHaveBeenCalled();
  });

  it("refuses a tenant id that is not in the registry", async () => {
    const outcome = await authenticateApiRequest(conChiave(CHIAVE_PIATTAFORMA, { [CLAIMED_TENANT_HEADER]: "forged" }));

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
  it("⚠️⚠️ refuses a workspace member who is read-only", async () => {
    // The two scales. `role` is Flux's own staff field and reads "user" for every
    // customer who has ever signed in, so a check written against it was never
    // true for anybody outside Flux — and a viewer could create contacts, leads,
    // companies, notes and orders through this API, and trigger erasure and
    // opt-out with them. The earlier version of this very test hid that, by
    // putting the workspace role into the platform field.
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: "viewer" } });

    expect(await authenticateApiRequest(richiesta({ "x-tenant-id": ACME.id }))).toBeNull();
  });

  it("⚠️ refuses somebody who belongs to no workspace at all", async () => {
    // No membership is not the same as a low rank, and it must not read as one:
    // an unresolved role falls to viewer, which is refused.
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: null } });

    expect(await authenticateApiRequest(richiesta({ "x-tenant-id": ACME.id }))).toBeNull();
  });

  it("gives a session user the tenant the middleware injected", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: "editor" } });

    const outcome = await authenticateApiRequest(richiesta({ "x-tenant-id": ACME.id }));

    expect(outcome).toEqual({
      via: "session",
      userId: "u1",
      role: "editor",
      tenantId: ACME.id,
      scopes: null,
      key: null,
    });
  });

  it("accepts the legacy spelling of the editor role", async () => {
    // `tenant_members.role` still holds "user" on older rows, which the role
    // table reads as editor. A member whose row was never rewritten must not
    // silently lose access.
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: "user" } });

    expect((await authenticateApiRequest(richiesta({ "x-tenant-id": ACME.id })))?.role).toBe("editor");
  });

  it("lets Flux's own staff through, whatever their workspace rank", async () => {
    // Platform staff operate across every tenant from /admin; that is what the
    // platform scale is actually for.
    auth.mockResolvedValue({ user: { id: "u1", role: "admin", tenantRole: "viewer" } });

    expect((await authenticateApiRequest(richiesta({ "x-tenant-id": ACME.id })))?.via).toBe("session");
  });

  it("never reaches the session path when a bearer token is present but wrong", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: "admin" } });

    expect(await authenticateApiRequest(conChiave("wrong"))).toBeNull();
    // A bad key must not be silently upgraded by whatever cookie happens to ride along.
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("⚠️⚠️ a scoped key carries its workspace, and is checked in that workspace", () => {
  const scoped = newScopedKey(ACME.id).key;

  it("is looked up in the database of the workspace it names, and gives its own scopes", async () => {
    findScopedKey.mockResolvedValue({ id: "k1", name: "Assistente", scopes: ["contacts:read"] });
    const outcome = await authenticateApiRequest(conChiave(scoped), "read");
    expect(outcome).toMatchObject({ via: "apikey", tenantId: ACME.id, scopes: ["contacts:read"] });
    // Named, so the events it causes can say which integration wrote.
    expect(outcome?.key).toEqual({ id: "k1", name: "Assistente" });
    expect(opened).toEqual([ACME.id]);
    expect(findScopedKey).toHaveBeenCalledWith({ id: ACME.id }, scoped);
    // Not the old single key: that one lives on the registry.
    expect(getTenantByApiKeyHash).not.toHaveBeenCalled();
  });

  it("is refused when that workspace does not hold it — unknown, revoked, or a secret moved onto another id", async () => {
    expect(await authenticateApiRequest(conChiave(scoped))).toBeNull();
    const moved = scoped.replace(ACME.id, ALTRO.id);
    findScopedKey.mockImplementation(async (db: { id: string }) =>
      db.id === ACME.id ? { id: "k1", scopes: WRITE_ALL } : null,
    );
    expect(await authenticateApiRequest(conChiave(moved))).toBeNull();
  });

  it("REFUSES a header naming another workspace, like the old key", async () => {
    findScopedKey.mockResolvedValue({ id: "k1", scopes: WRITE_ALL });
    expect(await authenticateApiRequest(conChiave(scoped, { [CLAIMED_TENANT_HEADER]: ALTRO.id }))).toBeNull();
  });

  it("names a workspace that does not exist: nothing is opened", async () => {
    expect(await authenticateApiRequest(conChiave(newScopedKey("nowhere").key))).toBeNull();
    expect(opened).toEqual([]);
  });
});

describe("⚠️⚠️ the gate: who, then what", () => {
  const scoped = newScopedKey(ACME.id).key;
  const CONTACTS_READ = { entity: "contacts", access: "read" } as const;
  const CONTACTS_WRITE = { entity: "contacts", access: "write" } as const;

  it("answers 403 naming the scope a key lacks, and lets through the one it holds", async () => {
    findScopedKey.mockResolvedValue({ id: "k1", scopes: ["contacts:read"] });
    const denied = await gateApiRequest(conChiave(scoped), CONTACTS_WRITE);
    expect(denied.response?.status).toBe(403);
    expect(await denied.response?.json()).toMatchObject({ scope: "contacts:write" });
    expect((await gateApiRequest(conChiave(scoped), CONTACTS_READ)).auth?.tenantId).toBe(ACME.id);
  });

  it("⚠️ the old keys name themselves too, and apart: the platform key is not a workspace's", async () => {
    const legacy = await gateApiRequest(conChiave(CHIAVE_TENANT), CONTACTS_WRITE);
    const platform = await gateApiRequest(
      conChiave(CHIAVE_PIATTAFORMA, { [CLAIMED_TENANT_HEADER]: ACME.id }),
      CONTACTS_WRITE,
    );
    expect(legacy.auth?.key?.id).toBe("legacy");
    expect(platform.auth?.key?.id).toBe("platform");
  });

  it("⚠️⚠️ a key made before scopes still writes everything and reads nothing", async () => {
    expect((await gateApiRequest(conChiave(CHIAVE_TENANT), CONTACTS_WRITE)).auth?.tenantId).toBe(ACME.id);
    expect((await gateApiRequest(conChiave(CHIAVE_TENANT), CONTACTS_READ)).response?.status).toBe(403);
    // And so does the platform key.
    const platform = conChiave(CHIAVE_PIATTAFORMA, { [CLAIMED_TENANT_HEADER]: ACME.id });
    expect((await gateApiRequest(platform, CONTACTS_READ)).response?.status).toBe(403);
  });

  it("⚠️⚠️ a read-only member reads through the API and still cannot write", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: "viewer" } });
    const req = () => richiesta({ "x-tenant-id": ACME.id });
    expect((await gateApiRequest(req(), CONTACTS_READ)).auth?.via).toBe("session");
    expect((await gateApiRequest(req(), CONTACTS_WRITE)).response?.status).toBe(401);
  });

  it("nobody at all is a 401, not a 403", async () => {
    expect((await gateApiRequest(richiesta({}), CONTACTS_READ)).response?.status).toBe(401);
  });
});

describe("⚠️⚠️ a signed-in person, on a route the dashboard keeps for administrators", () => {
  const WEBHOOKS_WRITE = { entity: "webhooks", access: "write" } as const;
  const CONTACTS_WRITE = { entity: "contacts", access: "write" } as const;
  const PRIVACY_WRITE = { entity: "privacy", access: "write" } as const;
  const req = () => richiesta({ "x-tenant-id": ACME.id });

  it("an editor may not subscribe to every event, nor erase a person, through the API", async () => {
    // record:write alone let them do both — admin-only on the screens.
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: "editor" } });
    expect((await gateApiRequest(req(), WEBHOOKS_WRITE)).response?.status).toBe(403);
    expect((await gateApiRequest(req(), PRIVACY_WRITE)).response?.status).toBe(403);
    // What the dashboard lets an editor do, the API does too.
    expect((await gateApiRequest(req(), CONTACTS_WRITE)).auth?.via).toBe("session");
  });

  it("an administrator may", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "user", tenantRole: "admin" } });
    expect((await gateApiRequest(req(), WEBHOOKS_WRITE)).auth?.via).toBe("session");
    expect((await gateApiRequest(req(), PRIVACY_WRITE)).auth?.via).toBe("session");
  });

  it("⚠️ a key is judged by its scopes, not by this table", async () => {
    // The platform key holds WRITE_ALL, which has no webhooks scope: refused for that.
    const platform = conChiave(CHIAVE_PIATTAFORMA, { [CLAIMED_TENANT_HEADER]: ACME.id });
    expect((await gateApiRequest(platform, WEBHOOKS_WRITE)).response?.status).toBe(403);
    expect(
      (await gateApiRequest(conChiave(CHIAVE_PIATTAFORMA, { [CLAIMED_TENANT_HEADER]: ACME.id }), PRIVACY_WRITE)).auth
        ?.tenantId,
    ).toBe(ACME.id);
  });
});

/**
 * Erasing a person, and the trace the erasure itself must not leave.
 *
 * The erasure's own logic is pinned in `src/lib/erasure.test.ts`. What is pinned here is
 * the route's account of itself: it now writes a line saying an integration called it, and
 * that line lands in a table the erasure does not visit.
 *
 * ⚠️⚠️ **So it must not carry the person.** A `recordId` here would leave, in the one table
 * nothing sweeps, a way back to somebody who asked to disappear — and it would look
 * exactly like every other line on the page, so nobody would ever look at it twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const scritture: Record<string, unknown>[] = [];
const cancellati: string[] = [];
let contati = 0;

vi.mock("@/lib/api-import-auth", () => ({
  authenticateApiRequest: async () => ({ via: "apikey", userId: null, role: "editor", tenantId: "t1" }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/db", () => ({ createTenantDb: () => ({ marcatore: "db-del-tenant" }) }));
vi.mock("@/lib/erasure", () => ({
  // ⚠️ Both declare what they return: a double answering everything would turn green a
  // route that erased nothing at all.
  countByContactPoint: async () => {
    contati++;
    return { leads: 1, contacts: 0 };
  },
  eraseByContactPoint: async (_db: unknown, recapito: string) => {
    cancellati.push(recapito);
    return { deleted: { lead: 1 }, anonymised: {}, kept: {} };
  },
}));
vi.mock("@/lib/api-write-log", () => ({
  logApiWrite: async (_db: unknown, auth: Record<string, unknown>, riga: Record<string, unknown>) => {
    scritture.push({ ...riga, via: auth.via });
  },
}));

const { POST } = await import("@/app/api/crm/erasure/route");

function richiesta(body: unknown) {
  return new Request("https://x.test/api/crm/erasure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

beforeEach(() => {
  scritture.length = 0;
  cancellati.length = 0;
  contati = 0;
});

describe("la cancellazione di una persona", () => {
  it("registra che è stata chiesta da un'integrazione", async () => {
    const risposta = await POST(richiesta({ contactPoint: "anna@example.it" }));

    expect(risposta.status).toBe(200);
    expect(cancellati).toEqual(["anna@example.it"]);
    expect(scritture).toHaveLength(1);
    expect(scritture[0]).toMatchObject({ entity: "erasure", endpoint: "/api/crm/erasure", via: "apikey" });
  });

  it("⚠️⚠️ non lascia da nessuna parte l'identificativo di chi ha chiesto di sparire", async () => {
    await POST(richiesta({ contactPoint: "anna@example.it" }));

    // The criterion of the whole feature is «from here, nobody can get back to them». A
    // recapito or a row id in this line would break it in the one table the erasure does
    // not sweep.
    expect(scritture[0].recordId).toBeNull();
    expect(JSON.stringify(scritture[0])).not.toContain("anna@example.it");
  });

  it("⚠️ un'anteprima non scrive niente e quindi non registra niente", async () => {
    const risposta = await POST(richiesta({ contactPoint: "anna@example.it", preview: true }));

    expect(risposta.status).toBe(200);
    expect(contati).toBe(1);
    expect(cancellati).toEqual([]);
    // Counting a preview among the things done would report erasures that never happened.
    expect(scritture).toEqual([]);
  });
});

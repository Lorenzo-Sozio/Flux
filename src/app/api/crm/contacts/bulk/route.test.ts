/**
 * Importing many contacts in one request.
 *
 * ⚠️ The route used to look a duplicate up and then write, once per record,
 * sequentially. At the documented maximum of five hundred records that is a
 * thousand round trips inside one request, against a Cloudflare subrequest
 * budget of a thousand — so the documented maximum was exactly the size that
 * could not complete. It is three passes now: validate with no database, look
 * every email up in one statement, write in chunks.
 *
 * ⚠️⚠️ **The property that rewrite could silently have lost** is the second test
 * below. Looking each email up immediately before writing meant the second
 * record carrying an email already found the first one — it was in the table by
 * then. Looking them all up once, before writing any, loses that unless a row
 * that is only *going* to exist is claimed as though it already did. Without the
 * claim, `onDuplicate: "skip"` quietly stops meaning what it says and an import
 * of a list containing the same address twice creates two contacts.
 *
 * These count statements as well as reading results, because the whole point of
 * the change is how many there are.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every row written, in order, with the table it went to. */
const inserted: { table: string; rows: Record<string, unknown>[] }[] = [];
const updated: { id: unknown; values: Record<string, unknown> }[] = [];
/** Every `select().from().where()` the route performed. */
let selectCount = 0;
/** What the workspace already contains, as email → id. */
let existing: { id: string; email: string | null }[] = [];

vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/actions/webhooks", () => ({
  dispatchWebhook: async () => undefined,
  // No webhook configured, so the route must not dispatch at all. The count of
  // statements below would otherwise include one lookup per row again.
  hasActiveWebhook: async () => false,
}));
vi.mock("@/lib/api-import-auth", () => ({
  authenticateApiRequest: async () => ({ via: "apikey", userId: null, role: "editor", tenantId: "t1" }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://fake" }));
vi.mock("@/db", () => ({
  createTenantDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => {
          selectCount++;
          return existing;
        },
      }),
    }),
    insert: (table: { [k: string]: unknown }) => ({
      values: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const name = String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "?");
        inserted.push({ table: name, rows: Array.isArray(rows) ? rows : [rows] });
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (clause: unknown) => {
          updated.push({ id: clause, values });
        },
      }),
    }),
  }),
}));

const { POST } = await import("@/app/api/crm/contacts/bulk/route");

function request(body: unknown) {
  return new Request("https://x.test/api/crm/contacts/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

const person = (n: number, email?: string | null) => ({
  firstName: `First${n}`,
  lastName: `Last${n}`,
  ...(email === undefined ? {} : { email }),
});

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  selectCount = 0;
  existing = [];
});

describe("a bulk contact import", () => {
  it("reports every record, in the order it was sent", async () => {
    const res = await POST(request({ records: [person(1, "a@x.it"), person(2, "b@x.it"), person(3)] }));
    const body = await res.json();

    expect(body.summary).toMatchObject({ total: 3, created: 3, updated: 0, skipped: 0, errors: 0 });
    expect(body.results.map((r: { index: number }) => r.index)).toEqual([0, 1, 2]);
    expect(body.results.every((r: { id?: string }) => typeof r.id === "string")).toBe(true);
  });

  it("⚠️⚠️ does not create the same address twice when it appears twice in one batch", async () => {
    // The claim. Without it both rows look new, because neither was in the table
    // when the single lookup ran, and the import silently doubles the contact.
    const res = await POST(request({ records: [person(1, "same@x.it"), person(2, "same@x.it")] }));
    const body = await res.json();

    expect(body.summary).toMatchObject({ created: 1, skipped: 1 });
    expect(body.results[1]).toMatchObject({ status: "skipped", reason: "duplicate_email" });
    // And the skipped row points at the one that was actually written.
    expect(body.results[1].existingId).toBe(body.results[0].id);
    expect(inserted.flatMap((i) => i.rows)).toHaveLength(1);
  });

  it("⚠️ an in-batch duplicate can update the row this same request is creating", async () => {
    const res = await POST(
      request({ records: [person(1, "same@x.it"), person(2, "same@x.it")], onDuplicate: "update" }),
    );
    const body = await res.json();

    expect(body.summary).toMatchObject({ created: 1, updated: 1 });
    expect(inserted.flatMap((i) => i.rows)).toHaveLength(1);
    expect(updated).toHaveLength(1);
    // ⚠️ The update targets a row that did not exist when the batch started, so
    // the inserts have to run first. If they did not, this update would silently
    // match nothing.
    expect(updated[0].values.firstName).toBe("First2");
  });

  it("⚠️ asks the database once for the whole batch, not once per record", async () => {
    // This is the change. Twenty records used to be twenty lookups and twenty
    // writes; the ceiling that made a full batch impossible was reached at
    // exactly the documented maximum.
    const records = Array.from({ length: 20 }, (_, i) => person(i, `p${i}@x.it`));

    await POST(request({ records }));

    expect(selectCount).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].rows).toHaveLength(20);
  });

  it("splits a large insert rather than sending one enormous statement", async () => {
    // Postgres binds one parameter per column per row against a hard ceiling, and
    // a contact is a wide row. The chunk size is what keeps a full batch clear of
    // a limit whose error message names none of this.
    const records = Array.from({ length: 450 }, (_, i) => person(i, `p${i}@x.it`));

    await POST(request({ records }));

    expect(inserted.length).toBeGreaterThan(1);
    expect(Math.max(...inserted.map((i) => i.rows.length))).toBeLessThanOrEqual(200);
    expect(inserted.flatMap((i) => i.rows)).toHaveLength(450);
  });

  it("skips what the workspace already holds, and says which row it matched", async () => {
    existing = [{ id: "existing-1", email: "known@x.it" }];

    const body = await (await POST(request({ records: [person(1, "known@x.it"), person(2, "new@x.it")] }))).json();

    expect(body.summary).toMatchObject({ created: 1, skipped: 1 });
    expect(body.results[0]).toMatchObject({ status: "skipped", existingId: "existing-1" });
    expect(inserted.flatMap((i) => i.rows)).toHaveLength(1);
  });

  it("⚠️ a rejected record costs no write and keeps its place", async () => {
    // The index is how a caller maps a failure back to the row in their own file.
    const body = await (
      await POST(request({ records: [person(1, "ok@x.it"), { firstName: "NoSurname" }, person(3, "not-an-email")] }))
    ).json();

    expect(body.summary).toMatchObject({ total: 3, created: 1, errors: 2 });
    expect(body.results[1]).toMatchObject({ index: 1, status: "error" });
    expect(body.results[2]).toMatchObject({ index: 2, status: "error" });
    expect(inserted.flatMap((i) => i.rows)).toHaveLength(1);
  });

  it("looks nothing up when no record carries an address", async () => {
    await POST(request({ records: [person(1), person(2)] }));

    expect(selectCount).toBe(0);
    expect(inserted.flatMap((i) => i.rows)).toHaveLength(2);
  });
});

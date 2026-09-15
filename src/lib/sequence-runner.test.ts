/**
 * Enrolling, stopping and sending follow-up sequences.
 *
 * ⚠️ Every failure here is an email in a customer's inbox that should not be
 * there: after they replied, after they unsubscribed, twice. The fake database
 * evaluates the WHERE conditions and enforces the one-active-enrollment index, so
 * the claims are tested for what they do rather than for being called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cond =
  | { op: "eq"; col: string; val: unknown }
  | { op: "lte"; col: string; val: unknown }
  | { op: "inArray"; col: string; vals: unknown[] }
  | { op: "and"; parts: Cond[] };

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
  lte: (col: string, val: unknown) => ({ op: "lte", col, val }),
  inArray: (col: string, vals: unknown[]) => ({ op: "inArray", col, vals }),
  and: (...parts: Cond[]) => ({ op: "and", parts }),
  asc: (col: string) => ({ asc: col }),
}));

const COLUMNS: Record<string, string[]> = {
  leads: ["id", "email", "isConverted"],
  contacts: ["id", "email", "companyId"],
  companies: ["id", "name"],
  emailJobs: ["id", "status", "sequenceEnrollmentId"],
  emailSequences: ["id", "isActive"],
  emailSequenceSteps: ["id", "sequenceId", "position"],
  emailSequenceEnrollments: ["id", "sequenceId", "email", "status", "nextStep", "nextSendAt", "ownerId"],
  emailSuppressions: ["email", "reason"],
};
vi.mock("@/db/schema", () =>
  Object.fromEntries(
    Object.entries(COLUMNS).map(([t, cols]) => [
      t,
      Object.fromEntries([["__t", t], ...cols.map((c) => [c, `${t}.${c}`])]),
    ]),
  ),
);

type Row = Record<string, unknown>;
const db0: Record<string, Row[]> = {};
let idSeq = 0;
let beforeClaim: (() => void) | null = null;
let failInsertJob = false;

function field(col: string) {
  return col.split(".")[1];
}
function matches(row: Row, c: Cond): boolean {
  switch (c.op) {
    case "eq":
      return row[field(c.col)] === c.val;
    case "lte":
      return row[field(c.col)] != null && (row[field(c.col)] as Date) <= (c.val as Date);
    case "inArray":
      return c.vals.includes(row[field(c.col)]);
    case "and":
      return c.parts.every((p) => matches(row, p));
  }
}
const copy = (rows: Row[]) => rows.map((r) => ({ ...r }));

const db = {
  select: () => ({
    from: (t: { __t: string }) => {
      const all = () => db0[t.__t] ?? [];
      const chain = (rows: () => Row[]) => ({
        orderBy: (o: { asc: string }) =>
          chain(() => [...rows()].sort((a, b) => ((a[field(o.asc)] as number) > (b[field(o.asc)] as number) ? 1 : -1))),
        limit: (n: number) => chain(() => rows().slice(0, n)),
        // biome-ignore lint/suspicious/noThenProperty: mimics drizzle's thenable builder
        then: (resolve: (v: Row[]) => unknown) => resolve(copy(rows())),
      });
      return { where: (c: Cond) => chain(() => all().filter((r) => matches(r, c))) };
    },
  }),
  insert: (t: { __t: string }) => ({
    values: (v: Row) => {
      const run = (ignoreConflict: boolean) => {
        if (t.__t === "emailJobs" && failInsertJob) throw new Error("queue unavailable");
        const table = db0[t.__t];
        if (
          t.__t === "emailSequenceEnrollments" &&
          table.some((r) => r.sequenceId === v.sequenceId && r.email === v.email && r.status === "active")
        ) {
          if (ignoreConflict) return [];
          throw new Error("unique violation");
        }
        const row = { id: `id${++idSeq}`, ...v };
        table.push(row);
        return [{ id: row.id }];
      };
      return {
        onConflictDoNothing: () => ({ returning: async () => run(true) }),
        // biome-ignore lint/suspicious/noThenProperty: mimics drizzle's thenable builder
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          try {
            return resolve(run(false));
          } catch (e) {
            return reject(e);
          }
        },
      };
    },
  }),
  update: (t: { __t: string }) => ({
    set: (set: Row) => ({
      where: (c: Cond) => {
        const run = () => {
          if (t.__t === "emailSequenceEnrollments" && "nextStep" in set && set.status !== undefined) {
            beforeClaim?.();
            beforeClaim = null;
          }
          const hit = (db0[t.__t] ?? []).filter((r) => matches(r, c));
          for (const r of hit) Object.assign(r, set);
          return copy(hit);
        };
        return {
          returning: async () => run(),
          // biome-ignore lint/suspicious/noThenProperty: mimics drizzle's thenable builder
          then: (resolve: (v: unknown) => unknown) => resolve(run()),
        };
      },
    }),
  }),
};

const notified: { userId: string; type: string; title: string }[] = [];
vi.mock("@/lib/notify", () => ({
  notify: async (n: { userId: string; type: string; title: string }) => {
    notified.push(n);
  },
}));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://crm.example" }));
vi.mock("@/lib/unsubscribe-token", () => ({
  generateUnsubscribeToken: (email: string, id: string) => `tok(${email},${id})`,
}));

const { advanceSequences, enroll, stopForAddress, stopOnReply } = await import("./sequence-runner");

const T0 = new Date("2026-09-15T09:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function seed() {
  for (const t of Object.keys(COLUMNS)) db0[t] = [];
  idSeq = 0;
  db0.emailSequences.push({ id: "s1", name: "Benvenuto", entityType: "lead", isActive: true, ownerId: "zeno" });
  db0.emailSequenceSteps.push(
    { id: "st1", sequenceId: "s1", position: 0, delayDays: 0, subject: "Ciao {{firstName}}", body: "<p>Primo</p>" },
    { id: "st2", sequenceId: "s1", position: 1, delayDays: 3, subject: "Novità?", body: "<p>Secondo</p>" },
  );
  db0.leads.push({
    id: "l1",
    firstName: "Anna",
    lastName: "Rossi",
    email: "Anna@Example.com",
    companyName: "Acme",
    ownerId: "bruno",
    isConverted: false,
  });
}

const enrollAnna = () => enroll(db, { sequenceId: "s1", entity: "lead", recordId: "l1", enrolledBy: "u1", now: T0 });
const jobs = () => db0.emailJobs;
const enrollment = () => db0.emailSequenceEnrollments[0];

beforeEach(() => {
  seed();
  notified.length = 0;
  beforeClaim = null;
  failInsertJob = false;
});

describe("enrolling", () => {
  it("enrolls under the lower-cased address, due at the first step's delay", async () => {
    expect(await enrollAnna()).toEqual({ ok: true, enrollmentId: "id1" });
    expect(enrollment()).toMatchObject({ email: "anna@example.com", nextStep: 0, nextSendAt: T0, ownerId: "bruno" });
  });

  it("⚠️⚠️ refuses to enroll the same address twice while active", async () => {
    await enrollAnna();
    expect(await enrollAnna()).toEqual({ ok: false, reason: "already_enrolled" });
    expect(db0.emailSequenceEnrollments).toHaveLength(1);
  });

  it("⚠️⚠️ refuses an address that has unsubscribed", async () => {
    db0.emailSuppressions.push({ email: "anna@example.com", reason: "unsubscribe" });
    expect(await enrollAnna()).toEqual({ ok: false, reason: "unsubscribed" });
  });

  it("refuses a paused sequence, one for another record type, and a lead with no address", async () => {
    db0.emailSequences[0].isActive = false;
    expect((await enrollAnna()).ok).toBe(false);
    db0.emailSequences[0].isActive = true;
    expect(
      (await enroll(db, { sequenceId: "s1", entity: "contact", recordId: "l1", enrolledBy: null, now: T0 })).ok,
    ).toBe(false);
    db0.leads[0].email = null;
    expect(await enrollAnna()).toEqual({ ok: false, reason: "missing_email" });
  });
});

describe("sending", () => {
  it("⚠️⚠️ queues the due step personalised, with a way out, and schedules the next", async () => {
    await enrollAnna();
    const r = await advanceSequences(db, T0);
    expect(r).toMatchObject({ queued: 1 });
    expect(jobs()[0]).toMatchObject({
      toEmail: "anna@example.com",
      subject: "Ciao Anna",
      status: "pending",
      sequenceEnrollmentId: "id1",
    });
    expect(jobs()[0].htmlBody).toContain("/api/unsubscribe?token=tok(anna@example.com,seq:id1)");
    expect(enrollment()).toMatchObject({ nextStep: 1, nextSendAt: day(3), status: "active" });
  });

  it("⚠️⚠️ sends nothing before the next step is due", async () => {
    await enrollAnna();
    await advanceSequences(db, T0);
    await advanceSequences(db, day(2));
    expect(jobs()).toHaveLength(1);
    await advanceSequences(db, day(3));
    expect(jobs()).toHaveLength(2);
  });

  it("⚠️⚠️ completes after the last step and sends nothing more", async () => {
    await enrollAnna();
    await advanceSequences(db, T0);
    await advanceSequences(db, day(3));
    await advanceSequences(db, day(30));
    expect(jobs()).toHaveLength(2);
    expect(enrollment()).toMatchObject({ status: "completed", nextSendAt: null });
  });

  it("⚠️⚠️ queues a step once when two runs take it at the same moment", async () => {
    await enrollAnna();
    // The other run claims the step between this run's read and its write.
    beforeClaim = () => {
      enrollment().nextStep = 1;
    };
    expect((await advanceSequences(db, T0)).queued).toBe(0);
    expect(jobs()).toHaveLength(0);
  });

  it("⚠️⚠️ gives the step back when the email cannot be queued, so the next run sends it", async () => {
    await enrollAnna();
    failInsertJob = true;
    await expect(advanceSequences(db, T0)).rejects.toThrow();
    expect(enrollment()).toMatchObject({ nextStep: 0, status: "active" });
    failInsertJob = false;
    await advanceSequences(db, T0);
    expect(jobs()).toHaveLength(1);
  });

  it("⚠️ waits, without losing its place, while the sequence is paused", async () => {
    await enrollAnna();
    db0.emailSequences[0].isActive = false;
    await advanceSequences(db, T0);
    expect(jobs()).toHaveLength(0);
    expect(enrollment()).toMatchObject({ status: "active", nextStep: 0 });
    db0.emailSequences[0].isActive = true;
    await advanceSequences(db, day(1));
    expect(jobs()).toHaveLength(1);
  });
});

describe("stopping", () => {
  it("⚠️⚠️ stops at the next send for an address unsubscribed since enrolling", async () => {
    await enrollAnna();
    await advanceSequences(db, T0);
    db0.emailSuppressions.push({ email: "anna@example.com", reason: "unsubscribe" });
    await advanceSequences(db, day(3));
    expect(jobs()).toHaveLength(1);
    expect(enrollment()).toMatchObject({ status: "stopped", stopReason: "unsubscribed" });
  });

  it("⚠️⚠️ stops when the lead is converted", async () => {
    await enrollAnna();
    db0.leads[0].isConverted = true;
    await advanceSequences(db, T0);
    expect(jobs()).toHaveLength(0);
    expect(enrollment().stopReason).toBe("converted");
  });

  it("⚠️⚠️ stops on a reply, cancels the step already queued, and tells the owner", async () => {
    await enrollAnna();
    await advanceSequences(db, T0);
    expect(await stopOnReply(db, "ANNA@example.com")).toBe(1);
    expect(enrollment()).toMatchObject({ status: "stopped", stopReason: "replied", nextSendAt: null });
    expect(jobs()[0].status).toBe("cancelled");
    expect(notified).toEqual([expect.objectContaining({ userId: "bruno", type: "sequence_reply" })]);
    await advanceSequences(db, day(3));
    expect(jobs()).toHaveLength(1);
  });

  it("⚠️ does not cancel an email that has already gone", async () => {
    await enrollAnna();
    await advanceSequences(db, T0);
    jobs()[0].status = "sent";
    await stopOnReply(db, "anna@example.com");
    expect(jobs()[0].status).toBe("sent");
  });

  it("a reply from someone in no sequence stops nothing and tells nobody", async () => {
    await enrollAnna();
    expect(await stopOnReply(db, "someone@else.example")).toBe(0);
    expect(notified).toHaveLength(0);
    expect(enrollment().status).toBe("active");
  });

  it("stops every sequence writing to an address that unsubscribes", async () => {
    await enrollAnna();
    expect(await stopForAddress(db, "anna@example.com", "unsubscribed")).toBe(1);
    expect(enrollment().stopReason).toBe("unsubscribed");
  });

  it("⚠️ lets the address be enrolled again once its earlier enrollment has stopped", async () => {
    await enrollAnna();
    await stopOnReply(db, "anna@example.com");
    expect((await enrollAnna()).ok).toBe(true);
  });
});

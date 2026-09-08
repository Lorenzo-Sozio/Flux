/**
 * Who wrote a row, and the three ways of getting that wrong.
 *
 * The insert itself is not interesting. What is interesting is what the log refuses to
 * say: a person's name where there is no person, a write where nothing was written, and a
 * failed report that takes the customer's data down with it.
 */
import { describe, expect, it, vi } from "vitest";

import { logApiWrite } from "./api-write-log";

type Riga = Record<string, unknown>;

/**
 * A database that records what was handed to it.
 *
 * ⚠️ It declares what it returns rather than inheriting a fallback: a double that answers
 * everything makes green tests that exercise nothing.
 */
function doppio(rompe = false) {
  const righe: Riga[] = [];
  const db = {
    insert: () => ({
      values: async (v: Riga) => {
        if (rompe) throw new Error("no connection");
        righe.push(v);
      },
    }),
  };
  // The helper wants the real tenant-db type; the double answers the one call it makes.
  return { db: db as never, righe };
}

describe("chi ha scritto", () => {
  it("una persona lascia il proprio nome", async () => {
    const { db, righe } = doppio();

    await logApiWrite(db, { via: "session", userId: "u-7" }, { entity: "lead", endpoint: "/api/crm/leads" });

    expect(righe).toEqual([
      { entity: "lead", endpoint: "/api/crm/leads", recordId: null, rows: 1, via: "session", actor: "u-7" },
    ]);
  });

  it("⚠️ un'integrazione non ne lascia uno inventato", async () => {
    const { db, righe } = doppio();

    // A key identifies a workspace, not a caller. `null` says «no person did this», which
    // is true; a placeholder name would read on screen as somebody who does not exist.
    await logApiWrite(db, { via: "apikey", userId: null }, { entity: "order", endpoint: "/api/crm/orders" });

    expect(righe[0].via).toBe("apikey");
    expect(righe[0].actor).toBeNull();
  });

  it("⚠️ una chiave che porta un utente non lo registra lo stesso", async () => {
    const { db, righe } = doppio();

    // Defends the branch, not the caller: the day `authenticateApiRequest` fills `userId`
    // for a key, an integration's writes must not start appearing under a person's name.
    await logApiWrite(db, { via: "apikey", userId: "u-7" }, { entity: "order", endpoint: "/api/crm/orders" });

    expect(righe[0].actor).toBeNull();
  });

  it("un lotto è una riga sola, con la sua misura", async () => {
    const { db, righe } = doppio();

    await logApiWrite(
      db,
      { via: "apikey", userId: null },
      { entity: "lead", endpoint: "/api/crm/leads/bulk", rows: 500 },
    );

    expect(righe).toHaveLength(1);
    expect(righe[0].rows).toBe(500);
    // Nothing to name among five hundred.
    expect(righe[0].recordId).toBeNull();
  });

  it("⚠️⚠️ un lotto interamente rifiutato non è una cosa fatta", async () => {
    const { db, righe } = doppio();

    // Counting it would flatter exactly the thing being measured, and a report that
    // overstates what an automation achieved is the error nobody in the company catches.
    await logApiWrite(
      db,
      { via: "apikey", userId: null },
      { entity: "lead", endpoint: "/api/crm/leads/bulk", rows: 0 },
    );

    expect(righe).toHaveLength(0);
  });

  it("⚠️⚠️ un registro che non si scrive non fa cadere la scrittura del cliente", async () => {
    const { db } = doppio(true);
    const errore = vi.spyOn(console, "error").mockImplementation(() => {
      // The failure is the point of the test; printing it would only make the run noisy.
    });

    // The caller has already written the customer's data. Throwing here would turn a
    // successful import into a 500 in exchange for a report line.
    await expect(
      logApiWrite(db, { via: "session", userId: "u-7" }, { entity: "note", endpoint: "/api/crm/notes" }),
    ).resolves.toBeUndefined();

    expect(errore).toHaveBeenCalled();
    errore.mockRestore();
  });
});

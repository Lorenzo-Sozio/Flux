/**
 * Every `/api/crm` route writes down who called it — checked by reading the routes.
 *
 * ## Why the check is an inventory and not a unit test
 *
 * The report on what an integration has been doing is only as complete as the routes that
 * feed it, and there are twenty-two of them. A guarantee that each route has to *remember*
 * is a guarantee the twenty-third will not have: the day somebody adds
 * `/api/crm/quotes`, nothing fails, no test goes red, and the report quietly stops being
 * the whole picture. Nobody notices a number that is merely too low.
 *
 * ⚠️ **A missing line is invisible by construction**, which is exactly why it needs a test
 * that looks at the sources rather than at behaviour.
 *
 * ## And it checks the route's own name too
 *
 * `ENDPOINT` is what the log and the idempotency ledger both record. A literal that no
 * longer matches the folder it sits in sends whoever reads the report to the wrong route,
 * and nothing else would ever catch it: the string is never compared with anything at run
 * time.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RADICE = "src/app/api/crm";

const leggi = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

/** Comments name `logApiWrite` more often than code calls it. */
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function rotte(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) rotte(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

/** `src/app/api/crm/leads/[leadId]/activities/route.ts` → `/api/crm/leads/{leadId}/activities`. */
function nomeAtteso(file: string): string {
  const rel = file.split("\\").join("/").slice("src/app".length, -"/route.ts".length);
  return rel.replace(/\[(\w+)\]/g, "{$1}");
}

describe("ogni rotta CRM registra chi ha scritto", () => {
  const files = rotte(RADICE);

  it("le rotte esistono, e sono quelle che ci si aspetta", () => {
    // ⚠️ A guard on the guard: a broken path would make every check below pass over an
    // empty list, and an inventory of nothing is green for ever.
    expect(files.length).toBeGreaterThanOrEqual(22);
  });

  it.each(files)("%s chiama logApiWrite", (file) => {
    const src = senzaCommenti(leggi(file));
    expect(src).toContain('from "@/lib/api-write-log"');
    expect(src).toContain("logApiWrite(");
  });

  it.each(files)("%s dichiara il proprio nome una volta sola", (file) => {
    const src = leggi(file);
    const m = src.match(/^const ENDPOINT = "([^"]+)";$/m);
    expect(m, `ENDPOINT non dichiarato in ${file}`).not.toBeNull();
    expect(m?.[1]).toBe(nomeAtteso(file));
    // The literal must not survive anywhere else: two strings that have to agree are one
    // string too many, and the ledger and the log would drift apart silently.
    expect(src.split(`"${nomeAtteso(file)}"`).length - 1).toBe(1);
  });

  it.each(files)("%s registra dopo la scrittura, non prima", (file) => {
    const src = senzaCommenti(leggi(file));
    // Every call is awaited: an unawaited promise inside a route that returns immediately
    // is a line that sometimes lands and sometimes does not, and a report that loses rows
    // at random is worse than none.
    for (const m of src.matchAll(/(\w*\s*)logApiWrite\(/g)) {
      expect(m[1].trim(), `logApiWrite senza await in ${file}`).toBe("await");
    }
  });
});

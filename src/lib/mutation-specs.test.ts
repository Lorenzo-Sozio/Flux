/**
 * Every mutation in `scripts/mutations/` still finds the line it breaks — exactly once.
 *
 * ⚠️⚠️ A spec whose `find` no longer matches is not a failing mutation: the runner cannot
 * apply it, so it proves nothing, and nothing said so until somebody ran the whole suite.
 * Fifteen had rotted that way — code rewritten, formatted or moved, the spec left pointing
 * at text that was gone — including the guard that stops an editor switching features for
 * the whole workspace, whose `find` matched seven lines at once.
 *
 * This is the cheap half of `npm run test:mutations`: it edits nothing, runs in the normal
 * suite, and turns the moment a line changes into the moment its spec is updated.
 *
 * ⚠️⚠️ It stands aside while a mutation run is in progress (FLUX_MUTATION_RUN=1). A mutated
 * file no longer contains the `find` that mutated it, so this test went red for *every*
 * mutation and the runner reported all of them caught, whatever the real tests did. The
 * runner checks each `find` itself, so nothing is lost by skipping here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DIR = "scripts/mutations";

interface Mutation {
  file: string;
  description: string;
  find: string;
}

const specs = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => {
    const parsed = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    const list: Mutation[] = Array.isArray(parsed) ? parsed : (parsed.mutations ?? []);
    return list.map((m) => ({ spec: f, ...m }));
  });

describe("⚠️⚠️ the mutation runner", () => {
  it("tells the check below to stand aside, or every mutation would read as caught", () => {
    const runner = readFileSync("scripts/verify-mutations.mjs", "utf8");
    expect(runner).toContain('env: { ...process.env, FLUX_MUTATION_RUN: "1" }');
  });
});

describe.skipIf(process.env.FLUX_MUTATION_RUN === "1")("⚠️⚠️ mutation specs", () => {
  it("exist", () => {
    expect(specs.length).toBeGreaterThan(100);
  });

  it("each find the line they break exactly once", () => {
    const sources = new Map<string, string>();
    const broken = specs
      .map((m) => {
        if (!sources.has(m.file)) {
          let text = "";
          try {
            text = readFileSync(m.file, "utf8").split("\r\n").join("\n");
          } catch {
            text = "";
          }
          sources.set(m.file, text);
        }
        const matches = (sources.get(m.file) ?? "").split(m.find).length - 1;
        return matches === 1 ? null : `${m.spec}: ${matches} matches — ${m.description}`;
      })
      .filter(Boolean);
    expect(broken).toEqual([]);
  });
});

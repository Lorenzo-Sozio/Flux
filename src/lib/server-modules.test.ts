/**
 * A `"use server"` module may export nothing but async functions.
 *
 * ⚠️ This is a **build error, not a lint warning**, and the message names the line
 * without naming the rule:
 *
 *     Only async functions are allowed to be exported in a "use server" file.
 *
 * Neither `npm run check` nor `npx tsc --noEmit` nor `npm test` sees it. It
 * surfaces at `next build`, which in this project means the deploy — and a deploy
 * that fails on a rule nobody remembered costs a round trip through the pipeline
 * to learn one line.
 *
 * It has happened twice. A window constant beside the task query, and a source
 * marker beside the assistant's report; the second one reached main and broke the
 * production build there. Both times the fix was the same: the constant belongs in
 * `src/lib`, where the screen that names it and the query that applies it can both
 * read it and neither can disagree about the value.
 *
 * The reason for the rule is worth knowing rather than working around: every
 * export of a `"use server"` module becomes an endpoint the browser can call. A
 * constant cannot be one, so the compiler refuses rather than inventing a
 * meaning.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

/** Every file under src/ whose first statement is the directive. */
function serverModules(dir = "src", found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      serverModules(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const src = read(full);
    if (/^\s*("use server"|'use server');/.test(src)) found.push(full);
  }
  return found;
}

/**
 * Exports the compiler will refuse.
 *
 * Types are erased before any of this matters, so `export type` and
 * `export interface` are fine, as is `export type { … }`.
 */
function forbiddenExports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^export\s+(?!type\b|interface\b|async\s+function\b)(\w+)([^\n]*)/gm)) {
    const keyword = m[1];
    if (keyword === "default") continue;
    // `export { type A, type B }` is types only; anything else in braces is a value.
    if (keyword === "{") continue;
    out.push(`export ${keyword}${m[2].slice(0, 40)}`);
  }
  return out;
}

describe('a "use server" module', () => {
  const modules = serverModules();

  it("is a set somebody has thought about", () => {
    // If the directive were spelled differently, or the walk broke, every check
    // below would pass by examining nothing.
    expect(modules.length).toBeGreaterThan(10);
  });

  it("⚠️⚠️ exports only async functions", () => {
    // The two that got through were `export const DONE_WINDOW_DAYS = 30` and
    // `export const SORGENTE_ASSISTENTE = "assistant"`. Both read perfectly, both
    // failed the production build, and the second reached main.
    const offenders: string[] = [];
    for (const file of modules) {
      for (const bad of forbiddenExports(read(file))) offenders.push(`${file}: ${bad}`);
    }
    expect(offenders).toEqual([]);
  });

  it("⚠️ never exports a plain value under any name", () => {
    // Belt to the braces above: `const`, `let`, `var` and `class` are the four
    // ways to write the thing that breaks, and naming them is what makes the
    // failure legible when somebody adds a fifth.
    const offenders: string[] = [];
    for (const file of modules) {
      for (const m of read(file).matchAll(/^export\s+(const|let|var|class)\s+(\w+)/gm)) {
        offenders.push(`${file}: export ${m[1]} ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

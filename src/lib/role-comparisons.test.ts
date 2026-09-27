/**
 * Never compare a role string: ask for a capability. CLAUDE.md says it; this checks it.
 *
 * Two shapes of the same mistake kept coming back:
 *
 *  - `tenantRole !== "admin"` at a call site. Eleven of them decided who may act on a
 *    colleague's record, and four left `owner` out — the owner of the workspace could not
 *    send a quote their own salesperson had drafted.
 *  - `users.role IN ('admin','owner')` to find "the admins" of a workspace. In the
 *    platform database that column is Flux's own staff scale; in a workspace's database it
 *    is a copy of the membership role, refreshed only when the person opens the dashboard
 *    and never removed when they leave. Either way it is not who belongs to the workspace
 *    now: approval requests and order alerts went to people who had left, and not to
 *    someone just promoted.
 *
 * `owner` comparisons stay allowed: "only an owner may demote an owner" is a rule about
 * that role's identity, not a capability. The platform's own panel and scripts work on
 * the platform scale by definition and are not scanned.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["src/actions", "src/app", "src/components", "src/lib"];
const EXEMPT = [
  /^src\/lib\/permissions\.ts$/,
  /^src\/actions\/platform-users\.ts$/,
  // Finds Flux's own staff to tell them an account needs a workspace: the platform scale on purpose.
  /^src\/lib\/platform-staff\.ts$/,
  /^src\/actions\/admin-/,
  /^src\/app\/\(main\)\/admin\//,
  /^src\/app\/api\/admin\//,
];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sources = ROOTS.flatMap((r) => files(join(process.cwd(), r)))
  .map((f) => relative(process.cwd(), f).split("\\").join("/"))
  .filter((f) => !EXEMPT.some((e) => e.test(f)))
  .map((f) => ({ file: f, text: stripComments(readFileSync(f, "utf8")) }));

function offenders(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const { file, text } of sources) {
    text.split("\n").forEach((line, i) => {
      if (pattern.test(line)) out.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe("⚠️⚠️ roles are asked about through can(), not compared", () => {
  it("scans the code it is meant to scan", () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it("no call site compares a workspace role to admin, editor or viewer", () => {
    expect(
      offenders(
        /[Rr]ole\s*[!=]==?\s*["'](admin|editor|viewer)["']|["'](admin|editor|viewer)["']\s*[!=]==?\s*\w*[Rr]ole\b/,
      ),
    ).toEqual([]);
  });

  it("nobody looks for a workspace's people in the platform role column", () => {
    expect(offenders(/(inArray|eq|ne)\(\s*users\.role\b/)).toEqual([]);
  });
});

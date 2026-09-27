/**
 * A link that names a record must land on a page that reads the name.
 *
 * Eight places linked a deal as `/dashboard/pipeline?deal=…` or `?dealId=…`, and a
 * converted contact as `/dashboard/contacts?contactId=…`. Neither page ever read the
 * parameter: the click worked, the page loaded, and the user was left on a board of
 * forty cards with no way to tell which one they had been sent to. Nothing about it
 * looks like a failure — which is why this reads the source instead of waiting for
 * somebody to notice.
 *
 * Every `/dashboard/…?name=${…}` in the code is checked against the route it points
 * at: somewhere under that folder the parameter has to be read, either from
 * `searchParams` in the page or with `get("name")` in a client component.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const DASHBOARD = join(SRC, "app", "(main)", "dashboard");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      files(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const LINK = /\/dashboard\/([A-Za-z0-9/_-]*)\?([A-Za-z]+)=\$\{/g;

interface Link {
  file: string;
  path: string;
  param: string;
}

function linksIn(source: string, file: string): Link[] {
  const found: Link[] = [];
  for (const m of source.matchAll(LINK)) found.push({ file, path: m[1].replace(/\/$/, ""), param: m[2] });
  return found;
}

/** Whether anything under the route folder reads `param` from the query string. */
function routeReads(path: string, param: string): boolean {
  const dir = join(DASHBOARD, ...path.split("/"));
  if (!existsSync(dir)) return false;
  const reads = [
    new RegExp(`get\\(\\s*["'\`]${param}["'\`]\\s*\\)`),
    // `searchParams: Promise<{ task?: string }>` followed by a destructure or a read.
    new RegExp(`searchParams[\\s\\S]{0,200}\\b${param}\\??:`),
    // The awaited params read by name (the pipeline board's `params.owners`).
    new RegExp(`\\bparams\\.${param}\\b`),
  ];
  return files(dir).some((f) => {
    const text = readFileSync(f, "utf8");
    return reads.some((r) => r.test(text));
  });
}

const allLinks = files(SRC).flatMap((f) => linksIn(readFileSync(f, "utf8"), relative(process.cwd(), f)));

describe("⚠️⚠️ a link to a record lands where the record is", () => {
  it("finds the links it is meant to check (the scan is not vacuous)", () => {
    // If the pattern stopped matching, every assertion below would pass on nothing.
    expect(allLinks.length).toBeGreaterThan(3);
  });

  it("every `?name=<interpolated>` link points at a route that reads `name`", () => {
    const unread = allLinks
      .filter((l) => !routeReads(l.path, l.param))
      .map((l) => `${l.file}: /dashboard/${l.path}?${l.param}=`);
    expect(unread).toEqual([]);
  });

  it("the check itself catches the shape that shipped", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shipped source text, quoted on purpose
    const shipped = linksIn("href: `/dashboard/pipeline?deal=${d.id}`", "x.ts");
    expect(shipped).toEqual([{ file: "x.ts", path: "pipeline", param: "deal" }]);
    expect(routeReads("pipeline", "deal")).toBe(false);
    expect(routeReads("contacts", "contactId")).toBe(false);
    expect(routeReads("tasks", "task")).toBe(true);
  });
});

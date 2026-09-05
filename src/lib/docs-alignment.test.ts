/**
 * Keeps the Help Centre and the API documentation attached to the product.
 *
 * Documentation drift is not a typo. It is the page that says the workspace is
 * chosen from the subdomain when nothing has read the Host header for a year;
 * the link to a settings page that moved; the endpoint added six months ago that
 * nobody wrote down. Each one is invisible from the inside, because the person
 * writing the code already knows the answer and the person reading the docs does
 * not know there is a question.
 *
 * These checks are deliberately coarse. They cannot tell whether a description
 * is *true* — only whether the things it names still exist. That catches the
 * class of drift that happens on its own, when a route is renamed or a page is
 * moved, and leaves the rest to a person.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

const HELP = "src/app/(main)/dashboard/help/page.tsx";
const API_DOCS = "src/app/(main)/admin/api-docs/_components/api-docs-client.tsx";
const API_ROOT = "src/app/api";

/** Every `METHOD /api/…` the documentation lists. */
function documentedEndpoints(): { method: string; path: string }[] {
  const src = read(API_DOCS);
  const re = /method:\s*"(GET|POST|PUT|PATCH|DELETE)",\s*\n\s*path:\s*"([^"]+)"/g;
  return [...src.matchAll(re)].map((m) => ({ method: m[1], path: m[2] }));
}

/** Every route the app actually serves, as `METHOD /api/…` with {params}. */
function realEndpoints(): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "route.ts") continue;

      const path = `/api/${full
        .slice(API_ROOT.length + 1)
        .replace(/\\/g, "/")
        .replace(/\/route\.ts$/, "")
        .replace(/\[(\w+)\]/g, "{$1}")}`;

      for (const m of read(full).matchAll(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)/gm)) {
        out.push({ method: m[1], path });
      }
    }
  };

  walk(API_ROOT);
  return out;
}

describe("the Help Centre", () => {
  it("⚠️ links only to pages that exist", () => {
    // A dead link here was `/dashboard/settings/targets`, and the same wrong path
    // was also in a `revalidatePath` — so saving a target did not refresh the page
    // that shows it. A link nobody clicks in testing rots quietly.
    const links = [...new Set([...read(HELP).matchAll(/href:\s*"(\/[^"]+)"/g)].map((m) => m[1]))];
    const dead = links.filter(
      (href) =>
        !existsSync(`src/app/(main)${href}/page.tsx`) &&
        !existsSync(`src/app${href}/page.tsx`) &&
        !existsSync(`src/app/(external)${href}/page.tsx`),
    );
    expect(dead).toEqual([]);
  });

  it("has something to say about every section it lists", () => {
    const src = read(HELP);
    const empty = [...src.matchAll(/id: "([\w-]+)",[\s\S]{0,900}?topics: \[(\s*)\]/g)].map((m) => m[1]);
    expect(empty).toEqual([]);
  });
});

describe("the API documentation", () => {
  it("⚠️ documents no endpoint the app does not serve", () => {
    // The opposite of a missing page: an entry that survives the route being
    // renamed, so somebody integrates against a 404 and blames their own code.
    const real = new Set(realEndpoints().map((e) => `${e.method} ${e.path}`));
    const phantom = documentedEndpoints()
      .map((e) => `${e.method} ${e.path}`)
      .filter((e) => !real.has(e));
    expect(phantom).toEqual([]);
  });

  it("⚠️ documents every endpoint the app serves", () => {
    // Sixteen were missing when this was first checked, six of them a whole
    // capability — the routes that start from a phone number instead of an id.
    // An endpoint nobody wrote down might as well not exist, and the person who
    // needed it had no way to learn it was there.
    //
    // NextAuth's catch-all is the one exception: it is the library's surface, not
    // this product's, and documenting it here would only go stale.
    const documented = new Set(documentedEndpoints().map((e) => `${e.method} ${e.path}`));
    const missing = realEndpoints()
      .filter((e) => !e.path.startsWith("/api/auth/"))
      .map((e) => `${e.method} ${e.path}`)
      .filter((e) => !documented.has(e));
    expect(missing).toEqual([]);
  });

  it("⚠️ never tells anybody to call a per-workspace subdomain", () => {
    // It did, for long enough that two sections of the same page contradicted
    // each other: one said the product lives on a single domain, the other told
    // integrators to call `https://acme.fluxcrm.com/api/crm/leads` because the
    // server would read the Host header. Nothing has read the Host header for
    // tenant routing in this codebase — the credential says which workspace it
    // is — so anybody following that section got a 400 they could not explain.
    //
    // Checks for a *workspace* subdomain, not for the domain: `app.fluxcrm.com`
    // is the right example and has to stay usable.
    const src = read(API_DOCS);
    const offenders = [...src.matchAll(/https:\/\/([a-z0-9-]+)\.fluxcrm\.com/g)]
      .map((m) => m[1])
      .filter((host) => host !== "app");
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("⚠️ says out loud where the workspace does come from", () => {
    // The correction is worth pinning: if somebody rewrites this section, the
    // one sentence that must survive is the one naming the credential.
    const src = read(API_DOCS);
    expect(src).toContain("X-Tenant-ID");
    expect(src.toLowerCase()).toContain("chiave del workspace");
  });
});

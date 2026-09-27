/**
 * The email builder's designs: kept, reopened, and never swapped for the placeholder.
 *
 * ⚠️⚠️ The builder always sent its design with a save and nothing kept it — the action's
 * schema dropped the field, the table had no column. Every template reopened on the
 * placeholder email, and saving it replaced the email that was really sent. These tests
 * hold the two halves: the action keeps the design, and a template without one opens
 * as its own HTML.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import {
  compileToHtml,
  DEFAULT_SETTINGS,
  designFromBody,
  type EmailDesign,
  emptyDesign,
  type FooterProps,
  newBlock,
  parseDesign,
} from "./email-builder";

const db = drizzle(new PGlite(), { schema });

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireWriteAccess: async () => ({ userId: "u1" }),
  requirePlanModule: async () => undefined,
  requireCapability: async () => ({ userId: "u1" }),
}));

const marketing = await import("@/actions/marketing");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from email_template`);
});

describe("⚠️⚠️ a saved design is kept", () => {
  it("is stored by create and by update, and reopens as it was", async () => {
    const design = emptyDesign();
    const created = await marketing.createEmailTemplate({
      name: "Benvenuto",
      subject: "Ciao",
      body: compileToHtml(design),
      design: JSON.stringify(design),
    });
    expect(parseDesign(created.design)).toEqual(design);

    const edited: EmailDesign = { ...design, blocks: design.blocks.slice(0, 2) };
    const updated = await marketing.updateEmailTemplate(created.id, {
      body: compileToHtml(edited),
      design: JSON.stringify(edited),
    });
    expect(parseDesign(updated.design)?.blocks.map((b) => b.id)).toEqual(edited.blocks.map((b) => b.id));
  });

  it("can be cleared, for a template whose HTML was then edited by hand", async () => {
    const design = emptyDesign();
    const created = await marketing.createEmailTemplate({
      name: "A",
      subject: "B",
      body: "<p>x</p>",
      design: JSON.stringify(design),
    });
    const updated = await marketing.updateEmailTemplate(created.id, { body: "<p>y</p>", design: null });
    expect(updated.design).toBeNull();
  });
});

describe("⚠️⚠️ a template without a design opens as its own HTML", () => {
  it("keeps what is inside <body>, as one HTML block", () => {
    const body = `<!DOCTYPE html><html><head><title>t</title></head><body style="margin:0"><table><tr><td>Offerta di ottobre</td></tr></table></body></html>`;
    const design = designFromBody(body, true);
    expect(design.blocks).toHaveLength(1);
    expect(design.blocks[0].type).toBe("html");
    expect(design.blocks[0].props).toMatchObject({ html: "<table><tr><td>Offerta di ottobre</td></tr></table>" });
    // Saved again, the email still says what it said.
    expect(compileToHtml(design)).toContain("Offerta di ottobre");
  });

  it("takes an HTML fragment as it is", () => {
    expect(designFromBody("<p>Ciao</p>", true).blocks[0].props).toMatchObject({ html: "<p>Ciao</p>" });
  });

  it("turns plain text into escaped paragraphs", () => {
    const design = designFromBody("Riga uno\nriga due\n\n<Secondo> paragrafo", false);
    expect((design.blocks[0].props as { html: string }).html).toBe(
      "<p>Riga uno<br />riga due</p>\n<p>&lt;Secondo&gt; paragrafo</p>",
    );
  });
});

describe("parseDesign", () => {
  it("refuses what is not a design, so the caller falls back to the HTML", () => {
    expect(parseDesign(null)).toBeNull();
    expect(parseDesign("")).toBeNull();
    expect(parseDesign("{not json")).toBeNull();
    expect(parseDesign(JSON.stringify({ blocks: "no" }))).toBeNull();
    expect(parseDesign(JSON.stringify({ blocks: [] }))).toBeNull();
  });

  it("drops blocks it does not know and fills settings a design is older than", () => {
    const heading = newBlock("heading");
    const parsed = parseDesign(
      JSON.stringify({
        settings: { backgroundColor: "#000000" },
        blocks: [heading, { id: "x", type: "video", props: {} }],
      }),
    );
    expect(parsed?.blocks).toEqual([heading]);
    expect(parsed?.settings).toEqual({ ...DEFAULT_SETTINGS, backgroundColor: "#000000" });
  });
});

describe("the unsubscribe link", () => {
  const footer = (props: Partial<FooterProps>): EmailDesign => {
    const block = newBlock("footer");
    return { version: 1, settings: DEFAULT_SETTINGS, blocks: [{ ...block, props: { ...block.props, ...props } }] };
  };

  it("says what the author chose, escaped", () => {
    const html = compileToHtml(footer({ unsubscribeLabel: "Annulla l'iscrizione <qui>" }));
    expect(html).toContain("Annulla l'iscrizione &lt;qui&gt;</a>");
    expect(html).toContain('href="{{link_unsubscribe}}"');
  });

  it("reads Unsubscribe in a design saved before it could be chosen", () => {
    expect(compileToHtml(footer({ unsubscribeLabel: undefined }))).toContain(">Unsubscribe</a>");
  });

  it("is left out when switched off", () => {
    expect(compileToHtml(footer({ showUnsubscribe: false }))).not.toContain("link_unsubscribe");
  });
});

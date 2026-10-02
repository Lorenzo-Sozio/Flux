/**
 * Configures one workspace for the operating process in docs/processo-operativo-2026-10.md
 * ("tappa 0"): pipeline stages, loss reasons, custom fields, groups, the «Primo contatto»
 * sequence, shared email templates, support macros, catalogue lines and automation rules.
 *
 *   npx tsx scripts/setup-processo-operativo.ts <subdomain>             # preview: changes nothing
 *   npx tsx scripts/setup-processo-operativo.ts <subdomain> --applica   # writes
 *
 * Options, all optional:
 *   --rotazione=anna@x.it,luca@x.it   who new leads without an owner are handed to, in turn
 *   --amministrazione=anna@x.it       who gets the task when a deal is won
 *   --assistenza=marco@x.it           who hears of urgent tickets and missed SLAs
 *   --valutazione                     switch on the satisfaction email on resolution
 *
 * ⚠️ It never deletes, and never overwrites a choice: see src/lib/workspace-setup/processo-operativo.ts.
 * Automation rules are created switched off. Run the preview first and read it.
 */
import { config } from "dotenv";
import { eq, or } from "drizzle-orm";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const SYMBOL = { create: "+ crea    ", update: "~ adatta  ", exists: "= c'è già ", skip: "! salta   " } as const;

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  if (!target) {
    console.error("uso: npx tsx scripts/setup-processo-operativo.ts <sottodominio> [--applica] [--rotazione=…]");
    process.exit(1);
  }
  const apply = args.includes("--applica");

  const { platformDb, createTenantDb } = await import("../src/db");
  const { tenants } = await import("../src/db/schema");
  const { decryptDbUrl } = await import("../src/lib/tenant-db");
  const { setupProcessoOperativo } = await import("../src/lib/workspace-setup/processo-operativo");

  const tenant = await platformDb.query.tenants.findFirst({
    where: or(eq(tenants.id, target), eq(tenants.subdomain, target)),
  });
  if (!tenant) {
    console.error(`nessun workspace con id o sottodominio ${JSON.stringify(target)}`);
    process.exit(1);
  }
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  const lines = await setupProcessoOperativo(db, {
    apply,
    rotation: flag("rotazione")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    administration: flag("amministrazione"),
    supportLead: flag("assistenza"),
    csat: args.includes("--valutazione"),
  });

  console.log(`\n${tenant.name} (${tenant.subdomain}) — ${apply ? "APPLICATO" : "anteprima, nulla è stato scritto"}\n`);
  let area = "";
  for (const l of lines) {
    if (l.area !== area) {
      area = l.area;
      console.log(`\n${area}`);
    }
    console.log(`  ${SYMBOL[l.status]} ${l.item}${l.note ? `  — ${l.note}` : ""}`);
  }
  const todo = lines.filter((l) => l.status === "create" || l.status === "update").length;
  console.log(
    apply ? `\nFatto: ${todo} modifiche.` : `\n${todo} modifiche da fare. Per applicarle: aggiungi --applica.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

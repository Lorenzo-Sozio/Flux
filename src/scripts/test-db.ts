import { platformDb as db } from "../db";
import { leads } from "../db/schema";

async function main() {
  const allLeads = await db.select().from(leads);
  console.log("Leads in DB:", JSON.stringify(allLeads, null, 2));
}

main().catch(console.error);

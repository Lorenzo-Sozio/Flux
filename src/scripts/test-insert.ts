import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../db/schema";

dotenv.config();

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function run() {
  console.log("Testing lead insertion...");
  try {
    const owner = await db.select().from(schema.users).limit(1);
    const ownerId = owner[0].id;

    await db.insert(schema.leads).values({
      firstName: "Test",
      lastName: "User",
      status: "new",
      ownerId: ownerId,
    });
    console.log("Success");
  } catch (e) {
    console.error("DB Error:", e);
  }
}

run().catch(console.error);

import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

dotenv.config();

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function run() {
  console.log("Migrating...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migration done!");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

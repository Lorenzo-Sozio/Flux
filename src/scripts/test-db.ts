import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../db/schema';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function run() {
  console.log("Checking leads table...");
  const existing = await db.select().from(schema.leads).limit(1);
  console.log("Existing:", existing);
}

run().catch(console.error);
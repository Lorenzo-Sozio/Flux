import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  const users = await sql`SELECT id, email FROM "user"`;
  console.log("Users:", users);
}

run().catch(console.error);
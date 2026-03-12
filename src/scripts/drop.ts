import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  
  await sql`DROP TABLE IF EXISTS "order_item" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "order" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "product" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "activity" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "opportunity" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "contact" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "lead" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "company" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "account" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "session" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "verificationToken" CASCADE;`;
  await sql`DROP TABLE IF EXISTS "user" CASCADE;`;
  
  console.log('Tables dropped');
}

run().catch(console.error);
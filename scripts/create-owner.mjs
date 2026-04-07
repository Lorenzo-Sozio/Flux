/**
 * Creates an owner user in the database.
 * Run: node scripts/create-owner.mjs
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");

const { neon } = await import("@neondatabase/serverless");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌  DATABASE_URL is not set in .env / .env.local");
  process.exit(1);
}

const sql = neon(connectionString);

// ── Owner credentials — change before running if needed ───────────────────────
const OWNER = {
  name:     "Admin Owner",
  email:    "owner@fluxcrm.com",
  password: "Admin1234!",
  role:     "owner",
};
// ─────────────────────────────────────────────────────────────────────────────

const hashed = await bcrypt.hash(OWNER.password, 12);

try {
  const existing = await sql`SELECT id FROM "user" WHERE email = ${OWNER.email} LIMIT 1`;
  if (existing.length > 0) {
    console.log(`⚠️  User ${OWNER.email} already exists — updating role to owner and resetting password...`);
    await sql`
      UPDATE "user"
      SET password = ${hashed}, role = 'owner', "emailVerified" = NOW()
      WHERE email = ${OWNER.email}
    `;
    console.log("✅  Password and role updated.");
    console.log(`   Email:    ${OWNER.email}`);
    console.log(`   Password: ${OWNER.password}`);
    process.exit(0);
  }

  const [row] = await sql`
    INSERT INTO "user" (id, name, email, password, role, "emailVerified")
    VALUES (
      gen_random_uuid()::text,
      ${OWNER.name},
      ${OWNER.email},
      ${hashed},
      ${OWNER.role},
      NOW()
    )
    RETURNING id, email, role
  `;

  console.log("✅  Owner user created successfully!");
  console.log(`   Email:    ${row.email}`);
  console.log(`   Password: ${OWNER.password}`);
  console.log(`   Role:     ${row.role}`);
  console.log(`   ID:       ${row.id}`);
} catch (err) {
  console.error("❌  Failed:", err.message);
  process.exit(1);
}

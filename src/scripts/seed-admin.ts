/**
 * Bootstrap the first platform admin user.
 *
 * Usage:
 *   npx tsx --env-file=.env src/scripts/seed-admin.ts
 *
 * Environment variables:
 *   ADMIN_EMAIL     – email of the admin (required)
 *   ADMIN_PASSWORD  – password (required when creating a new user)
 *   ADMIN_NAME      – display name (optional, defaults to email prefix)
 *
 * Behaviour:
 *   • If a user with role "owner" or "admin" already exists → exits without changes.
 *   • If the email matches an existing user → promotes them to "owner".
 *   • Otherwise → creates a new user with role "owner".
 */

import { eq, or } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function main() {
  // Lazy-load so env vars are resolved before module initialisation
  const { platformDb } = await import("../db/index.js");
  const { users } = await import("../db/schema.js");

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME;

  if (!email) {
    console.error("❌  ADMIN_EMAIL is required.");
    console.error("   Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret npx tsx --env-file=.env src/scripts/seed-admin.ts");
    process.exit(1);
  }

  // Check if a platform admin already exists
  const [existingAdmin] = await platformDb
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(or(eq(users.role, "owner"), eq(users.role, "admin")));

  if (existingAdmin) {
    console.log(`✓ Platform admin already exists: ${existingAdmin.email} (${existingAdmin.role})`);
    console.log("  Use /admin/users to manage platform admins.");
    process.exit(0);
  }

  // Check if the target email already has an account
  const [byEmail] = await platformDb
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email));

  if (byEmail) {
    await platformDb.update(users).set({ role: "owner" }).where(eq(users.id, byEmail.id));
    console.log(`✓ Promoted existing user "${email}" to role "owner".`);
    process.exit(0);
  }

  // Create a brand-new admin user
  if (!password) {
    console.error("❌  ADMIN_PASSWORD is required when creating a new user.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌  ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await platformDb.insert(users).values({
    name: name ?? email.split("@")[0],
    email,
    password: hashedPassword,
    role: "owner",
  });

  console.log(`✓ Created platform admin: ${email} (owner)`);
  console.log("  You can now log in at /login and verify at /admin/login.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌  Seed failed:", err.message ?? err);
  process.exit(1);
});

// ⚠️ First, and as a side effect: `src/db` reads DATABASE_URL while it is being
// imported, so a `dotenv.config()` call in the body of this file runs too late and
// the connection is built without a password.
import "dotenv/config";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { platformDb } from "../db";
import * as schema from "../db/schema";

/**
 * Creates the first platform administrator — Flux's own staff, who operate /admin
 * across every workspace. Not a workspace member: that is a different scale entirely
 * (see the two role scales in CLAUDE.md).
 *
 * ⚠️ The password used to be the literal string "admin", written here and printed on
 * every run. It reached at least one deployed database that way. It now comes from
 * ADMIN_PASSWORD, or is generated and printed once — and an account that already
 * exists is left exactly as it is, because re-running a setup script is not a reason
 * to reset somebody's credentials.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=… npx tsx src/scripts/create-admin.ts
 */
function generatedPassword(): string {
  // 24 characters from a set with no look-alikes, so it survives being read aloud.
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function createAdmin() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@flux.local").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim() || generatedPassword();
  const generated = !process.env.ADMIN_PASSWORD?.trim();

  const [existing] = await platformDb.select().from(schema.users).where(eq(schema.users.email, email));
  if (existing) {
    console.log(`Admin ${email} already exists — nothing changed.`);
    return;
  }

  await platformDb.insert(schema.users).values({
    name: "Admin Flux",
    email,
    password: await bcrypt.hash(password, 10),
    role: "admin",
  });

  console.log(`Admin created: ${email}`);
  if (generated) console.log(`Password (shown once): ${password}`);
}

createAdmin()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed to create admin user", e);
    process.exit(1);
  });

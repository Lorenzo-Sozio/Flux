// ⚠️ First, and as a side effect: `src/db` reads DATABASE_URL while it is imported.
import "dotenv/config";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { platformDb } from "../db";
import * as schema from "../db/schema";

/**
 * Sets a platform account's password.
 *
 *   npx tsx src/scripts/set-password.ts admin@flux.local 'new password'
 *
 * ⚠️ For an account you own on a deployment you operate. It changes a credential
 * without asking for the old one, which is exactly what an administrator needs and
 * exactly what nothing reachable from the browser may do.
 */
const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: npx tsx src/scripts/set-password.ts <email> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Choose a password of at least 8 characters.");
  process.exit(1);
}

(async () => {
  const updated = await platformDb
    .update(schema.users)
    .set({ password: await bcrypt.hash(password, 10) })
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .returning({ email: schema.users.email });

  if (updated.length === 0) {
    console.error(`No account with that address: ${email}`);
    process.exit(1);
  }
  console.log(`Password set for ${updated[0].email}`);
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed:", e?.message ?? e);
    process.exit(1);
  });

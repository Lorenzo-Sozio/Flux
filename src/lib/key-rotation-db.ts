import { and, eq } from "drizzle-orm";

import { emailSettings, mailConnections, sdiSettings, tenants } from "@/db/schema";

/**
 * The statements a key rotation writes with, built but not run.
 *
 * Separate from the script so a test can read the SQL drizzle generates. The one
 * guarantee that matters lives in the `WHERE`: a value is replaced only while it
 * is still the value that was read. Drop the second condition and a rotation
 * running alongside somebody saving new email credentials would overwrite them
 * with an encrypted copy of the old ones.
 */

export type RotatedColumn =
  | "db_url"
  | "resend_api_key"
  | "smtp_password"
  | "access_token"
  | "refresh_token"
  | "sdi_password";

export interface RotatedLocation {
  table: "tenants" | "email_settings" | "mail_connection" | "sdi_setting";
  column: RotatedColumn;
  id: string;
}

// biome-ignore lint/suspicious/noExplicitAny: a platform or tenant drizzle handle
type AnyDb = any;

/** `UPDATE … SET column = to WHERE id = ? AND column = from RETURNING id`. */
export function conditionalWrite(db: AnyDb, where: RotatedLocation, from: string, to: string) {
  if (where.table === "tenants") {
    return db
      .update(tenants)
      .set({ dbUrl: to })
      .where(and(eq(tenants.id, where.id), eq(tenants.dbUrl, from)))
      .returning({ id: tenants.id });
  }
  // A person's mailbox tokens (V3.2). ⚠️ A refresh racing the rotation rewrites the token;
  // the condition below is what makes the rotation skip that row rather than undo it.
  if (where.table === "mail_connection") {
    const col = where.column === "access_token" ? mailConnections.accessToken : mailConnections.refreshToken;
    const set = where.column === "access_token" ? { accessToken: to } : { refreshToken: to };
    return db
      .update(mailConnections)
      .set(set)
      .where(and(eq(mailConnections.id, where.id), eq(col, from)))
      .returning({ id: mailConnections.id });
  }
  // The SDI intermediary's password (src/lib/sdi/). Its tokens are not rotated: a token the new
  // key cannot open is replaced by a new sign-in.
  if (where.table === "sdi_setting") {
    return db
      .update(sdiSettings)
      .set({ password: to })
      .where(and(eq(sdiSettings.id, where.id), eq(sdiSettings.password, from)))
      .returning({ id: sdiSettings.id });
  }
  const column = where.column === "resend_api_key" ? emailSettings.resendApiKey : emailSettings.smtpPassword;
  const set = where.column === "resend_api_key" ? { resendApiKey: to } : { smtpPassword: to };
  return db
    .update(emailSettings)
    .set(set)
    .where(and(eq(emailSettings.id, where.id), eq(column, from)))
    .returning({ id: emailSettings.id });
}

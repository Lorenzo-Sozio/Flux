import { defineConfig } from "drizzle-kit";

// GENERATION ONLY — used exclusively for `npm run generate:tenant-migrations`.
// Never run `drizzle-kit push` with this config: it would push the tenant schema
// to the PLATFORM database (DATABASE_URL) and may drop platform-only tables.
// Tenant databases are migrated at runtime via migrate() in migrateTenantDb().
export default defineConfig({
  schema: "./src/db/schema-tenant.ts",
  out: "./src/db/migrations-tenant",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

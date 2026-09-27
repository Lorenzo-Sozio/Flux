import { getTableColumns, getTableName, inArray, sql } from "drizzle-orm";

import { companies, contacts, leads } from "@/db/schema";
import { chunk, INSERT_CHUNK, LOOKUP_CHUNK } from "@/lib/api-import-batch";
import {
  buildCompanyPayload,
  buildContactPayload,
  buildLeadPayload,
  type ValidationError,
  validateCompanyInput,
  validateContactInput,
  validateLeadInput,
} from "@/lib/api-import-validators";
import {
  BOOLEAN_FIELDS,
  type CsvEntity,
  headerMap,
  LIST_FIELDS,
  LOWERCASE_FIELDS,
  normaliseHeader,
} from "@/lib/csv-import-fields";
import type { getDb } from "@/lib/tenant-context";

export type { CsvEntity };

/**
 * Importing a CSV from the dashboard: the same rules as the import API, in the same
 * three passes.
 *
 * ⚠️⚠️ **Nothing writes inside the row loop.** The routes this replaces ran two to four
 * statements per row, one after another, for up to 5,000 rows. On Workers every statement
 * is a subrequest and the budget is a thousand: a file past a few hundred rows stopped
 * halfway, some contacts in and the rest not, and the person importing saw a generic
 * error with no way to tell which. Here a file of 5,000 rows is about forty statements:
 * validate with no database, look the whole file up at once, write in chunks.
 *
 * ⚠️ **The API's validators, not a second set.** The CSV routes had their own field
 * handling — and the company import matched on the exact name while everything else
 * ignored case, so "ACME S.r.l." and "Acme S.r.l." became two companies.
 *
 * ⚠️ **No rules and no webhooks**, as before and as the API's bulk routes: an import is
 * moving data in, not a sequence of events. See src/lib/api-automations.ts.
 */

export const MAX_IMPORT_ROWS = 5_000;

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * One CSV row as the object the API validator reads: known headers renamed, empty cells
 * dropped (an empty email is no email, not an invalid one), yes/no and sì/no read as a
 * boolean, and a tag cell split on `;` or `,`.
 */
export function rowToInput(entity: CsvEntity, row: Record<string, unknown>): Record<string, unknown> {
  const map = headerMap(entity);
  const out: Record<string, unknown> = {};
  for (const [header, raw] of Object.entries(row)) {
    const field = map.get(normaliseHeader(header));
    if (!field || field in out) continue;
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === "" || value === null || value === undefined) continue;
    if (BOOLEAN_FIELDS.has(field)) {
      out[field] = /^(yes|si|sì|true|1|y|x)$/i.test(String(value));
    } else if (LIST_FIELDS.has(field)) {
      out[field] = String(value)
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (LOWERCASE_FIELDS.has(field)) {
      out[field] = String(value).toLowerCase();
    } else {
      out[field] = value;
    }
  }
  return out;
}

export interface RowError {
  /** 1-based, counting the header: the line a spreadsheet shows. */
  line: number;
  errors: ValidationError[];
}

/**
 * What to do with a row whose email (contacts, leads) or name (companies) is already in
 * the workspace — or earlier in the same file.
 *
 *  - `skip`: leave the record as it is. The default, and what the import always did.
 *  - `update`: fill the record with the row's non-empty cells. An empty cell never blanks
 *    a field somebody filled in; the owner and the source are never changed.
 *  - `create`: a new record regardless — for a file of people who share an address.
 */
export type OnDuplicate = "skip" | "update" | "create";

export interface CsvImportPlan {
  entity: CsvEntity;
  total: number;
  /** Rows that will be created, and companies a contact import creates on the way. */
  newRecords: number;
  /** Existing records the file will update (`onDuplicate: "update"`), each counted once. */
  updated: number;
  skipped: number;
  duplicates: string[];
  errors: RowError[];
  write: () => Promise<void>;
}

type Table = typeof contacts | typeof leads | typeof companies;
type Row = {
  input: Record<string, unknown>;
  data: Record<string, unknown>;
  key: string | null;
  company: string | null;
};

/**
 * Never written by an update from a file: where the customer came from is somebody's
 * record of it, not a cell to overwrite. (The owner is not a column a file can carry.)
 */
const NEVER_PATCHED = new Set(["source"]);

/**
 * The columns an update from this row writes: only the cells the row actually filled, as
 * the validator normalised them, keyed by database column.
 */
function patchOf(table: Table, row: Row): Record<string, unknown> {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row.input)) {
    if (NEVER_PATCHED.has(key) || !cols[key]) continue;
    const value = row.data[key];
    if (value !== undefined && value !== null) out[cols[key].name] = value;
  }
  return out;
}

/**
 * ⚠️⚠️ Many rows, one statement per chunk. An update per row is what the budget rules out
 * (the file can hold 5,000); instead each chunk goes as one JSON array, and Postgres lays
 * every patch over its row with `jsonb_populate_record`, which also does the casting.
 *
 * ⚠️ `(e.x -> 'patch')` needs its brackets: `||` and `->` bind alike, left to right, so
 * without them the row is merged first and the patch alone is kept — no id, nothing updated.
 */
async function writePatches(db: Db, table: Table, patches: { id: string; patch: Record<string, unknown> }[]) {
  const name = getTableName(table);
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const stamp = cols.updatedAt ? { [cols.updatedAt.name]: new Date().toISOString() } : {};
  for (const slice of chunk(patches, INSERT_CHUNK)) {
    const body = slice.map((p) => ({ id: p.id, patch: { ...p.patch, ...stamp } }));
    const touched = [...new Set(body.flatMap((p) => Object.keys(p.patch)))];
    if (touched.length === 0) continue;
    await db.execute(sql`
      update ${sql.identifier(name)} as t
      set ${sql.join(
        touched.map((c) => sql`${sql.identifier(c)} = r.${sql.identifier(c)}`),
        sql`, `,
      )}
      from (
        select (jsonb_populate_record(null::${sql.identifier(name)}, to_jsonb(cur) || (e.x -> 'patch'))).*
        from jsonb_array_elements(${JSON.stringify(body)}::jsonb) as e(x)
        join ${sql.identifier(name)} as cur on cur.id = e.x ->> 'id'
      ) as r
      where t.id = r.id`);
  }
}

/** Values already in `table`'s dedup column, ignoring case, as [value, id] pairs. */
async function existingKeys(db: Db, entity: CsvEntity, keys: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  const found = new Map<string, string>();
  const table = entity === "contacts" ? contacts : entity === "leads" ? leads : companies;
  const column = entity === "companies" ? companies.name : (table as typeof contacts).email;
  for (const slice of chunk(wanted, LOOKUP_CHUNK)) {
    const rows = await db
      .select({ id: table.id, key: column })
      .from(table)
      .where(inArray(sql`lower(${column})`, slice));
    for (const r of rows) if (r.key && !found.has(r.key.toLowerCase())) found.set(r.key.toLowerCase(), r.id);
  }
  return found;
}

/**
 * Validates and looks up a whole file, and returns what importing it would do — without
 * writing. The route checks the plan's size against the workspace's limits, then calls
 * `write`; the import wizard's preview is the same plan, never written. Deciding everything
 * first is what lets a file that would overflow the plan be refused whole, instead of
 * stopping at whatever row happened to cross the line.
 */
export async function planCsvImport(
  db: Db,
  entity: CsvEntity,
  rows: Record<string, unknown>[],
  ownerId: string,
  options: { onDuplicate?: OnDuplicate } = {},
): Promise<CsvImportPlan> {
  const onDuplicate = options.onDuplicate ?? "skip";
  const table: Table = entity === "contacts" ? contacts : entity === "leads" ? leads : companies;
  const errors: RowError[] = [];
  const duplicates: string[] = [];
  let skipped = 0;

  // ── 1. Validate, with no database ────────────────────────────────────────────
  const valid: Row[] = [];
  rows.forEach((raw, i) => {
    const input = rowToInput(entity, raw);
    const company = entity === "contacts" && typeof input.company === "string" ? input.company : null;
    delete input.company;
    const result =
      entity === "contacts"
        ? validateContactInput(input)
        : entity === "leads"
          ? validateLeadInput(input)
          : validateCompanyInput(input);
    if (!result.data) {
      errors.push({ line: i + 2, errors: result.errors });
      return;
    }
    const data = result.data as unknown as Record<string, unknown>;
    const keyValue = entity === "companies" ? data.name : data.email;
    valid.push({ input, data, key: typeof keyValue === "string" ? keyValue.toLowerCase() : null, company });
  });

  // ── 2. Look the whole file up at once ────────────────────────────────────────
  const existing =
    onDuplicate === "create"
      ? new Map<string, string>()
      : await existingKeys(
          db,
          entity,
          valid.map((v) => v.key),
        );

  // ── Decide each row ─────────────────────────────────────────────────────────
  const inserts: Row[] = [];
  const pending = new Map<string, Row>(); // key → a row this file is going to create
  const updates = new Map<string, Row[]>(); // existing id → the rows updating it
  for (const row of valid) {
    const known = row.key && onDuplicate !== "create" ? (existing.get(row.key) ?? pending.get(row.key)) : undefined;
    if (!known) {
      inserts.push(row);
      if (row.key) pending.set(row.key, row);
      continue;
    }
    duplicates.push(String(entity === "companies" ? row.data.name : row.data.email));
    if (onDuplicate === "skip") {
      skipped++;
    } else if (typeof known === "string") {
      updates.set(known, [...(updates.get(known) ?? []), row]);
    } else {
      // A second row for somebody this file creates: its cells fill the one insert.
      for (const k of Object.keys(row.input)) known.data[k] = row.data[k];
      known.company = row.company ?? known.company;
    }
  }

  // Contacts: the company each kept row names, found or created once per name.
  const companyIds = new Map<string, string>();
  const newCompanies: { id: string; name: string; ownerId: string; source: string }[] = [];
  if (entity === "contacts") {
    const named = new Map<string, string>();
    for (const r of [...inserts, ...[...updates.values()].flat()]) {
      if (r.company && !named.has(r.company.toLowerCase())) named.set(r.company.toLowerCase(), r.company);
    }
    for (const slice of chunk([...named.keys()], LOOKUP_CHUNK)) {
      const found = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(inArray(sql`lower(${companies.name})`, slice));
      for (const c of found) if (!companyIds.has(c.name.toLowerCase())) companyIds.set(c.name.toLowerCase(), c.id);
    }
    for (const [k, name] of named) {
      if (companyIds.has(k)) continue;
      const id = crypto.randomUUID();
      companyIds.set(k, id);
      newCompanies.push({ id, name, ownerId, source: "import" });
    }
  }
  const withCompany = (r: Row): Row => {
    if (!r.company) return r;
    const companyId = companyIds.get(r.company.toLowerCase()) ?? null;
    return { ...r, input: { ...r.input, companyId }, data: { ...r.data, companyId } };
  };

  const toInsert = inserts.map((r0) => {
    const r = withCompany(r0);
    const d = r.data as never;
    const payload =
      entity === "contacts"
        ? buildContactPayload(d, ownerId, "import")
        : entity === "leads"
          ? buildLeadPayload(d, ownerId, "import")
          : buildCompanyPayload(d, ownerId);
    return { ...payload, source: (r.data.source as string | null | undefined) ?? "import" };
  });

  const now = new Date().toISOString();
  const patches = [...updates.entries()].map(([id, list]) => {
    // Later rows over earlier ones, as a spreadsheet read top to bottom would.
    const merged = Object.assign({}, ...list.map((r) => patchOf(table, withCompany(r)))) as Record<string, unknown>;
    // A yes in the file is a decision recorded by this import (src/lib/consent.ts).
    if (merged.marketing_consent === true) Object.assign(merged, { consent_date: now, consent_source: "import" });
    return { id, patch: merged };
  });

  return {
    entity,
    total: rows.length,
    newRecords: toInsert.length + newCompanies.length,
    updated: patches.length,
    skipped: skipped + errors.length,
    duplicates,
    errors,
    // ── 3. Write in chunks ──────────────────────────────────────────────────────
    write: async () => {
      // Companies first: the contacts point at them.
      for (const slice of chunk(newCompanies, INSERT_CHUNK)) await db.insert(companies).values(slice);
      for (const slice of chunk(toInsert, INSERT_CHUNK)) await db.insert(table).values(slice as never);
      await writePatches(db, table, patches);
    },
  };
}

/**
 * Generates a static Postman Collection v2.1 JSON file from the OpenAPI spec.
 * Output: public/flux-crm-postman-collection.json
 *
 * Usage:
 *   npm run generate:postman
 *
 * The generated file can be imported into Postman via:
 *   Import → Upload Files → select public/flux-crm-postman-collection.json
 *
 * Or served from the server at /admin/api-docs/postman-collection.json
 * for the "Run in Postman" button.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// tsx handles TypeScript path aliases if tsconfig.json has paths configured.
// We import directly by relative path to avoid needing tsconfig-paths.
import { openApiSpec } from "../src/lib/openapi/spec";
import { toPostmanCollection } from "../src/lib/openapi/to-postman";

const outDir = path.join(process.cwd(), "public");
const outFile = path.join(outDir, "flux-crm-postman-collection.json");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const collection = toPostmanCollection(openApiSpec);
const json = JSON.stringify(collection, null, 2);

fs.writeFileSync(outFile, json, "utf-8");

const endpoints = Object.keys(openApiSpec.paths ?? {}).length;
console.log(`✓ Postman collection generated: ${outFile}`);
const item = (collection as { item?: unknown[] }).item;
console.log(`  → ${endpoints} paths · ${item?.length ?? 0} folders`);
console.log(`  → Import it in Postman: Import → Upload Files → flux-crm-postman-collection.json`);

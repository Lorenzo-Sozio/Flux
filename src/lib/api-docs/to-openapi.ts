/**
 * The public API entries (src/lib/api-docs/public-api.ts) as OpenAPI 3.0 paths.
 *
 * Generated, never written: \`/api/openapi.json\` and the staff spec both take their
 * \`/api/crm\` half from here, so the machine-readable reference cannot say something the
 * page does not. Each operation carries its scope twice — in the description, where a person
 * reads it, and as \`x-scope\`, where a generator can.
 */
import { type ApiEndpoint, type ApiGroup, PUBLIC_API_GROUPS, responsesFor } from "@/lib/api-docs/public-api";

type Json = Record<string, unknown>;

const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array"]);
const schemaType = (t: string) => {
  const base = t.toLowerCase().replace(/\[\]$/, "");
  if (t.endsWith("[]")) return { type: "array", items: { type: SCHEMA_TYPES.has(base) ? base : "string" } };
  return { type: SCHEMA_TYPES.has(base) ? base : "string" };
};

/** An example written as JSON becomes JSON; anything else stays the text it was. */
function example(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function operation(endpoint: ApiEndpoint, group: ApiGroup): Json {
  const params = endpoint.parameters ?? [];
  const inline = params.filter((p) => p.in === "query" || p.in === "path" || p.in === "header");
  const body = params.filter((p) => p.in === "body" || p.in === "form");

  const op: Json = {
    tags: [group.label],
    operationId: endpoint.id,
    summary: endpoint.summary,
    description: endpoint.scope ? `${endpoint.description}\n\nScope: \`${endpoint.scope}\`.` : endpoint.description,
    security: endpoint.auth === "public" ? [] : [{ apiKeyBearer: [] }, { sessionCookie: [] }],
    ...(endpoint.scope ? { "x-scope": endpoint.scope } : {}),
  };
  if (inline.length > 0) {
    op.parameters = inline.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.in === "path" ? true : p.required,
      description: p.description,
      schema: { ...schemaType(p.type), ...(p.enum ? { enum: p.enum } : {}) },
      ...(p.example !== undefined ? { example: p.example } : {}),
    }));
  }
  if (endpoint.requestBody || body.length > 0) {
    const contentType = endpoint.requestBody?.contentType ?? "application/json";
    op.requestBody = {
      required: true,
      content: {
        [contentType]: {
          ...(body.length > 0
            ? {
                schema: {
                  type: "object",
                  properties: Object.fromEntries(
                    body.map((p) => [p.name, { ...schemaType(p.type), description: p.description }]),
                  ),
                  required: body.filter((p) => p.required).map((p) => p.name),
                },
              }
            : {}),
          ...(endpoint.requestBody ? { example: example(endpoint.requestBody.example) } : {}),
        },
      },
    };
  }
  op.responses = Object.fromEntries(
    responsesFor(endpoint).map((r) => [
      String(r.status),
      { description: r.description, content: { "application/json": { example: example(r.example) } } },
    ]),
  );
  return op;
}

/** Every public operation, keyed as OpenAPI keys them: path, then lower-case method. */
export function publicApiPaths(groups: readonly ApiGroup[] = PUBLIC_API_GROUPS): Record<string, Json> {
  const paths: Record<string, Json> = {};
  for (const group of groups) {
    for (const endpoint of group.endpoints) {
      paths[endpoint.path] = {
        ...(paths[endpoint.path] ?? {}),
        [endpoint.method.toLowerCase()]: operation(endpoint, group),
      };
    }
  }
  return paths;
}

export function publicApiTags(groups: readonly ApiGroup[] = PUBLIC_API_GROUPS) {
  return groups.map((g) => ({ name: g.label, description: g.description }));
}

/** The whole public reference, as served at /api/openapi.json. */
export function publicOpenApi(origin: string | null) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Flux CRM API",
      version: "1.0.0",
      description:
        "The API an integration calls. Send a workspace key as `Authorization: Bearer <key>`: the key says which workspace, and its scopes say what it may do. A missing scope is a 403 that names it.",
    },
    ...(origin ? { servers: [{ url: origin }] } : {}),
    components: {
      securitySchemes: {
        apiKeyBearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "flx2.<workspace>.<secret>",
          description: "A workspace key from Settings → API, with the scopes the operation names.",
        },
        sessionCookie: { type: "apiKey", in: "cookie", name: "authjs.session-token" },
      },
    },
    tags: publicApiTags(),
    paths: publicApiPaths(),
  };
}

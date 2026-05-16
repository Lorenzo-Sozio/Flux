// Converts an OpenAPI 3.x spec object to a Postman Collection v2.1 JSON.
// Handles GET/POST/DELETE/PUT/PATCH with query, path, header, and JSON/form-data bodies.

interface OpenApiParam {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string; enum?: string[]; example?: unknown };
  description?: string;
  example?: unknown;
}

interface OpenApiOperation {
  tags?: string[];
  operationId?: string;
  summary?: string;
  description?: string;
  security?: Record<string, string[]>[];
  parameters?: OpenApiParam[];
  requestBody?: {
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, { description?: string }>;
}

interface OpenApiSpec {
  info?: { title?: string; version?: string; description?: string };
  servers?: { url?: string }[];
  paths?: Record<string, Record<string, OpenApiOperation>>;
  tags?: { name?: string; description?: string }[];
}

// ─── Postman types (minimal) ─────────────────────────────────────────────────

interface PostmanHeader {
  key: string;
  value: string;
  description?: string;
  disabled?: boolean;
}
interface PostmanQueryParam {
  key: string;
  value: string;
  description?: string;
  disabled?: boolean;
}
interface PostmanVariable {
  id: string;
  key: string;
  value: string;
  type: string;
  description?: string;
}

interface PostmanRequest {
  name: string;
  request: {
    auth?: Record<string, unknown>;
    method: string;
    header: PostmanHeader[];
    url: { raw: string; host: string[]; path: string[]; query?: PostmanQueryParam[]; variable?: PostmanVariable[] };
    body?: Record<string, unknown>;
    description?: string;
  };
}

interface PostmanFolder {
  name: string;
  description?: string;
  item: PostmanRequest[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExampleValue(param: OpenApiParam): string {
  if (param.example !== undefined) return String(param.example);
  if (param.schema?.example !== undefined) return String(param.schema.example);
  if (param.schema?.enum?.length) return param.schema.enum[0];
  return "";
}

function resolveAuth(security: Record<string, string[]>[] | undefined): Record<string, unknown> | undefined {
  if (!security || security.length === 0) return { type: "noauth" };
  const key = Object.keys(security[0])[0] ?? "";
  if (key === "sessionCookie") {
    // Represent as bearer since cookie auth is not directly supported in Postman collection-level auth
    return { type: "bearer", bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }] };
  }
  if (key === "apiKeyBearer") {
    return { type: "bearer", bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }] };
  }
  if (key === "cronSecret") {
    return { type: "bearer", bearer: [{ key: "token", value: "{{cronSecret}}", type: "string" }] };
  }
  return { type: "noauth" };
}

function buildPostmanRequest(method: string, path: string, op: OpenApiOperation): PostmanRequest {
  const queryParams: PostmanQueryParam[] = [];
  const pathVars: PostmanVariable[] = [];
  const headers: PostmanHeader[] = [];

  // Extract path variables like {tenant}
  const pathVarMatches = path.match(/\{([^}]+)\}/g) ?? [];
  for (const match of pathVarMatches) {
    const varName = match.slice(1, -1);
    pathVars.push({ id: varName, key: varName, value: `{{${varName}}}`, type: "string" });
  }

  // Process parameters
  for (const param of op.parameters ?? []) {
    const val = getExampleValue(param);
    if (param.in === "query") {
      queryParams.push({ key: param.name, value: val, description: param.description });
    } else if (param.in === "header" && param.name.toLowerCase() !== "authorization") {
      headers.push({ key: param.name, value: val, description: param.description });
    }
    // path params already handled above; Authorization header handled via auth
  }

  // Build URL
  const cleanPath = path.replace(/\{([^}]+)\}/g, ":$1");
  const pathSegments = cleanPath.split("/").filter(Boolean);
  const rawUrl =
    queryParams.length > 0
      ? `{{baseUrl}}/${pathSegments.join("/")}?${queryParams.map((q) => `${q.key}=${q.value}`).join("&")}`
      : `{{baseUrl}}/${pathSegments.join("/")}`;

  const urlObject: PostmanRequest["request"]["url"] = {
    raw: rawUrl,
    host: ["{{baseUrl}}"],
    path: pathSegments,
  };
  if (queryParams.length > 0) urlObject.query = queryParams;
  if (pathVars.length > 0) urlObject.variable = pathVars;

  // Build body
  let body: Record<string, unknown> | undefined;
  if (op.requestBody?.content) {
    const contentTypes = Object.keys(op.requestBody.content);
    const contentType = contentTypes[0] ?? "application/json";

    if (contentType === "application/json") {
      const schema = op.requestBody.content[contentType]?.schema as Record<string, unknown> | undefined;
      const example = buildJsonExample(schema);
      body = { mode: "raw", raw: JSON.stringify(example, null, 2), options: { raw: { language: "json" } } };
      headers.push({ key: "Content-Type", value: "application/json" });
    } else if (contentType === "multipart/form-data") {
      const schema = op.requestBody.content[contentType]?.schema as
        | { properties?: Record<string, { type?: string; format?: string; description?: string }> }
        | undefined;
      const formdata = Object.entries(schema?.properties ?? {}).map(([k, v]) => ({
        key: k,
        value: v.format === "binary" ? "" : "",
        description: v.description ?? "",
        type: v.format === "binary" ? "file" : "text",
      }));
      body = { mode: "formdata", formdata };
    }
  }

  return {
    name: op.summary ?? `${method.toUpperCase()} ${path}`,
    request: {
      auth: resolveAuth(op.security),
      method: method.toUpperCase(),
      header: headers,
      url: urlObject,
      ...(body ? { body } : {}),
      description: op.description ?? "",
    },
  };
}

function buildJsonExample(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema) return {};
  const props = schema.properties as
    | Record<string, { type?: string; format?: string; example?: unknown; enum?: string[]; default?: unknown }>
    | undefined;
  if (!props) return {};
  const result: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.example !== undefined) {
      result[key] = prop.example;
    } else if (prop.default !== undefined) {
      result[key] = prop.default;
    } else if (prop.enum?.length) {
      result[key] = prop.enum[0];
    } else if (prop.type === "string") {
      result[key] =
        prop.format === "email"
          ? "user@example.com"
          : prop.format === "uri"
            ? "https://example.com"
            : prop.format === "date-time"
              ? "2026-01-01T00:00:00.000Z"
              : "";
    } else if (prop.type === "integer" || prop.type === "number") {
      result[key] = 0;
    } else if (prop.type === "boolean") {
      result[key] = false;
    } else if (prop.type === "array") {
      result[key] = [];
    }
  }
  return result;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function toPostmanCollection(rawSpec: unknown): Record<string, unknown> {
  const spec = rawSpec as OpenApiSpec;
  const baseUrl = spec.servers?.[0]?.url ?? "https://demo.fluxcrm.com";
  const title = spec.info?.title ?? "API Collection";
  const version = spec.info?.version ?? "1.0.0";

  // Group operations by their first tag
  const folders = new Map<string, PostmanFolder>();

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods) as [string, OpenApiOperation][]) {
      const tag = op.tags?.[0] ?? "General";
      if (!folders.has(tag)) {
        const tagDef = spec.tags?.find((t) => t.name === tag);
        folders.set(tag, { name: tag, description: tagDef?.description, item: [] });
      }
      const folder = folders.get(tag);
      if (folder) folder.item.push(buildPostmanRequest(method, path, op));
    }
  }

  return {
    info: {
      _postman_id: crypto.randomUUID(),
      name: `${title} v${version}`,
      description:
        spec.info?.description ??
        "Generated from the Flux CRM OpenAPI spec. Set {{baseUrl}}, {{apiKey}} and {{cronSecret}} in your Postman environment before running requests.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      _exporter_id: "flux-crm-api",
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }],
    },
    variable: [
      {
        id: "baseUrl",
        key: "baseUrl",
        value: baseUrl,
        type: "string",
        description: "Base URL — replace with your tenant subdomain (e.g. https://acme.fluxcrm.com)",
      },
      {
        id: "apiKey",
        key: "apiKey",
        value: "",
        type: "string",
        description: "Bearer token for session/import endpoints (IMPORT_API_KEY or leave empty and use cookies)",
      },
      {
        id: "cronSecret",
        key: "cronSecret",
        value: "",
        type: "string",
        description: "CRON_SECRET environment variable — required only for cron job endpoints",
      },
    ],
    item: Array.from(folders.values()),
  };
}

// OpenAPI 3.0.3 specification for Flux CRM API.
// The staff spec: internal routes written here, the public API generated from
// src/lib/api-docs/public-api.ts. Read by the Postman collection and /admin/api-docs/openapi.json.
import { publicApiPaths, publicApiTags } from "@/lib/api-docs/to-openapi";

const session = () => [{ sessionCookie: [] }, { apiKeyBearer: [] }];
const cronAuth = () => [{ cronSecret: [] }];
const pub = (): never[] => [];

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Flux CRM API",
    version: "1.0.0",
    description:
      "REST API reference for Flux CRM, staff edition: internal routes included. One domain for every workspace — the workspace is never read from the Host header. A browser request takes it from the session; a machine-to-machine request from the key: a workspace key (`flx2.<workspace>.<secret>`, Settings → API) names its workspace and carries its scopes, and only the platform `IMPORT_API_KEY` names one through `X-Tenant-ID`. Cron endpoints require `Authorization: Bearer $CRON_SECRET`. Public endpoints need no authentication.",
    contact: { name: "Flux CRM Support", email: "supporto@gsccomputers.it" },
  },
  // Relative: the spec describes the deployment that serves it.
  servers: [{ url: "/", description: "This deployment" }],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description: "NextAuth v5 session cookie — set automatically after login",
      },
      apiKeyBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API key",
        description:
          "Bearer token for machine-to-machine access. A **workspace key** (`flx2.<workspace>.<secret>`, made in Settings → API) names its workspace and carries its scopes; a header naming a different workspace is refused. The single key from before scopes (`flx_…`) writes everything and reads nothing. The global `IMPORT_API_KEY` is the **platform** key: it requires `X-Tenant-ID`, can name any workspace, and has the same powers as the old key — keep it out of per-customer integrations.",
      },
      cronSecret: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "CRON_SECRET",
        description: "Bearer token for cron job endpoints (`Authorization: Bearer <CRON_SECRET>`)",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string", description: "Human-readable error description" } },
        required: ["error"],
      },
      BulkSummary: {
        type: "object",
        properties: {
          total: { type: "integer" },
          created: { type: "integer" },
          updated: { type: "integer" },
          skipped: { type: "integer" },
          errors: { type: "integer" },
          durationMs: { type: "integer" },
        },
      },
    },
  },
  tags: [
    { name: "Contacts", description: "Contact import/export endpoints" },
    { name: "Companies", description: "Company import/export endpoints" },
    { name: "Leads", description: "Lead export endpoints" },
    { name: "Documents", description: "Document upload and management" },
    { name: "Search", description: "Global full-text search" },
    { name: "Notifications", description: "User notification polling" },
    { name: "Quotes", description: "Public quote viewer and acceptance" },
    { name: "Currency & Geo", description: "Exchange rates and geographic reference data" },
    { name: "Appointments", description: "RSVP handling for appointments" },
    { name: "Marketing Tracking", description: "Email click/open/unsubscribe tracking pixels" },
    { name: "Webhooks", description: "Inbound webhooks from Stripe and Resend" },
    { name: "Cron Jobs", description: "Scheduled internal jobs (protected by CRON_SECRET)" },
    ...publicApiTags(),
  ],
  paths: {
    // ─── Contacts ────────────────────────────────────────────────────────
    "/api/contacts/export": {
      get: {
        tags: ["Contacts"],
        operationId: "exportContacts",
        summary: "Export contacts as CSV",
        description:
          "Returns all contacts visible to the authenticated user as a CSV attachment. Admins and Owners see all contacts; Editors and Viewers see only their own.",
        security: session(),
        responses: {
          "200": {
            description: "CSV file (Content-Disposition: attachment)",
            content: {
              "text/csv": {
                schema: { type: "string" },
                example: 'id,firstName,lastName,email\n"cnt_01JX","Mario","Rossi","mario@example.com"',
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/contacts/import": {
      post: {
        tags: ["Contacts"],
        operationId: "importContacts",
        summary: "Import contacts from CSV",
        description:
          "Accepts a CSV file via `multipart/form-data` and imports contacts in bulk. Duplicates detected by email are skipped. Returns a summary of imported, skipped and errored rows.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary", description: "CSV file — `email` column required" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Import completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    imported: { type: "integer" },
                    skipped: { type: "integer" },
                    errors: { type: "array", items: { type: "string" } },
                  },
                },
                example: { imported: 42, skipped: 3, errors: [] },
              },
            },
          },
          "400": {
            description: "File missing or invalid CSV",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Companies ───────────────────────────────────────────────────────
    "/api/companies/export": {
      get: {
        tags: ["Companies"],
        operationId: "exportCompanies",
        summary: "Export companies as CSV",
        description: "Returns all companies in the organisation as a CSV attachment.",
        security: session(),
        responses: {
          "200": { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/companies/{id}/statement": {
      get: {
        tags: ["Companies"],
        operationId: "companyStatement",
        summary: "A customer's statement of account as CSV",
        description:
          "Every issued invoice, deposit invoice and credit note of the company and every payment received or refunded, in date order, with the balance after each, per currency. `from` and `to` (YYYY-MM-DD) limit the period; the first row of each currency is the opening balance. Headers follow the reader's language; Italian uses a semicolon and a decimal comma.",
        security: session(),
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date" } },
        ],
        responses: {
          "200": { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } },
          "400": {
            description: "A date that is not YYYY-MM-DD",
            content: { "text/plain": { schema: { type: "string" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "The caller may not export records, or the plan has no sales module",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": { description: "No such company", content: { "text/plain": { schema: { type: "string" } } } },
        },
      },
    },
    "/api/companies/import": {
      post: {
        tags: ["Companies"],
        operationId: "importCompanies",
        summary: "Import companies from CSV",
        description: "Accepts a CSV file and imports companies in bulk. Duplicates are detected by company name.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Import completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    imported: { type: "integer" },
                    skipped: { type: "integer" },
                    errors: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid file",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Leads ───────────────────────────────────────────────────────────
    "/api/leads/export": {
      get: {
        tags: ["Leads"],
        operationId: "exportLeads",
        summary: "Export leads as CSV",
        description: "Returns all leads visible to the authenticated user as a CSV attachment.",
        security: session(),
        responses: {
          "200": { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Documents ───────────────────────────────────────────────────────
    "/api/documents": {
      get: {
        tags: ["Documents"],
        operationId: "listDocuments",
        summary: "List documents for an entity",
        description: "Returns documents attached to a specific CRM entity, ordered by creation date.",
        security: session(),
        parameters: [
          {
            name: "entityType",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["contact", "lead", "company", "deal", "ticket"] },
            description: "CRM entity type",
            example: "contact",
          },
          {
            name: "entityId",
            in: "query",
            required: true,
            schema: { type: "string", maxLength: 128 },
            description: "Entity ID",
            example: "cnt_01JX4K",
          },
        ],
        responses: {
          "200": {
            description: "Document list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    documents: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string" },
                          mimeType: { type: "string" },
                          size: { type: "integer" },
                          entityType: { type: "string" },
                          entityId: { type: "string" },
                          ownerId: { type: "string" },
                          createdAt: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid entity type or ID",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      delete: {
        tags: ["Documents"],
        operationId: "deleteDocument",
        summary: "Delete a document",
        description:
          "Deletes a document by ID. Only the document owner can delete it. The file is also removed from disk.",
        security: session(),
        parameters: [
          {
            name: "id",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Document ID",
            example: "doc_02",
          },
        ],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": { schema: { type: "object", properties: { success: { type: "boolean" } } } },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Not the document owner",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Document not found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/documents/upload": {
      post: {
        tags: ["Documents"],
        operationId: "uploadDocument",
        summary: "Upload a document",
        description:
          "Uploads a file and associates it with a CRM entity. Max 10 MB. Allowed types: PDF, JPEG, PNG, GIF, WebP, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file", "entityType", "entityId"],
                properties: {
                  file: { type: "string", format: "binary", description: "File to upload (max 10 MB)" },
                  entityType: {
                    type: "string",
                    enum: ["contact", "lead", "company", "deal"],
                    description: "CRM entity type",
                  },
                  entityId: { type: "string", description: "Entity ID to attach the file to" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Upload completed",
            content: {
              "application/json": {
                schema: { type: "object", properties: { success: { type: "boolean" }, document: { type: "object" } } },
              },
            },
          },
          "400": {
            description: "Missing file or invalid params",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "403": {
            description: "Read-only member: attaching a file is a write",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "The record does not exist, or is not one the caller may see",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "413": {
            description: "File too large (max 10 MB)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "415": {
            description: "Unsupported MIME type",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Search ──────────────────────────────────────────────────────────
    "/api/search": {
      get: {
        tags: ["Search"],
        operationId: "globalSearch",
        summary: "Global search",
        description:
          "Case-insensitive search across contacts, leads, companies, deals, tickets, quotes and orders. Returns up to 5 results per type. Query must be at least 2 characters.",
        security: session(),
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 2 },
            description: "Search term (min 2 chars)",
            example: "Mario Rossi",
          },
        ],
        responses: {
          "200": {
            description: "Grouped results",
            content: {
              "application/json": { schema: { type: "object", properties: { results: { type: "object" } } } },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Notifications ───────────────────────────────────────────────────
    "/api/notifications": {
      get: {
        tags: ["Notifications"],
        operationId: "listNotifications",
        summary: "List user notifications",
        description:
          "Returns the last 50 notifications for the authenticated user, ordered newest first. Used by the NotificationCenter with 60-second polling.",
        security: session(),
        responses: {
          "200": {
            description: "Notification list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    notifications: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          type: { type: "string" },
                          title: { type: "string" },
                          body: { type: "string" },
                          read: { type: "boolean" },
                          createdAt: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Quotes (Public) ─────────────────────────────────────────────────
    "/api/quotes/public": {
      get: {
        tags: ["Quotes"],
        operationId: "getPublicQuote",
        summary: "Get quote by public token",
        description:
          "Returns the quote associated with the public token. If status is `sent`, it is automatically marked as `viewed` with timestamp and IP recorded.",
        security: pub(),
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Unique public quote token",
            example: "qt_pTkXz3mNR9aQv8",
          },
        ],
        responses: {
          "200": {
            description: "Quote with items, contact and company",
            content: { "application/json": { schema: { type: "object", properties: { quote: { type: "object" } } } } },
          },
          "400": {
            description: "Missing token",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": {
            description: "Quote not found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      post: {
        tags: ["Quotes"],
        operationId: "actionPublicQuote",
        summary: "Accept or decline a quote",
        description:
          "Allows a client to accept or decline a quote via public token. The quote must be in `sent` or `viewed` status.",
        security: pub(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "action"],
                properties: {
                  token: { type: "string", description: "Public quote token", example: "qt_pTkXz3mNR9aQv8" },
                  action: { type: "string", enum: ["accepted", "declined"], example: "accepted" },
                  reason: {
                    type: "string",
                    description: "Decline reason (only for `action: declined`)",
                    example: "Budget not available",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Action recorded",
            content: {
              "application/json": { schema: { type: "object", properties: { success: { type: "boolean" } } } },
            },
          },
          "400": {
            description: "Invalid token or action",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "409": {
            description: "Quote not in actionable status",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Currency & Geo ──────────────────────────────────────────────────
    "/api/currency/rates": {
      get: {
        tags: ["Currency & Geo"],
        operationId: "getCurrencyRates",
        summary: "EUR exchange rates",
        description:
          "Returns current exchange rates with EUR as base (sourced from Fawaz API, DB-cached 6h). Response is CDN-cached for 1 hour.",
        security: pub(),
        parameters: [
          {
            name: "X-Currency",
            in: "header",
            required: false,
            schema: { type: "string" },
            description: "ISO 4217 currency code to validate (e.g. USD)",
            example: "USD",
          },
        ],
        responses: {
          "200": {
            description: "Exchange rates (Cache-Control: public, s-maxage=3600)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    rates: { type: "object" },
                    baseCurrency: { type: "string" },
                    fetchedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Requested currency not found in rates",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "503": {
            description: "Exchange rate service unavailable",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      post: {
        tags: ["Currency & Geo"],
        operationId: "convertCurrency",
        summary: "Convert amount between currencies",
        description: "Converts an amount from one currency to another using current rates (EUR as pivot).",
        security: pub(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["amount", "from", "to"],
                properties: {
                  amount: { type: "number", example: 1000 },
                  from: { type: "string", example: "USD" },
                  to: { type: "string", example: "GBP" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Converted amount",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    amount: { type: "number" },
                    from: { type: "string" },
                    to: { type: "string" },
                    rate: { type: "number" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing params or unknown currency",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/geo/countries": {
      get: {
        tags: ["Currency & Geo"],
        operationId: "listCountries",
        summary: "List countries",
        description: "Returns the list of countries available in the system, used for address forms.",
        security: session(),
        responses: {
          "200": {
            description: "Array of countries",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { type: "object", properties: { code: { type: "string" }, name: { type: "string" } } },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/geo/cities": {
      get: {
        tags: ["Currency & Geo"],
        operationId: "listCities",
        summary: "List cities by country",
        description: "Returns cities for a specific country, used for address form autocomplete.",
        security: session(),
        parameters: [
          {
            name: "country",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "ISO 3166-1 alpha-2 country code",
            example: "IT",
          },
        ],
        responses: {
          "200": {
            description: "Array of cities",
            content: {
              "application/json": {
                schema: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ─── Appointments ────────────────────────────────────────────────────
    "/api/appointments/rsvp": {
      get: {
        tags: ["Appointments"],
        operationId: "rsvpAppointment",
        summary: "RSVP to an appointment",
        description:
          "Handles an attendee RSVP via email link. Updates the database and returns an HTML confirmation page. No auth required — the token acts as a secure one-time credential.",
        security: pub(),
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Unique RSVP token sent by email",
            example: "rsvp_abc123def456",
          },
          {
            name: "r",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["accept", "decline", "tentative"] },
            description: "Attendee response",
            example: "accept",
          },
        ],
        responses: {
          "200": {
            description: "Response recorded — HTML confirmation page (text/html)",
            content: { "text/html": { schema: { type: "string" } } },
          },
          "400": {
            description: "Invalid, expired token or unrecognised response — HTML error page",
            content: { "text/html": { schema: { type: "string" } } },
          },
        },
      },
    },

    // ─── Marketing Tracking ──────────────────────────────────────────────
    "/api/track/click": {
      get: {
        tags: ["Marketing Tracking"],
        operationId: "trackClick",
        summary: "Track email link click",
        description:
          "Records a click on a campaign email link and redirects the user to the destination URL. Only schema `http`/`https` URLs are accepted (open redirect protection).",
        security: pub(),
        parameters: [
          {
            name: "log",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Campaign log ID to update",
            example: "clog_01JX4K",
          },
          {
            name: "url",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Destination URL (URL-encoded, http/https only)",
            example: "https%3A%2F%2Facme.com%2Flanding",
          },
        ],
        responses: {
          "302": { description: "HTTP redirect to destination URL" },
          "400": {
            description: "Missing, invalid or disallowed URL",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/track/open": {
      get: {
        tags: ["Marketing Tracking"],
        operationId: "trackOpen",
        summary: "Track email open (pixel)",
        description:
          "Records an email open via a 1×1 tracking pixel. Returns a transparent GIF (43 bytes). First-open only.",
        security: pub(),
        parameters: [
          {
            name: "log",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Campaign log ID",
            example: "clog_01JX4K",
          },
        ],
        responses: {
          "200": {
            description: "1×1 transparent GIF (Content-Type: image/gif)",
            content: { "image/gif": { schema: { type: "string", format: "binary" } } },
          },
        },
      },
    },
    "/api/unsubscribe": {
      get: {
        tags: ["Marketing Tracking"],
        operationId: "unsubscribe",
        summary: "Unsubscribe from marketing",
        description:
          "Handles unsubscription via a secure token in the email. Sets `marketingConsent = false` and logs the event. Returns an HTML confirmation page.",
        security: pub(),
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Unique unsubscribe token",
            example: "unsub_xyz789abc",
          },
        ],
        responses: {
          "200": {
            description: "Unsubscribed — HTML confirmation (text/html)",
            content: { "text/html": { schema: { type: "string" } } },
          },
          "400": {
            description: "Invalid or already used token — HTML error page",
            content: { "text/html": { schema: { type: "string" } } },
          },
        },
      },
    },

    // ─── Webhooks ─────────────────────────────────────────────────────────
    "/api/webhooks/stripe": {
      post: {
        tags: ["Webhooks"],
        operationId: "webhookStripe",
        summary: "Stripe webhook",
        description:
          "Receives Stripe events and updates subscriptions in the database. Verifies HMAC signature via `STRIPE_WEBHOOK_SECRET`. Implements idempotency. Handles: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_succeeded`, `invoice.payment_failed`.",
        security: pub(),
        parameters: [
          {
            name: "stripe-signature",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Stripe HMAC signature header",
            example: "t=1715760000,v1=abc123...",
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", description: "Stripe event payload" } } },
        },
        responses: {
          "200": {
            description: "Event processed",
            content: {
              "application/json": { schema: { type: "object", properties: { received: { type: "boolean" } } } },
            },
          },
          "400": {
            description: "Invalid signature or malformed payload",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "500": {
            description: "Internal error — Stripe will retry for 7 days",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/webhooks/resend": {
      post: {
        tags: ["Webhooks"],
        operationId: "webhookResend",
        summary: "Resend email events webhook",
        description:
          "Receives delivery events from Resend (`email.sent`, `email.delivered`, `email.bounced`, `email.complained`) and updates campaign logs.",
        security: pub(),
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", description: "Resend event payload" } } },
        },
        responses: {
          "200": {
            description: "Event processed",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
          },
          "400": {
            description: "Invalid signature or payload",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/webhooks/email-inbound": {
      post: {
        tags: ["Webhooks"],
        operationId: "webhookEmailInbound",
        summary: "Inbound email webhook",
        description:
          "Receives inbound emails forwarded by Resend. Identifies the ticket from the `To` field (e.g. `ticket-TKT0042@reply.flux.io`) and appends the content as a ticket comment.",
        security: pub(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "array", items: { type: "string" } },
                  subject: { type: "string" },
                  text: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Email processed or intentionally skipped",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" }, skipped: { type: "boolean" } } },
              },
            },
          },
        },
      },
    },

    // ─── Cron Jobs ────────────────────────────────────────────────────────
    "/api/cron/campaign-scheduler": {
      get: {
        tags: ["Cron Jobs"],
        operationId: "cronCampaignScheduler",
        summary: "Campaign scheduler",
        description: "Checks for campaigns whose `scheduledAt` has passed and dispatches them. Runs every 5 minutes.",
        security: cronAuth(),
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Bearer $CRON_SECRET",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: {
          "200": {
            description: "Campaigns dispatched",
            content: {
              "application/json": { schema: { type: "object", properties: { dispatched: { type: "integer" } } } },
            },
          },
          "401": {
            description: "Invalid or missing secret",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/cron/email-worker": {
      get: {
        tags: ["Cron Jobs"],
        operationId: "cronEmailWorker",
        summary: "Email send worker",
        description:
          "Processes the email send queue (batch from campaigns). Sends pending messages via Resend and updates logs. Runs every minute.",
        security: cronAuth(),
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Bearer $CRON_SECRET",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: {
          "200": {
            description: "Worker completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sent: { type: "integer" },
                    failed: { type: "integer" },
                    remaining: { type: "integer" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/cron/task-reminders": {
      get: {
        tags: ["Cron Jobs"],
        operationId: "cronTaskReminders",
        summary: "Task due reminders",
        description: "Sends notifications for tasks due within 24 hours. Runs every hour.",
        security: cronAuth(),
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Bearer $CRON_SECRET",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: {
          "200": {
            description: "Reminders sent",
            content: {
              "application/json": { schema: { type: "object", properties: { notified: { type: "integer" } } } },
            },
          },
        },
      },
    },
    "/api/cron/ticket-autoclose": {
      get: {
        tags: ["Cron Jobs"],
        operationId: "cronTicketAutoclose",
        summary: "Auto-close resolved tickets",
        description:
          "Closes tickets in `resolved` status that have had no client reply for more than 7 days. Runs once daily.",
        security: cronAuth(),
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Bearer $CRON_SECRET",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: {
          "200": {
            description: "Tickets closed",
            content: {
              "application/json": { schema: { type: "object", properties: { closed: { type: "integer" } } } },
            },
          },
        },
      },
    },
    "/api/cron/ticket-sla-check": {
      get: {
        tags: ["Cron Jobs"],
        operationId: "cronTicketSlaCheck",
        summary: "Ticket SLA check",
        description:
          "Checks tickets about to breach (or already breaching) configured SLAs and alerts agents. Runs every 15 minutes.",
        security: cronAuth(),
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Bearer $CRON_SECRET",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: {
          "200": {
            description: "SLA check completed",
            content: {
              "application/json": {
                schema: { type: "object", properties: { breached: { type: "integer" }, warned: { type: "integer" } } },
              },
            },
          },
        },
      },
    },

    // ─── The public API: generated from src/lib/api-docs/public-api.ts, never written here ───
    ...publicApiPaths(),
  },
};

export type OpenApiSpec = typeof openApiSpec;

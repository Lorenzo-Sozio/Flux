// OpenAPI 3.0.3 specification for Flux CRM API.
// This is the source of truth for the Postman collection and the /admin/api-docs/openapi.json endpoint.

const session = () => [{ sessionCookie: [] }, { apiKeyBearer: [] }];
const cronAuth = () => [{ cronSecret: [] }];
const pub = (): never[] => [];

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Flux CRM API",
    version: "1.0.0",
    description:
      "REST API reference for Flux CRM. Multi-tenant: each request must be directed to the correct subdomain (e.g. `https://acme.fluxcrm.com/api/...`). The server resolves the tenant from the `Host` header automatically — no explicit tenant parameter needed. Session-based endpoints accept either the `authjs.session-token` cookie (browser) or a Bearer `IMPORT_API_KEY` header (machine-to-machine). Cron endpoints require `Authorization: Bearer $CRON_SECRET`. Public endpoints need no authentication.",
    contact: { name: "Flux CRM Support", email: "supporto@gsccomputers.it" },
  },
  servers: [
    {
      url: "https://{tenant}.fluxcrm.com",
      description: "Production (replace {tenant} with your organisation slug)",
      variables: { tenant: { default: "demo", description: "Your organisation subdomain" } },
    },
    {
      url: "http://{tenant}.localhost:3000",
      description: "Local development",
      variables: { tenant: { default: "demo", description: "Your organisation subdomain" } },
    },
  ],
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
        bearerFormat: "IMPORT_API_KEY",
        description: "Bearer token for machine-to-machine access (`Authorization: Bearer <IMPORT_API_KEY>`)",
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
    { name: "CRM Import API", description: "Programmatic import of CRM records via REST" },
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

    // ─── CRM Import API ──────────────────────────────────────────────────
    "/api/crm/leads": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createLead",
        summary: "Create a lead",
        description:
          "Creates a single lead with full validation. Deduplication by email (case-insensitive). With `onDuplicate: skip` (default) returns `skipped`; with `update` updates the existing record; with `error` returns HTTP 409.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["firstName", "lastName"],
                properties: {
                  firstName: { type: "string", example: "Anna" },
                  lastName: { type: "string", example: "Bianchi" },
                  email: { type: "string", format: "email", example: "anna@startup.io" },
                  phone: { type: "string", example: "+39 02 1234567" },
                  mobile: { type: "string" },
                  companyName: { type: "string", example: "StartupIO" },
                  jobTitle: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["new", "contacting", "qualified", "unqualified", "converted"],
                    example: "new",
                  },
                  source: { type: "string", example: "website" },
                  rating: { type: "string", enum: ["hot", "warm", "cold"] },
                  notes: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                  onDuplicate: { type: "string", enum: ["skip", "update", "error"], default: "skip" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Lead created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string" }, id: { type: "string" }, data: { type: "object" } },
                },
              },
            },
          },
          "200": {
            description: "Lead skipped or updated",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "409": {
            description: "Duplicate (onDuplicate: error)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/leads/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateLeads",
        summary: "Bulk import leads",
        description: "Imports up to 500 leads in a single request. Same fields as the single endpoint.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: {
                  records: {
                    type: "array",
                    maxItems: 500,
                    items: { type: "object" },
                    description: "Array of lead objects (max 500)",
                  },
                  onDuplicate: { type: "string", enum: ["skip", "update", "error"], default: "skip" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
                },
              },
            },
          },
          "400": {
            description: "records missing, empty or >500 items",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/contacts": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createContact",
        summary: "Create a contact",
        description: "Creates a single contact. Deduplication by email. Supports `onDuplicate: skip | update | error`.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["firstName", "lastName"],
                properties: {
                  firstName: { type: "string", example: "Mario" },
                  lastName: { type: "string", example: "Rossi" },
                  email: { type: "string", format: "email", example: "mario@acme.it" },
                  phone: { type: "string" },
                  mobile: { type: "string" },
                  jobTitle: { type: "string" },
                  companyId: { type: "string", description: "Existing company ID to link", example: "cmp_01JX" },
                  status: { type: "string", enum: ["active", "inactive", "lead"] },
                  source: { type: "string" },
                  leadScore: { type: "integer", minimum: 0, maximum: 100 },
                  tags: { type: "array", items: { type: "string" } },
                  onDuplicate: { type: "string", enum: ["skip", "update", "error"], default: "skip" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Contact created", content: { "application/json": { schema: { type: "object" } } } },
          "200": {
            description: "Contact skipped or updated",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/contacts/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateContacts",
        summary: "Bulk import contacts",
        description: "Imports up to 500 contacts. Deduplication by email.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: {
                  records: { type: "array", maxItems: 500, items: { type: "object" } },
                  onDuplicate: { type: "string", enum: ["skip", "update", "error"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
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
    "/api/crm/companies": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createCompany",
        summary: "Create a company",
        description:
          "Creates a single company. Deduplication by name (case-insensitive). Supports `onDuplicate: skip | update | error`.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", example: "Acme Srl" },
                  industry: { type: "string", example: "Manufacturing" },
                  website: { type: "string", format: "uri", example: "https://acme.it" },
                  type: { type: "string", enum: ["prospect", "customer", "partner", "vendor"], example: "prospect" },
                  employeeCount: { type: "integer", example: 250 },
                  annualRevenue: { type: "string", example: "5000000.00" },
                  mainPhone: { type: "string", example: "+39 02 9876543" },
                  mainEmail: { type: "string", format: "email", example: "info@acme.it" },
                  vatNumber: { type: "string", example: "IT02345678901" },
                  sdiCode: { type: "string", example: "XXXXXXX" },
                  tags: { type: "array", items: { type: "string" } },
                  onDuplicate: { type: "string", enum: ["skip", "update", "error"], default: "skip" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Company created", content: { "application/json": { schema: { type: "object" } } } },
          "200": {
            description: "Company skipped or updated",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/companies/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateCompanies",
        summary: "Bulk import companies",
        description: "Imports up to 500 companies. Deduplication by name.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: {
                  records: { type: "array", maxItems: 500, items: { type: "object" } },
                  onDuplicate: { type: "string", enum: ["skip", "update", "error"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
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
    "/api/crm/activities": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createActivity",
        summary: "Create an activity",
        description:
          "Creates a single activity (note, call, meeting, email) linked to at least one CRM entity. Activities are not deduplicated.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["note", "call", "meeting", "email"], example: "call" },
                  content: { type: "string", maxLength: 5000, example: "Product presentation call" },
                  date: { type: "string", format: "date-time", example: "2026-05-15T14:30:00.000Z" },
                  durationMinutes: { type: "integer", example: 45 },
                  participants: { type: "string", example: "mario@acme.it" },
                  leadId: { type: "string", example: "lead_01JX" },
                  contactId: { type: "string", example: "cnt_01JX" },
                  companyId: { type: "string", example: "cmp_01JX" },
                  dealId: { type: "string", example: "deal_01JX" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Activity created", content: { "application/json": { schema: { type: "object" } } } },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error (e.g. no entity linked)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/activities/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateActivities",
        summary: "Bulk import activities",
        description:
          "Imports up to 500 activities. Activities are never deduplicated — every valid record always creates a new DB row.",
        security: session(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: { records: { type: "array", maxItems: 500, items: { type: "object" } } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
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

    // ─── Entity-scoped Activity Endpoints ────────────────────────────────
    "/api/crm/leads/{leadId}/activities": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createLeadActivity",
        summary: "Add activity to a lead",
        description:
          "Creates a single activity linked to the specified lead. The `leadId` is taken from the URL — no need to include it in the request body. Additional entity links (contactId, companyId, dealId) may be provided in the body.",
        security: session(),
        parameters: [
          {
            name: "leadId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Lead ID",
            example: "lead_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["note", "call", "meeting", "email"], example: "note" },
                  content: { type: "string", maxLength: 5000, example: "Primo contatto via email" },
                  date: { type: "string", format: "date-time", example: "2026-05-15T10:00:00.000Z" },
                  durationMinutes: { type: "integer", example: 30 },
                  participants: { type: "string", example: "anna@startup.io" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Activity created", content: { "application/json": { schema: { type: "object" } } } },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/leads/{leadId}/activities/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateLeadActivities",
        summary: "Bulk import activities for a lead",
        description:
          "Imports up to 500 activities all linked to the specified lead. The `leadId` from the URL is automatically injected into every record.",
        security: session(),
        parameters: [
          {
            name: "leadId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Lead ID",
            example: "lead_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: { records: { type: "array", maxItems: 500, items: { type: "object" } } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
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
    "/api/crm/contacts/{contactId}/activities": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createContactActivity",
        summary: "Add activity to a contact",
        description:
          "Creates a single activity linked to the specified contact. The `contactId` is taken from the URL — no need to include it in the request body.",
        security: session(),
        parameters: [
          {
            name: "contactId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Contact ID",
            example: "cnt_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["note", "call", "meeting", "email"], example: "call" },
                  content: { type: "string", maxLength: 5000, example: "Chiamata di follow-up" },
                  date: { type: "string", format: "date-time", example: "2026-05-15T14:30:00.000Z" },
                  durationMinutes: { type: "integer", example: 45 },
                  participants: { type: "string", example: "mario@acme.it" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Activity created", content: { "application/json": { schema: { type: "object" } } } },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/contacts/{contactId}/activities/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateContactActivities",
        summary: "Bulk import activities for a contact",
        description:
          "Imports up to 500 activities all linked to the specified contact. The `contactId` from the URL is automatically injected into every record.",
        security: session(),
        parameters: [
          {
            name: "contactId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Contact ID",
            example: "cnt_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: { records: { type: "array", maxItems: 500, items: { type: "object" } } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
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
    "/api/crm/companies/{companyId}/activities": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createCompanyActivity",
        summary: "Add activity to a company",
        description:
          "Creates a single activity linked to the specified company. The `companyId` is taken from the URL — no need to include it in the request body.",
        security: session(),
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Company ID",
            example: "cmp_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["note", "call", "meeting", "email"], example: "meeting" },
                  content: { type: "string", maxLength: 5000, example: "Riunione con il team acquisti" },
                  date: { type: "string", format: "date-time", example: "2026-05-20T09:00:00.000Z" },
                  durationMinutes: { type: "integer", example: 60 },
                  participants: { type: "string", example: "info@acme.it" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Activity created", content: { "application/json": { schema: { type: "object" } } } },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/companies/{companyId}/activities/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateCompanyActivities",
        summary: "Bulk import activities for a company",
        description:
          "Imports up to 500 activities all linked to the specified company. The `companyId` from the URL is automatically injected into every record.",
        security: session(),
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Company ID",
            example: "cmp_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: { records: { type: "array", maxItems: 500, items: { type: "object" } } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
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
    "/api/crm/deals/{dealId}/activities": {
      post: {
        tags: ["CRM Import API"],
        operationId: "createDealActivity",
        summary: "Add activity to a deal",
        description:
          "Creates a single activity linked to the specified deal. The `dealId` is taken from the URL — no need to include it in the request body.",
        security: session(),
        parameters: [
          {
            name: "dealId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Deal ID",
            example: "deal_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["note", "call", "meeting", "email"], example: "note" },
                  content: { type: "string", maxLength: 5000, example: "Proposta inviata, in attesa di feedback" },
                  date: { type: "string", format: "date-time", example: "2026-05-18T16:00:00.000Z" },
                  durationMinutes: { type: "integer", example: 20 },
                  participants: { type: "string", example: "giulia@beta.it" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Activity created", content: { "application/json": { schema: { type: "object" } } } },
          "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "422": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/crm/deals/{dealId}/activities/bulk": {
      post: {
        tags: ["CRM Import API"],
        operationId: "bulkCreateDealActivities",
        summary: "Bulk import activities for a deal",
        description:
          "Imports up to 500 activities all linked to the specified deal. The `dealId` from the URL is automatically injected into every record.",
        security: session(),
        parameters: [
          {
            name: "dealId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Deal ID",
            example: "deal_01JX",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["records"],
                properties: { records: { type: "array", maxItems: 500, items: { type: "object" } } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processing completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { summary: { $ref: "#/components/schemas/BulkSummary" }, results: { type: "array" } },
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
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;

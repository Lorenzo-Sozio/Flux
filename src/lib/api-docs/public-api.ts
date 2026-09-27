/**
 * The public API's documentation: what an integrator calls, one entry per operation.
 *
 * ⚠️⚠️ **The only place it is written.** The staff reference at /admin/api-docs, the public
 * reference at /developers and `/api/openapi.json` all read these entries; the English spec
 * that used to describe the same routes a second time, and disagreed with this one, is gone.
 * `src/lib/docs-alignment.test.ts` holds them to the routes — every method, every path,
 * every scope — so a route cannot change without its entry saying so.
 */
import type React from "react";

import { Terminal, Zap } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AuthLevel = "public" | "session" | "admin" | "cron";

export interface Param {
  name: string;
  in: "query" | "path" | "body" | "form" | "header";
  required: boolean;
  type: string;
  description: string;
  example?: string;
  enum?: string[];
}

export interface ApiEndpoint {
  id: string;
  method: Method;
  path: string;
  summary: string;
  description: string;
  auth: AuthLevel;
  /** For `/api/crm`: the scope a key must hold (src/lib/api-scopes.ts); checked against the route. */
  scope?: string;
  parameters?: Param[];
  requestBody?: { contentType: string; example: string };
  responses: Array<{ status: number; description: string; example: string }>;
}

export interface ApiGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  description: string;
  isInfoOnly?: boolean;
  endpoints: ApiEndpoint[];
}

// ─── Errori comuni ─────────────────────────────────────────────────────────────

/**
 * The responses **every** route under /api/crm can return.
 *
 * ⚠️ Merged at render time rather than copied into each of the eighteen entries,
 * because copying is exactly how drift starts: one entry's text is updated and the others
 * are not, and whoever reads the wrong one discovers the real behaviour at runtime. None
 * of these was documented anywhere, so a 429 halfway through an import arrived with no
 * preavviso.
 */
export const CRM_COMMON_RESPONSES: ApiEndpoint["responses"] = [
  {
    status: 400,
    description: "Manca il contesto del workspace, oppure il corpo non è JSON valido",
    example: JSON.stringify(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      null,
      2,
    ),
  },
  {
    status: 401,
    description: "Credenziale assente o non valida, o X-Tenant-ID in disaccordo con la chiave usata",
    example: JSON.stringify({ error: "Unauthorized" }, null, 2),
  },
  {
    status: 403,
    description:
      "La chiave è valida ma non copre questa richiesta: `scope` dice quale ambito manca (per esempio `contacts:read`). Si aggiunge da Impostazioni → API, creando una chiave che lo includa",
    example: JSON.stringify({ error: "This API key does not cover this request.", scope: "contacts:read" }, null, 2),
  },
  {
    status: 404,
    description: "Il workspace indicato non esiste nel registro",
    example: JSON.stringify({ error: "Tenant not found" }, null, 2),
  },
  {
    status: 422,
    description: "JSON valido ma dati rifiutati: `errors` elenca ogni campo che non va",
    example: JSON.stringify(
      { error: "Validation failed", errors: [{ field: "email", message: "Invalid email address" }] },
      null,
      2,
    ),
  },
  {
    status: 429,
    description: "Superato il limite di chiamate del piano per questo mese",
    example: JSON.stringify({ error: "Monthly API call limit reached for your plan." }, null, 2),
  },
];

/**
 * Every route that accepts `Idempotency-Key`.
 *
 * ⚠️ Generated from the routes that actually call `claim`, and checked against
 * them by `src/lib/docs-alignment.test.ts`. A list like this kept by hand is a
 * list that quietly stops matching the code, and the failure is a status an
 * integrator meets for the first time halfway through an import.
 *
 * The ones deliberately absent are the ones a repeat cannot hurt: closing a deal
 * that is already closed, an opt-out, an erasure.
 */
export const IDEMPOTENT_PATHS = [
  "/api/crm/quotes",
  "/api/crm/activities/bulk",
  "/api/crm/activities",
  "/api/crm/companies/{companyId}/activities/bulk",
  "/api/crm/companies/{companyId}/activities",
  "/api/crm/companies/bulk",
  "/api/crm/companies",
  "/api/crm/contacts/{contactId}/activities/bulk",
  "/api/crm/contacts/{contactId}/activities",
  "/api/crm/contacts/bulk",
  "/api/crm/contacts",
  "/api/crm/deals/{dealId}/activities/bulk",
  "/api/crm/deals/{dealId}/activities",
  "/api/crm/leads/{leadId}/activities/bulk",
  "/api/crm/leads/{leadId}/activities",
  "/api/crm/leads/bulk",
  "/api/crm/leads",
  "/api/crm/notes",
  "/api/crm/orders",
] as const;

/**
 * The two answers a route gives about `Idempotency-Key` itself.
 *
 * ⚠️ A bulk request reports a rejected row inside a 200, row by row — that is the
 * whole design, and it is why the ordinary validation 422 is kept off those
 * endpoints. But a key reused with a different body has to be refused, and the
 * status for that is 422 as well. Same code, entirely different meaning, so it
 * carries its own description here rather than inheriting the common one.
 */
export const IDEMPOTENCY_RESPONSES: ApiEndpoint["responses"] = [
  {
    status: 409,
    description:
      "Una richiesta con lo stesso `Idempotency-Key` è ancora in corso. Riprova fra poco: non è stato importato niente due volte.",
    example: JSON.stringify(
      { error: "A request with this Idempotency-Key is still running. Retry in a moment." },
      null,
      2,
    ),
  },
  {
    status: 422,
    description:
      "⚠️ Lo stesso `Idempotency-Key` era già stato usato con un corpo diverso. Non è un errore di validazione delle righe: quelle tornano dentro un 200. Usa una chiave nuova per una richiesta nuova.",
    example: JSON.stringify({ error: "This Idempotency-Key was already used with a different request body." }, null, 2),
  },
];

/**
 * The responses common to every route guarded by `CRON_SECRET`.
 *
 * ⚠️ The 500 is not theoretical: with `CRON_SECRET` unset on the server every job
 * answers 500 for ever and none of them run. Worth knowing in advance.
 */
export const CRON_COMMON_RESPONSES: ApiEndpoint["responses"] = [
  {
    status: 401,
    description: "Header Authorization assente o segreto sbagliato",
    example: JSON.stringify({ error: "Unauthorized" }, null, 2),
  },
  {
    status: 500,
    description: "⚠️ `CRON_SECRET` non è configurato sul server: nessun job può girare finché non lo è",
    example: JSON.stringify({ error: "CRON_SECRET is not configured on this server." }, null, 2),
  },
];

/**
 * An entry's declared responses, plus whichever common ones it does not already have.
 *
 * ⚠️ A bulk variant does not return the *validation* 422. A rejected row does not fail
 * the request: the answer is 200 and the reason sits inside `results`, row by row.
 * Documenting that 422 on them would send an integrator looking for a status code
 * that never arrives, instead of inside the body where it actually is.
 *
 * A route that accepts `Idempotency-Key` also answers 409, and 422 for a key
 * reused with a different body. Those come from `IDEMPOTENCY_RESPONSES` above,
 * with their own wording.
 */
export function responsesFor(endpoint: ApiEndpoint): ApiEndpoint["responses"] {
  const isCrm = endpoint.path.startsWith("/api/crm/");
  const isCron = endpoint.path.startsWith("/api/cron/");
  if (!isCrm && !isCron) return endpoint.responses;

  // ⚠️ Opt-out and erasure are not metered against the plan and therefore never answer
  // 429. That is a choice: refusing an opt-out because the plan is
  // esaurito significa continuare a contattare chi ha chiesto di smettere, e
  // refusing an erasure means missing a deadline that is not ours to move. Neither is a
  // billing decision.
  const UNMETERED = ["/api/crm/opt-out", "/api/crm/erasure"];

  const isBulk = endpoint.path.endsWith("/bulk");
  // A read validates no body: its mistakes are a 400 naming the parameter, never a 422.
  const isRead = endpoint.method === "GET";
  const isIdempotent = (IDEMPOTENT_PATHS as readonly string[]).includes(endpoint.path);
  const common = isCron
    ? CRON_COMMON_RESPONSES
    : [
        ...CRM_COMMON_RESPONSES.filter(
          (r) => !((isBulk || isRead) && r.status === 422) && !(UNMETERED.includes(endpoint.path) && r.status === 429),
        ),
        ...(isIdempotent ? IDEMPOTENCY_RESPONSES : []),
      ];

  const declared = new Set(endpoint.responses.map((r) => r.status));
  return [...endpoint.responses, ...common.filter((r) => !declared.has(r.status))].sort((a, b) => a.status - b.status);
}

// ─── The public API ─────────────────────────────────────────────────────────────

export const PUBLIC_API_GROUPS: ApiGroup[] = [
  {
    id: "crm-read",
    label: "CRM Read API",
    icon: Terminal,
    color: "text-sky-600",
    bg: "bg-sky-50",
    border: "border-sky-200",
    description:
      "Lettura di contatti, lead, aziende, trattative e ordini, per riconciliare ciò che un'integrazione ha con ciò che il CRM contiene.\n\n" +
      "⚠️ **Ambiti.** Ogni chiave dice cosa può fare, entità per entità (`contacts:read`, `orders:write`…), e si crea da Impostazioni → API. Scrivere non implica leggere: una chiave creata prima degli ambiti continua a scrivere tutto e non legge niente. Un ambito mancante è un 403 che lo nomina. Con la sessione vale il ruolo nel workspace: anche chi è in sola lettura può leggere.\n\n" +
      "Le pagine sono ordinate per ultima modifica e poi per id, e `nextCursor` riprende esattamente dopo l'ultimo record ricevuto, anche se molti record hanno la stessa data di modifica.",
    endpoints: [
      {
        id: "openapi-public",
        method: "GET",
        path: "/api/openapi.json",
        summary: "Questa documentazione, in OpenAPI 3",
        description:
          "La stessa documentazione di questa pagina, generata dalle stesse voci, per chi preferisce importarla in un client HTTP o generare un SDK. Ogni operazione porta il proprio ambito in `x-scope`. Senza autenticazione: descrive cosa può fare una chiave, non apre niente.",
        auth: "public",
        responses: [
          {
            status: 200,
            description: "Il documento OpenAPI",
            example: JSON.stringify({ openapi: "3.0.3", info: { title: "Flux CRM API" }, paths: {} }, null, 2),
          },
        ],
      },
      {
        id: "crm-contacts-list",
        method: "GET",
        path: "/api/crm/contacts",
        summary: "Elenca i contatti",
        description:
          "Una pagina di i contatti, dalla modifica più vecchia alla più recente. Per riconciliare: la prima volta senza parametri, poi ripetere con `cursor` finché `nextCursor` è null; le volte successive partire da `updatedSince` con la data dell'ultima sincronizzazione. Un record eliminato non compare: lo dicono i webhook `*.deleted`. Richiede l'ambito `contacts:read`; le chiavi create prima degli ambiti non leggono.",
        auth: "session",
        scope: "contacts:read",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            type: "number",
            description: "Quanti record per pagina, da 1 a 200. Predefinito 50.",
            example: "100",
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            type: "string",
            description: "Il `nextCursor` della pagina precedente, così com'è.",
            example: "WyIyMDI2LTA5LTIwIDEwOjAwOjAwLjEyMzQ1NiIsIjEyMyJd",
          },
          {
            name: "updatedSince",
            in: "query",
            required: false,
            type: "string",
            description: "Solo i record modificati da questo momento in poi (ISO 8601).",
            example: "2026-09-01T00:00:00Z",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Una pagina",
            example: JSON.stringify(
              {
                data: [
                  {
                    id: "c1",
                    firstName: "Anna",
                    lastName: "Rossi",
                    email: "anna@example.com",
                    companyId: "co1",
                    updatedAt: "2026-09-20T10:00:00.123Z",
                  },
                ],
                nextCursor: null,
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Parametro non valido: `field` dice quale",
            example: JSON.stringify({ error: "limit must be a whole number from 1 to 200", field: "limit" }, null, 2),
          },
        ],
      },
      {
        id: "crm-leads-list",
        method: "GET",
        path: "/api/crm/leads",
        summary: "Elenca i lead",
        description:
          "Una pagina di i lead, dalla modifica più vecchia alla più recente. Per riconciliare: la prima volta senza parametri, poi ripetere con `cursor` finché `nextCursor` è null; le volte successive partire da `updatedSince` con la data dell'ultima sincronizzazione. Un record eliminato non compare: lo dicono i webhook `*.deleted`. Richiede l'ambito `leads:read`; le chiavi create prima degli ambiti non leggono.",
        auth: "session",
        scope: "leads:read",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            type: "number",
            description: "Quanti record per pagina, da 1 a 200. Predefinito 50.",
            example: "100",
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            type: "string",
            description: "Il `nextCursor` della pagina precedente, così com'è.",
            example: "WyIyMDI2LTA5LTIwIDEwOjAwOjAwLjEyMzQ1NiIsIjEyMyJd",
          },
          {
            name: "updatedSince",
            in: "query",
            required: false,
            type: "string",
            description: "Solo i record modificati da questo momento in poi (ISO 8601).",
            example: "2026-09-01T00:00:00Z",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Una pagina",
            example: JSON.stringify(
              {
                data: [
                  {
                    id: "l1",
                    firstName: "Paolo",
                    email: "paolo@example.com",
                    status: "new",
                    isConverted: false,
                    updatedAt: "2026-09-20T10:00:00.123Z",
                  },
                ],
                nextCursor: null,
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Parametro non valido: `field` dice quale",
            example: JSON.stringify({ error: "limit must be a whole number from 1 to 200", field: "limit" }, null, 2),
          },
        ],
      },
      {
        id: "crm-companies-list",
        method: "GET",
        path: "/api/crm/companies",
        summary: "Elenca le aziende",
        description:
          "Una pagina di le aziende, dalla modifica più vecchia alla più recente. Per riconciliare: la prima volta senza parametri, poi ripetere con `cursor` finché `nextCursor` è null; le volte successive partire da `updatedSince` con la data dell'ultima sincronizzazione. Un record eliminato non compare: lo dicono i webhook `*.deleted`. Richiede l'ambito `companies:read`; le chiavi create prima degli ambiti non leggono.",
        auth: "session",
        scope: "companies:read",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            type: "number",
            description: "Quanti record per pagina, da 1 a 200. Predefinito 50.",
            example: "100",
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            type: "string",
            description: "Il `nextCursor` della pagina precedente, così com'è.",
            example: "WyIyMDI2LTA5LTIwIDEwOjAwOjAwLjEyMzQ1NiIsIjEyMyJd",
          },
          {
            name: "updatedSince",
            in: "query",
            required: false,
            type: "string",
            description: "Solo i record modificati da questo momento in poi (ISO 8601).",
            example: "2026-09-01T00:00:00Z",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Una pagina",
            example: JSON.stringify(
              {
                data: [
                  { id: "co1", name: "Acme S.r.l.", vatNumber: "IT01234567890", updatedAt: "2026-09-20T10:00:00.123Z" },
                ],
                nextCursor: null,
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Parametro non valido: `field` dice quale",
            example: JSON.stringify({ error: "limit must be a whole number from 1 to 200", field: "limit" }, null, 2),
          },
        ],
      },
      {
        id: "crm-deals-list",
        method: "GET",
        path: "/api/crm/deals",
        summary: "Elenca le trattative",
        description:
          "Una pagina di le trattative, dalla modifica più vecchia alla più recente. Per riconciliare: la prima volta senza parametri, poi ripetere con `cursor` finché `nextCursor` è null; le volte successive partire da `updatedSince` con la data dell'ultima sincronizzazione. Un record eliminato non compare: lo dicono i webhook `*.deleted`. Richiede l'ambito `deals:read`; le chiavi create prima degli ambiti non leggono.",
        auth: "session",
        scope: "deals:read",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            type: "number",
            description: "Quanti record per pagina, da 1 a 200. Predefinito 50.",
            example: "100",
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            type: "string",
            description: "Il `nextCursor` della pagina precedente, così com'è.",
            example: "WyIyMDI2LTA5LTIwIDEwOjAwOjAwLjEyMzQ1NiIsIjEyMyJd",
          },
          {
            name: "updatedSince",
            in: "query",
            required: false,
            type: "string",
            description: "Solo i record modificati da questo momento in poi (ISO 8601).",
            example: "2026-09-01T00:00:00Z",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Una pagina",
            example: JSON.stringify(
              {
                data: [
                  {
                    id: "d1",
                    name: "Rinnovo 2027",
                    amount: 12000,
                    status: "open",
                    stageId: "s2",
                    stageName: "Proposta",
                    updatedAt: "2026-09-20T10:00:00.123Z",
                  },
                ],
                nextCursor: null,
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Parametro non valido: `field` dice quale",
            example: JSON.stringify({ error: "limit must be a whole number from 1 to 200", field: "limit" }, null, 2),
          },
        ],
      },
      {
        id: "crm-orders-list",
        method: "GET",
        path: "/api/crm/orders",
        summary: "Elenca gli ordini",
        description:
          "Una pagina di gli ordini, dalla modifica più vecchia alla più recente. Per riconciliare: la prima volta senza parametri, poi ripetere con `cursor` finché `nextCursor` è null; le volte successive partire da `updatedSince` con la data dell'ultima sincronizzazione. Un record eliminato non compare: lo dicono i webhook `*.deleted`. Richiede l'ambito `orders:read`; le chiavi create prima degli ambiti non leggono.",
        auth: "session",
        scope: "orders:read",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            type: "number",
            description: "Quanti record per pagina, da 1 a 200. Predefinito 50.",
            example: "100",
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            type: "string",
            description: "Il `nextCursor` della pagina precedente, così com'è.",
            example: "WyIyMDI2LTA5LTIwIDEwOjAwOjAwLjEyMzQ1NiIsIjEyMyJd",
          },
          {
            name: "updatedSince",
            in: "query",
            required: false,
            type: "string",
            description: "Solo i record modificati da questo momento in poi (ISO 8601).",
            example: "2026-09-01T00:00:00Z",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Una pagina",
            example: JSON.stringify(
              {
                data: [
                  {
                    id: "o1",
                    orderNumber: "ORD-2026-0042",
                    status: "confirmed",
                    totalAmount: 1220,
                    currency: "EUR",
                    updatedAt: "2026-09-20T10:00:00.123Z",
                  },
                ],
                nextCursor: null,
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Parametro non valido: `field` dice quale",
            example: JSON.stringify({ error: "limit must be a whole number from 1 to 200", field: "limit" }, null, 2),
          },
        ],
      },
      {
        id: "crm-products-list",
        method: "GET",
        path: "/api/crm/products",
        summary: "Elenca i prodotti, con il prezzo di un cliente",
        description:
          "Il catalogo, una pagina alla volta come le altre letture (`limit`, `cursor`, `updatedSince`). Con `companyId` ogni prodotto porta anche `customerPrice`, ciò che quel cliente paga secondo il suo listino, e `priceSource`: `base` (prezzo di catalogo), `percent` (la percentuale del listino) o `override` (un prezzo scritto per quel prodotto). È la stessa regola del modulo del commerciale: ciò che un assistente propone è ciò che il preventivo dirà. Un listino spento non vale per nessuno.",
        auth: "session",
        scope: "products:read",
        parameters: [
          {
            name: "companyId",
            in: "query",
            required: false,
            type: "string",
            description: "L'azienda di cui calcolare i prezzi.",
            example: "co1",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            type: "number",
            description: "Da 1 a 200. Predefinito 50.",
            example: "100",
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            type: "string",
            description: "Il `nextCursor` della pagina precedente.",
            example: "WyIyMDI2LTA5LTIwIDEwOjAwOjAwIiwicDEiXQ",
          },
          {
            name: "updatedSince",
            in: "query",
            required: false,
            type: "string",
            description: "Solo i prodotti modificati da questo momento (ISO 8601).",
            example: "2026-09-01T00:00:00Z",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Una pagina",
            example: JSON.stringify(
              {
                data: [
                  {
                    id: "p1",
                    sku: "PIZ-MAR",
                    name: "Margherita",
                    price: 7,
                    taxPercent: 10,
                    isActive: true,
                    customerPrice: 6.3,
                    priceSource: "percent",
                    priceListId: "pl1",
                    updatedAt: "2026-09-20T10:00:00.000Z",
                  },
                ],
                nextCursor: null,
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Parametro non valido, o nessuna azienda con quell'id: `field` dice quale",
            example: JSON.stringify({ error: "No company with that id", field: "companyId" }, null, 2),
          },
        ],
      },
      {
        id: "crm-pipelines-list",
        method: "GET",
        path: "/api/crm/pipelines",
        summary: "Le pipeline e le loro fasi",
        description:
          "Ogni pipeline con le fasi in ordine di board; ogni fase ha `kind` (`open`, `won`, `lost`), la probabilità predefinita e dopo quanti giorni una trattativa ferma lì è «in stallo». Serve a spostare un record nella fase che *questa* azienda usa, invece di una parola scritta nel codice dell'integrazione. Non paginato.",
        auth: "session",
        scope: "deals:read",
        responses: [
          {
            status: 200,
            description: "Le pipeline",
            example: JSON.stringify(
              {
                data: [
                  {
                    id: "default",
                    name: "Vendite",
                    order: 0,
                    stages: [
                      { id: "s1", name: "Qualificato", order: 1, probability: 20, staleAfterDays: 14, kind: "open" },
                      { id: "won", name: "Vinta", order: 9, probability: 100, staleAfterDays: null, kind: "won" },
                    ],
                  },
                ],
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  },
  {
    id: "crm-import",
    label: "CRM Import API",
    icon: Terminal,
    color: "text-teal-600",
    bg: "bg-teal-50",
    border: "border-teal-200",
    description:
      "Endpoint REST per l'import programmatico di Lead, Company, Contact e Activity.\n\n" +
      "⚠️ NON si usa un sottodominio per workspace. Il prodotto sta su un dominio solo e il workspace non viene mai dedotto dall'header Host: lo dice la credenziale. Con la chiave del workspace è la chiave stessa a dirlo; con la chiave di piattaforma serve l'header `X-Tenant-ID`; con la sessione viene dal JWT. Chiamare un sottodominio senza credenziale giusta risponde 400 `Tenant context required`, e non c'è nessun parametro nel corpo che possa rimediare.\n\n" +
      "`ownerId` segue la credenziale: con la sessione il record nasce assegnato a chi ha chiamato, con una chiave API nasce senza proprietario, perché una chiave non è una persona.\n\n" +
      "Ogni endpoint ha una variante bulk, fino a 500 record per richiesta, con `onDuplicate` a scelta fra `skip`, `update` ed `error`. Una richiesta bulk risponde sempre 200 e riporta l'esito riga per riga: le righe rifiutate stanno dentro il corpo, non nel codice di stato.\n\n⚠️ **Regole di automazione.** Le rotte a record singolo — creare o aggiornare un lead, un contatto o un'azienda, spostare lo stadio di un lead, chiudere una trattativa, scrivere campi personalizzati, revocare un consenso — fanno partire le regole del workspace esattamente come lo stesso gesto fatto dalla dashboard: titolare a rotazione, iscrizione a una sequenza, notifiche. Le varianti bulk no: sono un'importazione, non un evento, come l'import CSV della dashboard, e mandare «email di benvenuto» a cinquecento contatti storici è l'opposto di ciò che vuole chi migra i propri dati. Per i record che devono far scattare le regole usa la rotta singola.\n\n⚠️ Manda anche un `Idempotency-Key`, una stringa tua che identifichi la singola importazione. Se la risposta non ti arriva — un timeout, una connessione caduta — non sai che cosa sia entrato, e rimandare lo stesso lotto duplica tutto ciò che quella rotta non sa deduplicare: contatti e lead si confrontano solo sull'email, che è facoltativa, e le attività su niente. Con la chiave puoi rimandare la richiesta identica quante volte vuoi: la prima importa, le successive ti restituiscono la stessa identica risposta, con gli stessi id, senza scrivere niente. La risposta rigiocata porta l'intestazione `Idempotent-Replay: true`. Se la stessa chiave arriva con un corpo diverso è un 422, perché rispondere con il risultato del primo corpo sembrerebbe riuscito. Senza chiave non cambia niente rispetto a prima.",
    endpoints: [
      {
        id: "crm-leads-create",
        method: "POST",
        path: "/api/crm/leads",
        summary: "Crea un lead",
        description:
          "Crea un singolo lead con validazione completa. La deduplicazione avviene per email (case-insensitive). Se `onDuplicate` è `skip` (default) e l'email è già presente, restituisce lo status `skipped`. Con `update` aggiorna il record esistente; con `error` risponde con HTTP 409.",
        auth: "session",
        scope: "leads:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          {
            name: "firstName",
            in: "body",
            required: true,
            type: "string",
            description: "Nome del lead",
            example: "Anna",
          },
          {
            name: "lastName",
            in: "body",
            required: true,
            type: "string",
            description: "Cognome del lead",
            example: "Bianchi",
          },
          {
            name: "email",
            in: "body",
            required: false,
            type: "string",
            description: "Indirizzo email — usato per la deduplicazione",
            example: "anna@startup.io",
          },
          {
            name: "phone",
            in: "body",
            required: false,
            type: "string",
            description: "Telefono fisso",
            example: "+39 02 1234567",
          },
          {
            name: "mobile",
            in: "body",
            required: false,
            type: "string",
            description: "Cellulare",
            example: "+39 333 1234567",
          },
          {
            name: "companyName",
            in: "body",
            required: false,
            type: "string",
            description: "Azienda di provenienza",
            example: "StartupIO Srl",
          },
          {
            name: "jobTitle",
            in: "body",
            required: false,
            type: "string",
            description: "Ruolo professionale",
            example: "CEO",
          },
          { name: "industry", in: "body", required: false, type: "string", description: "Settore", example: "SaaS" },
          {
            name: "website",
            in: "body",
            required: false,
            type: "string (URL)",
            description: "Sito web aziendale",
            example: "https://startup.io",
          },
          {
            name: "status",
            in: "body",
            required: false,
            type: "string",
            description: "Stato del lead",
            enum: ["new", "contacting", "engaged", "qualified", "unqualified"],
            example: "new",
          },
          {
            name: "rating",
            in: "body",
            required: false,
            type: "string",
            description: "Priorità del lead",
            enum: ["hot", "warm", "cold"],
            example: "warm",
          },
          {
            name: "source",
            in: "body",
            required: false,
            type: "string",
            description: "Sorgente di acquisizione",
            example: "linkedin",
          },
          {
            name: "leadScore",
            in: "body",
            required: false,
            type: "integer (0–100)",
            description: "Score qualitativo",
            example: "72",
          },
          {
            name: "notes",
            in: "body",
            required: false,
            type: "string",
            description: "Note libere (max 5000 caratteri)",
            example: "Ha partecipato al webinar Q1 2026",
          },
          {
            name: "marketingConsent",
            in: "body",
            required: false,
            type: "boolean",
            description: "Consenso marketing ricevuto",
            example: "true",
          },
          {
            name: "tags",
            in: "body",
            required: false,
            type: "string[]",
            description: "Tag di classificazione",
            example: '["inbound","q2-2026"]',
          },
          {
            name: "street",
            in: "body",
            required: false,
            type: "string",
            description: "Via/indirizzo",
            example: "Via Roma 1",
          },
          { name: "city", in: "body", required: false, type: "string", description: "Città", example: "Milano" },
          {
            name: "state",
            in: "body",
            required: false,
            type: "string",
            description: "Regione / Provincia",
            example: "MI",
          },
          { name: "zipCode", in: "body", required: false, type: "string", description: "CAP", example: "20121" },
          { name: "country", in: "body", required: false, type: "string", description: "Paese", example: "Italia" },
          {
            name: "onDuplicate",
            in: "body",
            required: false,
            type: "string",
            description: "Strategia deduplicazione",
            enum: ["skip", "update", "error"],
            example: "skip",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example:
            `# Il workspace lo dice la credenziale, mai l'indirizzo: un dominio solo per tutti.\n#\n# Con la chiave del workspace — niente X-Tenant-ID, e uno diverso viene rifiutato:\n# curl -X POST https://app.fluxcrm.com/api/crm/leads \\\n#   -H "Authorization: Bearer flx_9f2c8ab1..." \\\n#   -H "Content-Type: application/json" \\\n#   -d @body.json\n#\n# Con la chiave di piattaforma — X-Tenant-ID e obbligatorio:\n# curl -X POST https://app.fluxcrm.com/api/crm/leads \\\n#   -H "Authorization: Bearer $IMPORT_API_KEY" \\\n#   -H "X-Tenant-ID: 0f3c1e5a-..." \\\n#   -H "Content-Type: application/json" \\\n#   -d @body.json\n\n` +
            JSON.stringify(
              {
                firstName: "Anna",
                lastName: "Bianchi",
                email: "anna@startup.io",
                companyName: "StartupIO Srl",
                status: "new",
                rating: "warm",
                source: "linkedin",
                leadScore: 72,
                marketingConsent: true,
                tags: ["inbound", "q2-2026"],
                onDuplicate: "skip",
              },
              null,
              2,
            ),
        },
        responses: [
          {
            status: 201,
            description: "Lead creato",
            example: JSON.stringify(
              {
                status: "created",
                id: "lead_01JX",
                data: {
                  id: "lead_01JX",
                  firstName: "Anna",
                  lastName: "Bianchi",
                  email: "anna@startup.io",
                  status: "new",
                },
              },
              null,
              2,
            ),
          },
          {
            status: 200,
            description: "Lead saltato (duplicato) o aggiornato",
            example: JSON.stringify({ status: "skipped", reason: "duplicate_email", existingId: "lead_99YZ" }, null, 2),
          },
          {
            status: 409,
            description: "Conflitto — onDuplicate=error e duplicato trovato",
            example: JSON.stringify({ error: "Conflict", reason: "duplicate_email", existingId: "lead_99YZ" }, null, 2),
          },
          {
            status: 422,
            description: "Errore di validazione",
            example: JSON.stringify(
              {
                error: "Validation failed",
                errors: [{ field: "email", message: "email is not a valid email address" }],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-leads-bulk",
        method: "POST",
        path: "/api/crm/leads/bulk",
        summary: "Import bulk lead",
        description:
          "Importa fino a 500 lead in una singola richiesta. Ogni record viene validato e processato individualmente. La risposta include un riepilogo (`summary`) e il dettaglio per ogni record (`results`) con status `created`, `updated`, `skipped` o `error`.",
        auth: "session",
        scope: "leads:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "LeadInput[]",
            description: "Array di lead (max 500). Stessi campi dell'endpoint singolo.",
            example: "[{ ... }, { ... }]",
          },
          {
            name: "onDuplicate",
            in: "body",
            required: false,
            type: "string",
            description: "Strategia deduplicazione applicata a tutti i record",
            enum: ["skip", "update", "error"],
            example: "skip",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                { firstName: "Anna", lastName: "Bianchi", email: "anna@startup.io", status: "new" },
                { firstName: "Marco", lastName: "Verdi", email: "marco@corp.com", status: "contacting", rating: "hot" },
              ],
              onDuplicate: "skip",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 1, updated: 0, skipped: 1, errors: 0, durationMs: 87 },
                results: [
                  { index: 0, status: "created", id: "lead_01JX" },
                  { index: 1, status: "skipped", reason: "duplicate_email", existingId: "lead_99YZ" },
                ],
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "records mancante, vuoto o > 500 elementi",
            example: JSON.stringify({ error: "Batch size exceeds maximum of 500" }, null, 2),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-companies-create",
        method: "POST",
        path: "/api/crm/companies",
        summary: "Crea un'azienda",
        description:
          "Crea una singola azienda con validazione. La deduplicazione avviene per nome (case-insensitive, tramite ILIKE). Supporta `onDuplicate: skip | update | error`.",
        auth: "session",
        scope: "companies:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          {
            name: "name",
            in: "body",
            required: true,
            type: "string",
            description: "Ragione sociale — usata per la deduplicazione",
            example: "Acme Srl",
          },
          {
            name: "industry",
            in: "body",
            required: false,
            type: "string",
            description: "Settore",
            example: "Manufacturing",
          },
          {
            name: "website",
            in: "body",
            required: false,
            type: "string (URL)",
            description: "Sito web",
            example: "https://acme.it",
          },
          {
            name: "description",
            in: "body",
            required: false,
            type: "string",
            description: "Descrizione (max 2000 caratteri)",
            example: "Produttore di componenti industriali",
          },
          {
            name: "type",
            in: "body",
            required: false,
            type: "string",
            description: "Tipo azienda",
            enum: ["prospect", "customer", "partner", "vendor"],
            example: "prospect",
          },
          {
            name: "employeeCount",
            in: "body",
            required: false,
            type: "integer",
            description: "Numero dipendenti",
            example: "250",
          },
          {
            name: "annualRevenue",
            in: "body",
            required: false,
            type: "string",
            description: "Fatturato annuo (stringa numerica)",
            example: "5000000.00",
          },
          {
            name: "mainPhone",
            in: "body",
            required: false,
            type: "string",
            description: "Telefono principale",
            example: "+39 02 9876543",
          },
          {
            name: "mainEmail",
            in: "body",
            required: false,
            type: "string",
            description: "Email principale",
            example: "info@acme.it",
          },
          {
            name: "linkedinUrl",
            in: "body",
            required: false,
            type: "string (URL)",
            description: "URL profilo LinkedIn",
            example: "https://linkedin.com/company/acme",
          },
          {
            name: "vatNumber",
            in: "body",
            required: false,
            type: "string",
            description: "Partita IVA",
            example: "IT02345678901",
          },
          {
            name: "sdiCode",
            in: "body",
            required: false,
            type: "string",
            description: "Codice SDI (fatturazione elettronica)",
            example: "XXXXXXX",
          },
          {
            name: "fiscalCode",
            in: "body",
            required: false,
            type: "string",
            description: "Codice fiscale (16 caratteri per una persona, 11 cifre per un'azienda)",
            example: "02345678901",
          },
          {
            name: "pec",
            in: "body",
            required: false,
            type: "string (email)",
            description: "PEC per la fatturazione elettronica, in alternativa al codice SDI",
            example: "fatture@pec.acme.it",
          },
          {
            name: "language",
            in: "body",
            required: false,
            type: "string (it | en)",
            description:
              "Lingua dei documenti inviati al cliente: preventivo, stampa, pagina pubblica, email e copia di cortesia della fattura. Omesso o null: dedotta dal paese (italiano per l'Italia o senza paese, inglese altrimenti).",
            example: "en",
          },
          {
            name: "source",
            in: "body",
            required: false,
            type: "string",
            description: "Sorgente",
            example: "trade_show",
          },
          {
            name: "tags",
            in: "body",
            required: false,
            type: "string[]",
            description: "Tag",
            example: '["nord-italia","enterprise"]',
          },
          {
            name: "street",
            in: "body",
            required: false,
            type: "string",
            description: "Indirizzo",
            example: "Via Industria 42",
          },
          { name: "city", in: "body", required: false, type: "string", description: "Città", example: "Bergamo" },
          { name: "country", in: "body", required: false, type: "string", description: "Paese", example: "Italia" },
          {
            name: "onDuplicate",
            in: "body",
            required: false,
            type: "string",
            description: "Strategia deduplicazione",
            enum: ["skip", "update", "error"],
            example: "skip",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              name: "Acme Srl",
              industry: "Manufacturing",
              website: "https://acme.it",
              type: "prospect",
              employeeCount: 250,
              mainEmail: "info@acme.it",
              vatNumber: "IT02345678901",
              onDuplicate: "update",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 409,
            description: "Conflitto — `onDuplicate=error` e un azienda corrispondente esiste già",
            example: JSON.stringify({ error: "Conflict", reason: "duplicate_name", existingId: "cmp_77AB" }, null, 2),
          },
          {
            status: 201,
            description: "Azienda creata",
            example: JSON.stringify(
              { status: "created", id: "cmp_01JX", data: { id: "cmp_01JX", name: "Acme Srl", type: "prospect" } },
              null,
              2,
            ),
          },
          {
            status: 200,
            description: "Azienda saltata o aggiornata",
            example: JSON.stringify(
              { status: "updated", id: "cmp_99YZ", data: { id: "cmp_99YZ", name: "Acme Srl" } },
              null,
              2,
            ),
          },
          {
            status: 422,
            description: "Errore di validazione",
            example: JSON.stringify(
              { error: "Validation failed", errors: [{ field: "website", message: "website is not a valid URL" }] },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-companies-bulk",
        method: "POST",
        path: "/api/crm/companies/bulk",
        summary: "Import bulk aziende",
        description: "Importa fino a 500 aziende in una singola richiesta. Deduplicazione per nome (ILIKE).",
        auth: "session",
        scope: "companies:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "CompanyInput[]",
            description: "Array di aziende (max 500)",
            example: "[{ name: 'Acme', ... }]",
          },
          {
            name: "onDuplicate",
            in: "body",
            required: false,
            type: "string",
            enum: ["skip", "update", "error"],
            description: "Strategia deduplicazione",
            example: "skip",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                { name: "Acme Srl", industry: "Manufacturing", type: "customer", vatNumber: "IT02345678901" },
                { name: "Beta SpA", industry: "Technology", website: "https://beta.it", employeeCount: 80 },
              ],
              onDuplicate: "skip",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 2, updated: 0, skipped: 0, errors: 0, durationMs: 112 },
                results: [
                  { index: 0, status: "created", id: "cmp_01JX" },
                  { index: 1, status: "created", id: "cmp_02AB" },
                ],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-contacts-create",
        method: "POST",
        path: "/api/crm/contacts",
        summary: "Crea un contatto",
        description:
          "Crea un singolo contatto. Deduplicazione per email (case-insensitive). Supporta `onDuplicate`. Se si passa `companyId`, il contatto viene collegato all'azienda corrispondente.",
        auth: "session",
        scope: "contacts:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          { name: "firstName", in: "body", required: true, type: "string", description: "Nome", example: "Mario" },
          { name: "lastName", in: "body", required: true, type: "string", description: "Cognome", example: "Rossi" },
          {
            name: "email",
            in: "body",
            required: false,
            type: "string",
            description: "Email — usata per la deduplicazione",
            example: "mario@acme.it",
          },
          {
            name: "phone",
            in: "body",
            required: false,
            type: "string",
            description: "Telefono",
            example: "+39 02 1234567",
          },
          {
            name: "mobile",
            in: "body",
            required: false,
            type: "string",
            description: "Cellulare",
            example: "+39 333 9876543",
          },
          {
            name: "jobTitle",
            in: "body",
            required: false,
            type: "string",
            description: "Ruolo",
            example: "Direttore Acquisti",
          },
          {
            name: "department",
            in: "body",
            required: false,
            type: "string",
            description: "Reparto",
            example: "Procurement",
          },
          {
            name: "linkedinUrl",
            in: "body",
            required: false,
            type: "string (URL)",
            description: "Profilo LinkedIn",
            example: "https://linkedin.com/in/mario-rossi",
          },
          {
            name: "companyId",
            in: "body",
            required: false,
            type: "string",
            description: "ID dell'azienda collegata (UUID)",
            example: "cmp_01JX",
          },
          {
            name: "source",
            in: "body",
            required: false,
            type: "string",
            description: "Sorgente",
            example: "trade_show",
          },
          {
            name: "leadScore",
            in: "body",
            required: false,
            type: "integer (0–100)",
            description: "Score",
            example: "85",
          },
          {
            name: "notes",
            in: "body",
            required: false,
            type: "string",
            description: "Note",
            example: "Decisore finale per acquisti IT",
          },
          {
            name: "marketingConsent",
            in: "body",
            required: false,
            type: "boolean",
            description: "Consenso marketing",
            example: "true",
          },
          {
            name: "tags",
            in: "body",
            required: false,
            type: "string[]",
            description: "Tag",
            example: '["vip","decision-maker"]',
          },
          { name: "street", in: "body", required: false, type: "string", description: "Via", example: "Via Roma 1" },
          { name: "city", in: "body", required: false, type: "string", description: "Città", example: "Milano" },
          { name: "country", in: "body", required: false, type: "string", description: "Paese", example: "Italia" },
          {
            name: "onDuplicate",
            in: "body",
            required: false,
            type: "string",
            enum: ["skip", "update", "error"],
            description: "Strategia deduplicazione",
            example: "skip",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              firstName: "Mario",
              lastName: "Rossi",
              email: "mario@acme.it",
              jobTitle: "Direttore Acquisti",
              companyId: "cmp_01JX",
              source: "trade_show",
              leadScore: 85,
              marketingConsent: true,
              tags: ["vip", "decision-maker"],
              onDuplicate: "skip",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 409,
            description: "Conflitto — `onDuplicate=error` e un contatto corrispondente esiste già",
            example: JSON.stringify({ error: "Conflict", reason: "duplicate_email", existingId: "cnt_31KJ" }, null, 2),
          },
          {
            status: 201,
            description: "Contatto creato",
            example: JSON.stringify(
              {
                status: "created",
                id: "cnt_01JX",
                data: { id: "cnt_01JX", firstName: "Mario", lastName: "Rossi", email: "mario@acme.it" },
              },
              null,
              2,
            ),
          },
          {
            status: 200,
            description: "Contatto saltato o aggiornato",
            example: JSON.stringify({ status: "skipped", reason: "duplicate_email", existingId: "cnt_99YZ" }, null, 2),
          },
          {
            status: 422,
            description: "Errore di validazione",
            example: JSON.stringify(
              { error: "Validation failed", errors: [{ field: "firstName", message: "firstName is required" }] },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-contacts-bulk",
        method: "POST",
        path: "/api/crm/contacts/bulk",
        summary: "Import bulk contatti",
        description: "Importa fino a 500 contatti. Deduplicazione per email.",
        auth: "session",
        scope: "contacts:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "ContactInput[]",
            description: "Array di contatti (max 500)",
            example: "[{ firstName: 'Mario', ... }]",
          },
          {
            name: "onDuplicate",
            in: "body",
            required: false,
            type: "string",
            enum: ["skip", "update", "error"],
            description: "Strategia deduplicazione",
            example: "skip",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                { firstName: "Mario", lastName: "Rossi", email: "mario@acme.it", companyId: "cmp_01JX" },
                { firstName: "Giulia", lastName: "Ferrari", email: "giulia@beta.it", jobTitle: "CTO" },
              ],
              onDuplicate: "skip",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 1, updated: 0, skipped: 1, errors: 0, durationMs: 95 },
                results: [
                  { index: 0, status: "skipped", reason: "duplicate_email", existingId: "cnt_99YZ" },
                  { index: 1, status: "created", id: "cnt_02AB" },
                ],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-activities-create",
        method: "POST",
        path: "/api/crm/activities",
        summary: "Crea un'attività",
        description:
          "Crea una singola attività (nota, chiamata, meeting, email) collegata ad almeno un'entità CRM (lead, contact, company o deal). Le attività non sono deduplicate.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          {
            name: "type",
            in: "body",
            required: true,
            type: "string",
            description: "Tipo di attività",
            enum: ["note", "call", "meeting", "email"],
            example: "call",
          },
          {
            name: "content",
            in: "body",
            required: false,
            type: "string",
            description: "Corpo/descrizione dell'attività (max 5000 caratteri)",
            example: "Chiamata di presentazione prodotto",
          },
          {
            name: "date",
            in: "body",
            required: false,
            type: "string (ISO 8601)",
            description: "Data/ora dell'attività",
            example: "2026-05-15T14:30:00.000Z",
          },
          {
            name: "durationMinutes",
            in: "body",
            required: false,
            type: "integer",
            description: "Durata in minuti (per chiamate e meeting)",
            example: "45",
          },
          {
            name: "participants",
            in: "body",
            required: false,
            type: "string",
            description: "Partecipanti (nomi o email separati da virgola)",
            example: "mario@acme.it, giulia@beta.it",
          },
          {
            name: "leadId",
            in: "body",
            required: false,
            type: "string",
            description: "ID del lead collegato",
            example: "lead_01JX",
          },
          {
            name: "contactId",
            in: "body",
            required: false,
            type: "string",
            description: "ID del contatto collegato",
            example: "cnt_01JX",
          },
          {
            name: "companyId",
            in: "body",
            required: false,
            type: "string",
            description: "ID dell'azienda collegata",
            example: "cmp_01JX",
          },
          {
            name: "dealId",
            in: "body",
            required: false,
            type: "string",
            description: "ID del deal collegato",
            example: "deal_01JX",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              type: "call",
              content: "Chiamata di presentazione prodotto — interesse confermato per Q3 2026",
              date: "2026-05-15T14:30:00.000Z",
              durationMinutes: 45,
              participants: "mario@acme.it",
              contactId: "cnt_01JX",
              companyId: "cmp_01JX",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Attività creata",
            example: JSON.stringify(
              {
                status: "created",
                id: "act_01JX",
                data: { id: "act_01JX", type: "call", content: "Chiamata di presentazione prodotto" },
              },
              null,
              2,
            ),
          },
          {
            status: 422,
            description: "Errore di validazione (es. entità mancante)",
            example: JSON.stringify(
              {
                error: "Validation failed",
                errors: [
                  { field: "entity", message: "At least one of leadId, contactId, companyId, or dealId is required" },
                ],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-activities-bulk",
        method: "POST",
        path: "/api/crm/activities/bulk",
        summary: "Import bulk attività",
        description:
          "Importa fino a 500 attività in una singola richiesta. Le attività non sono soggette a deduplicazione — ogni record valido genera sempre un nuovo record in DB.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: false,
            type: "string",
            description:
              "Bearer <chiave del workspace>, oppure Bearer <IMPORT_API_KEY> con X-Tenant-ID. In alternativa il cookie di sessione.",
            example: "Bearer flx_9f2c8ab1d4e07b635c81af9204e6b7d83a15c2e9f04b7681d3a5c9e2f8b06147",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "ActivityInput[]",
            description: "Array di attività (max 500). Stessi campi dell'endpoint singolo.",
            example: "[{ type: 'note', ... }]",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                {
                  type: "note",
                  content: "Prima presa di contatto",
                  contactId: "cnt_01JX",
                  date: "2026-05-10T09:00:00.000Z",
                },
                {
                  type: "call",
                  content: "Demo prodotto",
                  contactId: "cnt_01JX",
                  durationMinutes: 30,
                  date: "2026-05-15T14:30:00.000Z",
                },
              ],
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 2, updated: 0, skipped: 0, errors: 0, durationMs: 54 },
                results: [
                  { index: 0, status: "created", id: "act_01JX" },
                  { index: 1, status: "created", id: "act_02AB" },
                ],
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "records mancante o > 500 elementi",
            example: JSON.stringify({ error: "Batch size exceeds maximum of 500" }, null, 2),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      // ─── Entity-scoped activity endpoints ─────────────────────────────
      {
        id: "crm-lead-activities-create",
        method: "POST",
        path: "/api/crm/leads/{leadId}/activities",
        summary: "Aggiungi attività a un lead",
        description:
          "Crea una singola attività collegata al lead specificato nell'URL. Non è necessario includere leadId nel body — viene iniettato automaticamente dall'URL.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "leadId",
            in: "path",
            required: true,
            type: "string",
            description: "ID del lead",
            example: "lead_01JX",
          },
          {
            name: "type",
            in: "body",
            required: true,
            type: "string",
            description: "Tipo di attività",
            enum: ["note", "call", "meeting", "email"],
            example: "note",
          },
          {
            name: "content",
            in: "body",
            required: false,
            type: "string",
            description: "Corpo/descrizione (max 5000 caratteri)",
            example: "Primo contatto via email",
          },
          {
            name: "date",
            in: "body",
            required: false,
            type: "string (ISO 8601)",
            description: "Data/ora dell'attività",
            example: "2026-05-15T10:00:00.000Z",
          },
          {
            name: "durationMinutes",
            in: "body",
            required: false,
            type: "integer",
            description: "Durata in minuti",
            example: "30",
          },
          {
            name: "participants",
            in: "body",
            required: false,
            type: "string",
            description: "Partecipanti",
            example: "anna@startup.io",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              type: "note",
              content: "Primo contatto via email — interesse per piano Enterprise",
              date: "2026-05-15T10:00:00.000Z",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Attività creata",
            example: JSON.stringify(
              { status: "created", id: "act_03CD", data: { id: "act_03CD", type: "note", leadId: "lead_01JX" } },
              null,
              2,
            ),
          },
          {
            status: 422,
            description: "Errore di validazione",
            example: JSON.stringify(
              { error: "Validation failed", errors: [{ field: "type", message: "type is required" }] },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-lead-activities-bulk",
        method: "POST",
        path: "/api/crm/leads/{leadId}/activities/bulk",
        summary: "Import bulk attività per un lead",
        description:
          "Importa fino a 500 attività tutte collegate al lead specificato. Il leadId viene iniettato automaticamente in ogni record dall'URL.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "leadId",
            in: "path",
            required: true,
            type: "string",
            description: "ID del lead",
            example: "lead_01JX",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "ActivityBodyInput[]",
            description: "Array di attività (max 500). Stessi campi dell'endpoint singolo eccetto leadId.",
            example: "[{ type: 'note', ... }]",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                { type: "note", content: "Email di benvenuto inviata", date: "2026-05-10T09:00:00.000Z" },
                { type: "call", content: "Demo prodotto", durationMinutes: 30, date: "2026-05-15T14:30:00.000Z" },
              ],
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 2, updated: 0, skipped: 0, errors: 0, durationMs: 38 },
                results: [
                  { index: 0, status: "created", id: "act_04EF" },
                  { index: 1, status: "created", id: "act_05GH" },
                ],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-contact-activities-create",
        method: "POST",
        path: "/api/crm/contacts/{contactId}/activities",
        summary: "Aggiungi attività a un contatto",
        description:
          "Crea una singola attività collegata al contatto specificato nell'URL. Non è necessario includere contactId nel body.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "contactId",
            in: "path",
            required: true,
            type: "string",
            description: "ID del contatto",
            example: "cnt_01JX",
          },
          {
            name: "type",
            in: "body",
            required: true,
            type: "string",
            description: "Tipo di attività",
            enum: ["note", "call", "meeting", "email"],
            example: "call",
          },
          {
            name: "content",
            in: "body",
            required: false,
            type: "string",
            description: "Corpo/descrizione (max 5000 caratteri)",
            example: "Chiamata di follow-up",
          },
          {
            name: "date",
            in: "body",
            required: false,
            type: "string (ISO 8601)",
            description: "Data/ora dell'attività",
            example: "2026-05-15T14:30:00.000Z",
          },
          {
            name: "durationMinutes",
            in: "body",
            required: false,
            type: "integer",
            description: "Durata in minuti",
            example: "45",
          },
          {
            name: "participants",
            in: "body",
            required: false,
            type: "string",
            description: "Partecipanti",
            example: "mario@acme.it",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              type: "call",
              content: "Chiamata di follow-up — conferma interesse per Q3",
              durationMinutes: 45,
              date: "2026-05-15T14:30:00.000Z",
              participants: "mario@acme.it",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Attività creata",
            example: JSON.stringify(
              { status: "created", id: "act_06IJ", data: { id: "act_06IJ", type: "call", contactId: "cnt_01JX" } },
              null,
              2,
            ),
          },
          {
            status: 422,
            description: "Errore di validazione",
            example: JSON.stringify(
              { error: "Validation failed", errors: [{ field: "type", message: "type is required" }] },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-contact-activities-bulk",
        method: "POST",
        path: "/api/crm/contacts/{contactId}/activities/bulk",
        summary: "Import bulk attività per un contatto",
        description:
          "Importa fino a 500 attività tutte collegate al contatto specificato. Il contactId viene iniettato automaticamente in ogni record dall'URL.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "contactId",
            in: "path",
            required: true,
            type: "string",
            description: "ID del contatto",
            example: "cnt_01JX",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "ActivityBodyInput[]",
            description: "Array di attività (max 500). Stessi campi dell'endpoint singolo eccetto contactId.",
            example: "[{ type: 'note', ... }]",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                { type: "note", content: "Prima presa di contatto", date: "2026-05-10T09:00:00.000Z" },
                {
                  type: "meeting",
                  content: "Riunione presentazione offerta",
                  durationMinutes: 60,
                  date: "2026-05-20T11:00:00.000Z",
                },
              ],
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 2, updated: 0, skipped: 0, errors: 0, durationMs: 41 },
                results: [
                  { index: 0, status: "created", id: "act_07KL" },
                  { index: 1, status: "created", id: "act_08MN" },
                ],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-company-activities-create",
        method: "POST",
        path: "/api/crm/companies/{companyId}/activities",
        summary: "Aggiungi attività a un'azienda",
        description:
          "Crea una singola attività collegata all'azienda specificata nell'URL. Non è necessario includere companyId nel body.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            type: "string",
            description: "ID dell'azienda",
            example: "cmp_01JX",
          },
          {
            name: "type",
            in: "body",
            required: true,
            type: "string",
            description: "Tipo di attività",
            enum: ["note", "call", "meeting", "email"],
            example: "meeting",
          },
          {
            name: "content",
            in: "body",
            required: false,
            type: "string",
            description: "Corpo/descrizione (max 5000 caratteri)",
            example: "Riunione con il team acquisti",
          },
          {
            name: "date",
            in: "body",
            required: false,
            type: "string (ISO 8601)",
            description: "Data/ora dell'attività",
            example: "2026-05-20T09:00:00.000Z",
          },
          {
            name: "durationMinutes",
            in: "body",
            required: false,
            type: "integer",
            description: "Durata in minuti",
            example: "60",
          },
          {
            name: "participants",
            in: "body",
            required: false,
            type: "string",
            description: "Partecipanti",
            example: "info@acme.it",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              type: "meeting",
              content: "Riunione con il team acquisti — discussione budget 2026",
              durationMinutes: 60,
              date: "2026-05-20T09:00:00.000Z",
              participants: "info@acme.it",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Attività creata",
            example: JSON.stringify(
              { status: "created", id: "act_09OP", data: { id: "act_09OP", type: "meeting", companyId: "cmp_01JX" } },
              null,
              2,
            ),
          },
          {
            status: 422,
            description: "Errore di validazione",
            example: JSON.stringify(
              { error: "Validation failed", errors: [{ field: "type", message: "type is required" }] },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-company-activities-bulk",
        method: "POST",
        path: "/api/crm/companies/{companyId}/activities/bulk",
        summary: "Import bulk attività per un'azienda",
        description:
          "Importa fino a 500 attività tutte collegate all'azienda specificata. Il companyId viene iniettato automaticamente in ogni record dall'URL.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            type: "string",
            description: "ID dell'azienda",
            example: "cmp_01JX",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "ActivityBodyInput[]",
            description: "Array di attività (max 500). Stessi campi dell'endpoint singolo eccetto companyId.",
            example: "[{ type: 'note', ... }]",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                {
                  type: "note",
                  content: "Contatto iniziale con responsabile acquisti",
                  date: "2026-05-05T10:00:00.000Z",
                },
                {
                  type: "call",
                  content: "Call di follow-up post-offerta",
                  durationMinutes: 20,
                  date: "2026-05-22T15:00:00.000Z",
                },
              ],
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 2, updated: 0, skipped: 0, errors: 0, durationMs: 36 },
                results: [
                  { index: 0, status: "created", id: "act_10QR" },
                  { index: 1, status: "created", id: "act_11ST" },
                ],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-deal-activities-create",
        method: "POST",
        path: "/api/crm/deals/{dealId}/activities",
        summary: "Aggiungi attività a un deal",
        description:
          "Crea una singola attività collegata al deal specificato nell'URL. Non è necessario includere dealId nel body.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "dealId",
            in: "path",
            required: true,
            type: "string",
            description: "ID del deal",
            example: "deal_01JX",
          },
          {
            name: "type",
            in: "body",
            required: true,
            type: "string",
            description: "Tipo di attività",
            enum: ["note", "call", "meeting", "email"],
            example: "note",
          },
          {
            name: "content",
            in: "body",
            required: false,
            type: "string",
            description: "Corpo/descrizione (max 5000 caratteri)",
            example: "Proposta inviata, in attesa di feedback",
          },
          {
            name: "date",
            in: "body",
            required: false,
            type: "string (ISO 8601)",
            description: "Data/ora dell'attività",
            example: "2026-05-18T16:00:00.000Z",
          },
          {
            name: "durationMinutes",
            in: "body",
            required: false,
            type: "integer",
            description: "Durata in minuti",
            example: "20",
          },
          {
            name: "participants",
            in: "body",
            required: false,
            type: "string",
            description: "Partecipanti",
            example: "giulia@beta.it",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              type: "note",
              content: "Proposta inviata, in attesa di feedback entro fine mese",
              date: "2026-05-18T16:00:00.000Z",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Attività creata",
            example: JSON.stringify(
              { status: "created", id: "act_12UV", data: { id: "act_12UV", type: "note", dealId: "deal_01JX" } },
              null,
              2,
            ),
          },
          {
            status: 422,
            description: "Errore di validazione",
            example: JSON.stringify(
              { error: "Validation failed", errors: [{ field: "type", message: "type is required" }] },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "crm-deal-activities-bulk",
        method: "POST",
        path: "/api/crm/deals/{dealId}/activities/bulk",
        summary: "Import bulk attività per un deal",
        description:
          "Importa fino a 500 attività tutte collegate al deal specificato. Il dealId viene iniettato automaticamente in ogni record dall'URL.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "dealId",
            in: "path",
            required: true,
            type: "string",
            description: "ID del deal",
            example: "deal_01JX",
          },
          {
            name: "records",
            in: "body",
            required: true,
            type: "ActivityBodyInput[]",
            description: "Array di attività (max 500). Stessi campi dell'endpoint singolo eccetto dealId.",
            example: "[{ type: 'note', ... }]",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              records: [
                { type: "note", content: "Proposta inviata", date: "2026-05-18T16:00:00.000Z" },
                {
                  type: "call",
                  content: "Chiamata di chiarimento condizioni contrattuali",
                  durationMinutes: 25,
                  date: "2026-05-25T10:00:00.000Z",
                },
              ],
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Elaborazione completata",
            example: JSON.stringify(
              {
                summary: { total: 2, created: 2, updated: 0, skipped: 0, errors: 0, durationMs: 33 },
                results: [
                  { index: 0, status: "created", id: "act_13WX" },
                  { index: 1, status: "created", id: "act_14YZ" },
                ],
              },
              null,
              2,
            ),
          },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
    ],
  },
  {
    id: "rest-hooks",
    label: "Zapier, Make e simili",
    icon: Zap,
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    description:
      "Tutto ciò che serve a un'app Zapier o Make, o a qualunque automazione costruita allo stesso modo.\n\n" +
      "**Trigger.** Istantanei: l'app si iscrive agli eventi con `POST /api/crm/webhooks` quando qualcuno accende il trigger e si disiscrive con `DELETE` quando lo spegne. Oppure a interrogazione: le letture `GET` con `updatedSince`.\n\n" +
      "**Azioni** sono le rotte di scrittura, **ricerche** le letture. Ogni chiamata porta una chiave di Impostazioni → API con i permessi che servono; per un'app su Zapier conviene una chiave dedicata, così la si revoca senza toccare il resto.\n\n" +
      "**Gli eventi** (28): `contact.created`, `contact.updated`, `contact.deleted`, `company.created`, `company.updated`, `consent.withdrawn`, `lead.created`, `lead.updated`, `lead.converted`, `deal.created`, `deal.stage_changed`, `deal.won`, `deal.lost`, `activity.created`, `task.completed`, `quote.sent`, `quote.accepted`, `quote.declined`, `order.created`, `order.draft`, `order.processing`, `order.completed`, `order.cancelled`, `invoice.issued`, `invoice.paid`, `ticket.created`, `ticket.resolved`, `ticket.rated`. Più quelli che le regole di automazione del workspace emettono con un nome proprio. Ogni consegna è firmata: `X-Webhook-Signature: sha256=<hmac del corpo con il segreto>`, e `X-Webhook-Id` resta uguale nei tentativi successivi.\n\n" +
      '⚠️ **Per non sentire le proprie scritture** si guarda `origin`: `via` è `api` per tutto ciò che è entrato dall\'API, e `origin.key` dice quale chiave (`id` e `name`). Scartare ogni evento `via: "api"` scarterebbe anche ciò che scrivono le altre integrazioni; si scartano solo quelli con la propria `origin.key.id`.\n\n⚠️ **`consent.withdrawn`** arriva a ogni richiesta di smettere: dal link di disiscrizione di un\'email (`channel: "email"`), dalla scheda della persona quando si toglie il consenso marketing (`channel: "marketing"`: niente più promozione, ma i seguiti che la persona ha chiesto continuano) e da `/api/crm/opt-out` (`channel: "all"`). Porta in cima `email`, `phone`, `mobile` e l\'elenco dei record. Dal link e dall\'API parte anche se in Flux il consenso era già negato: chi scrive a quella persona con un proprio consenso deve ritirarlo lo stesso.',
    endpoints: [
      {
        id: "rest-hook-subscribe",
        method: "POST",
        path: "/api/crm/webhooks",
        summary: "Iscrive un indirizzo a degli eventi",
        description:
          "Crea un'iscrizione senza titolare: la può rimuovere solo una chiave, e un amministratore dalla schermata Webhook. Il segreto di firma torna una volta sola, in questa risposta. Al massimo 50 iscrizioni create tramite API per workspace, perché ogni evento parte verso ciascuna.",
        auth: "session",
        scope: "webhooks:write",
        parameters: [
          {
            name: "url",
            in: "body",
            required: true,
            type: "string",
            description: "Indirizzo https pubblico che riceve gli eventi.",
            example: "https://hooks.zapier.com/hooks/standard/123/abc",
          },
          {
            name: "events",
            in: "body",
            required: true,
            type: "string[]",
            description: "Nomi degli eventi, oppure `*` per tutti.",
            example: '["contact.created"]',
          },
          {
            name: "name",
            in: "body",
            required: false,
            type: "string",
            description: "Come compare nella schermata Webhook.",
            example: "Zapier",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            { url: "https://hooks.zapier.com/hooks/standard/123/abc", events: ["contact.created"], name: "Zapier" },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Iscritto",
            example: JSON.stringify(
              {
                id: "wh_1",
                url: "https://hooks.zapier.com/hooks/standard/123/abc",
                events: ["contact.created"],
                secret: "9f…",
              },
              null,
              2,
            ),
          },
        ],
      },
      {
        id: "rest-hook-unsubscribe",
        method: "DELETE",
        path: "/api/crm/webhooks/{id}",
        summary: "Annulla un'iscrizione fatta tramite API",
        description:
          "Solo un'iscrizione creata con `POST /api/crm/webhooks`: un webhook configurato da un amministratore non si spegne con una chiave. Non conteggiata sul piano.",
        auth: "session",
        scope: "webhooks:write",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            type: "string",
            description: "L'id restituito all'iscrizione.",
            example: "wh_1",
          },
        ],
        responses: [
          { status: 200, description: "Annullata", example: JSON.stringify({ deleted: true, id: "wh_1" }, null, 2) },
          {
            status: 404,
            description: "Nessuna iscrizione fatta tramite API con questo id",
            example: JSON.stringify({ error: "No subscription made through the API has this id" }, null, 2),
          },
        ],
      },
      {
        id: "assistant-handling",
        method: "POST",
        path: "/api/crm/assistant",
        summary: "Segna (o toglie) chi sta seguendo un assistente IA",
        description:
          "Su ogni lead e contatto di quel recapito. Finché il segno c'è, le sequenze di Flux non iscrivono la persona e fermano quelle in corso, e le campagne la saltano: due sistemi che scrivono alla stessa persona sono uno di troppo. La scheda mostra «Seguito da <nome della chiave>». Ripetibile: segnare due volte è segnare una volta, quindi niente `Idempotency-Key`.",
        auth: "session",
        scope: "assistant:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Email o numero di telefono della persona.",
            example: "+39 333 111 2223",
          },
          {
            name: "handling",
            in: "body",
            required: true,
            type: "boolean",
            description: "`true` quando l'assistente la prende, `false` quando la lascia.",
            example: "true",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ contactPoint: "+39 333 111 2223", handling: true }, null, 2),
        },
        responses: [
          {
            status: 200,
            description: "Segnata o tolta su questi record",
            example: JSON.stringify({ handling: true, ids: ["l1", "c1"] }, null, 2),
          },
          {
            status: 409,
            description:
              "Il segno l'ha messo un'altra chiave: solo quella lo cambia (deciso il 27 settembre 2026). Toglierlo da un'altra integrazione rimetteva la persona in campagne e sequenze mentre l'assistente le stava ancora parlando.",
            example: JSON.stringify(
              {
                error: "Another integration is handling this person; only its key can change that",
                code: "held_by_another",
              },
              null,
              2,
            ),
          },
          {
            status: 404,
            description: "Nessuna persona a quel recapito",
            example: JSON.stringify({ error: "No person reachable at that contact point" }, null, 2),
          },
        ],
      },
      {
        id: "quote-draft",
        method: "POST",
        path: "/api/crm/quotes",
        summary: "Propone una bozza di preventivo, con i prezzi calcolati da Flux",
        description:
          "«Il modello dice le voci, il codice dice i prezzi»: ogni riga nomina un prodotto e una quantità, e Flux ne calcola il prezzo dal listino del cliente della trattativa, con la stessa regola del modulo del commerciale, e l'IVA dal prodotto. Una riga senza prodotto è rifiutata: sarebbe un prezzo inventato. Il preventivo resta una **bozza** del titolare della trattativa, che riceve una notifica; al cliente non arriva nulla finché una persona non lo manda. Nella cronologia compare come «proposto come bozza dall'assistente». Accetta `Idempotency-Key`: una richiesta ripetuta restituisce la stessa bozza.",
        auth: "session",
        scope: "quotes:write",
        parameters: [
          {
            name: "dealId",
            in: "body",
            required: true,
            type: "string",
            description: "La trattativa: la sua azienda dà il listino.",
            example: "d1",
          },
          {
            name: "lines",
            in: "body",
            required: true,
            type: "object[]",
            description:
              "Fino a 100 righe: `productId`, `quantity` e una `note` facoltativa che si aggiunge alla descrizione.",
            example: '[{"productId":"p1","quantity":2,"note":"senza cipolla"}]',
          },
          {
            name: "contactId",
            in: "body",
            required: false,
            type: "string",
            description: "Il referente, se diverso da quello della trattativa.",
            example: "c1",
          },
          {
            name: "notes",
            in: "body",
            required: false,
            type: "string",
            description: "Condizioni; senza, quelle predefinite del workspace.",
            example: "Consegna entro venerdì.",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            { dealId: "d1", lines: [{ productId: "p1", quantity: 2, note: "senza cipolla" }] },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Bozza creata",
            example: JSON.stringify(
              {
                status: "draft",
                id: "q1",
                quoteNumber: "QT-202609-1A2B3C4D",
                total: 15.4,
                lines: [
                  {
                    productId: "p1",
                    description: "Margherita — senza cipolla",
                    quantity: 2,
                    unitPrice: 7,
                    taxPercent: 10,
                  },
                ],
              },
              null,
              2,
            ),
          },
          {
            status: 404,
            description: "Nessuna trattativa con quell'id",
            example: JSON.stringify(
              { error: "Validation failed", errors: [{ field: "dealId", message: "No deal with that id" }] },
              null,
              2,
            ),
          },
        ],
      },
    ],
  },
  {
    id: "crm-contact-point",
    label: "Integration API (recapito)",
    icon: Terminal,
    color: "text-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
    description:
      "Rotte pensate per un'integrazione che parla con una persona — un assistente telefonico, un bot, un centralino — e che di quella persona conosce solo il modo per raggiungerla.\n\n" +
      "⚠️ Partono da un RECAPITO, non da un id. `contactPoint` accetta un numero di telefono o un indirizzo email e viene risolto contro lead e contatti insieme: il numero si confronta a cifre, ignorando spazi, punti, trattini e prefisso internazionale, così `+39 333 111 2223` e `333.111.2223` trovano la stessa persona. Un id del chiamante qui non significherebbe niente, ed è la ragione per cui queste rotte esistono accanto a quelle di /api/crm che invece gli id li prendono.\n\n" +
      "Se il recapito non trova nessuno la risposta è 404: nessuna di queste rotte crea la persona per poi scriverci sopra.\n\n" +
      "Autenticazione come il resto di /api/crm: chiave del workspace, oppure chiave di piattaforma con `X-Tenant-ID`, oppure sessione.",
    endpoints: [
      {
        id: "crm-notes",
        method: "POST",
        path: "/api/crm/notes",
        summary: "Annota sulla scheda della persona",
        description:
          "Scrive un'attività sulla cronologia della persona raggiungibile a quel recapito: quello che l'integrazione ha fatto o detto, con le sue parole.\n\n" +
          "Se `occurredAt` manca vale adesso. L'attività nasce senza proprietario quando si usa una chiave API, perché una chiave non è una persona.",
        auth: "session",
        scope: "activities:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Telefono o email della persona. Il telefono si confronta a cifre",
            example: "+39 333 111 2223",
          },
          {
            name: "text",
            in: "body",
            required: true,
            type: "string",
            description: "Cosa annotare, come lo si vuole leggere sulla scheda",
            example: "Chiamata: conferma l'appuntamento di giovedì alle 15",
          },
          {
            name: "occurredAt",
            in: "body",
            required: false,
            type: "string (ISO 8601)",
            description: "Quando è successo. Assente vale adesso",
            example: "2026-09-05T14:30:00Z",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              contactPoint: "+39 333 111 2223",
              text: "Chiamata: conferma l'appuntamento di giovedì alle 15",
              occurredAt: "2026-09-05T14:30:00Z",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Annotazione scritta",
            example: JSON.stringify({ status: "created", id: "act_7f21c9" }, null, 2),
          },
          {
            status: 404,
            description: "Nessuno è raggiungibile a quel recapito",
            example: JSON.stringify({ error: "No person reachable at that contact point" }, null, 2),
          },
        ],
      },
      {
        id: "crm-custom-fields",
        method: "POST",
        path: "/api/crm/custom-fields",
        summary: "Registra i valori raccolti",
        description:
          "Scrive nei campi personalizzati che il workspace ha già definito, sulla scheda della persona.\n\n" +
          "⚠️ Non è la rotta delle annotazioni con un altro nome. Un valore raccolto — un budget, una data di consegna, una taglia — deve finire nel campo che le schermate mostrano e su cui i filtri lavorano, non dentro il testo di una nota dove nessuna vista lo troverà. Le chiavi di `fields` sono gli slug delle definizioni esistenti.",
        auth: "session",
        scope: "custom_fields:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Telefono o email della persona",
            example: "+39 333 111 2223",
          },
          {
            name: "fields",
            in: "body",
            required: true,
            type: "object",
            description:
              "Slug del campo → valore. Gli slug sono quelli definiti in Impostazioni → Campi personalizzati",
            example: '{ "budget": "8000", "consegna": "2026-10-15" }',
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            { contactPoint: "+39 333 111 2223", fields: { budget: "8000", consegna: "2026-10-15" } },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Valori scritti. `entity` dice se la persona è un lead o un contatto",
            example: JSON.stringify(
              { status: "updated", entity: "lead", id: "led_31ka9", fields: { budget: "8000" } },
              null,
              2,
            ),
          },
          {
            status: 404,
            description: "Nessuno è raggiungibile a quel recapito",
            example: JSON.stringify({ error: "No person reachable at that contact point" }, null, 2),
          },
        ],
      },
      {
        id: "crm-lead-stage",
        method: "POST",
        path: "/api/crm/leads/stage",
        summary: "Sposta un lead allo stadio a cui l'assistente l'ha portato",
        description:
          "Cambia **solo** lo stadio del lead raggiungibile a quel recapito, senza toccare " +
          "nient'altro della sua scheda.\n\n" +
          '⚠️ Non è l\'importazione con `onDuplicate: "update"`: quella **sostituisce** il ' +
          "lead con quello che le mandi, quindi un telefono e uno stadio azzererebbero " +
          "email, azienda e note. Importare è sostituire; dire «questo si è mosso» è " +
          "un'altra frase.\n\n" +
          "⚠️ Serve a questo: un assistente che ha raccolto quello che serve al preventivo " +
          "e passa la mano lo diceva **in prosa**, con una nota sulla cronologia. Una prosa " +
          "non è una coda. Spostando il lead, la richiesta compare dove il commerciale " +
          "guarda ogni mattina — l'elenco dei lead, filtrato per stadio.",
        auth: "session",
        scope: "leads:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Telefono o email della persona",
            example: "+39 333 111 2223",
          },
          {
            name: "status",
            in: "body",
            required: true,
            type: "string",
            description: "Lo stadio: new, contacting, engaged, qualified, unqualified",
            example: "qualified",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ contactPoint: "+39 333 111 2223", status: "qualified" }, null, 2),
        },
        responses: [
          {
            status: 200,
            description:
              "Spostato. `moved: false` con `already_a_contact` quando la persona è già " +
              "stata convertita: non c'è più uno stadio da muovere, e non è un errore",
            example: JSON.stringify({ status: "moved", moved: true, id: "led_31ka9" }, null, 2),
          },
          {
            status: 404,
            description: "Nessun lead è raggiungibile a quel recapito",
            example: JSON.stringify({ error: "No lead reachable at that contact point" }, null, 2),
          },
        ],
      },
      {
        id: "crm-orders",
        method: "POST",
        path: "/api/crm/orders",
        summary: "Registra un ordine raccolto",
        description:
          "Crea un ordine per la persona a quel recapito, dalle righe che l'integrazione ha raccolto.\n\n" +
          "⚠️ I totali NON si accettano dal chiamante: vengono ricalcolati qui dalle righe ricevute. Due sistemi che si accordano sull'aritmetica costano poco; un ordine con il totale sbagliato costa molto, e non si vede finché non lo si legge in fattura.",
        auth: "session",
        scope: "orders:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Telefono o email della persona",
            example: "+39 333 111 2223",
          },
          {
            name: "name",
            in: "body",
            required: false,
            type: "string",
            description: "Nome con cui la persona si è presentata, se non è già a sistema",
            example: "Anna",
          },
          {
            name: "lines",
            in: "body",
            required: true,
            type: "array",
            description: "Almeno una riga: `description`, `quantity`, `unitPrice`",
            example: '[{ "description": "Margherita", "quantity": 2, "unitPrice": 6.5 }]',
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              contactPoint: "+39 333 111 2223",
              name: "Anna",
              lines: [
                { description: "Margherita", quantity: 2, unitPrice: 6.5 },
                { description: "Coperto", quantity: 2, unitPrice: 2 },
              ],
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 201,
            description: "Ordine creato. I totali sono quelli ricalcolati qui",
            example: JSON.stringify({ status: "created", id: "ord_9c14be", total: "17.00" }, null, 2),
          },
          {
            status: 409,
            description:
              "⚠️ Hai mandato un totale e non corrisponde a quello calcolato dalle righe. La risposta riporta entrambi, così si vede dove sta la differenza senza rifare i conti a mano. L'ordine non viene creato.",
            example: JSON.stringify({ error: "Total mismatch", declared: "16.00", computed: "17.00" }, null, 2),
          },
        ],
      },
      {
        id: "crm-close",
        method: "POST",
        path: "/api/crm/close",
        summary: "Chiudi le trattative dopo il processo",
        description:
          "Chiude le trattative aperte della persona quando l'integrazione ha finito.\n\n" +
          "⚠️ I tre esiti descrivono IL PROCESSO DELL'INTEGRAZIONE, non la vendita. `RAGGIUNTO` significa che la persona ha risposto: la trattativa resta APERTA, perché ci penserà un umano. `ABBANDONATO` e `NON_RAGGIUNTO` chiudono come persa, e il motivo resta scritto per esteso sulla trattativa — «persa» è quanto di più vicino la pipeline sappia dire quando in realtà non si sa come sia finita.",
        auth: "session",
        scope: "deals:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Telefono o email della persona",
            example: "+39 333 111 2223",
          },
          {
            name: "outcome",
            in: "body",
            required: true,
            type: "string",
            description: "Esito del processo. Un valore diverso da questi tre viene rifiutato",
            enum: ["RAGGIUNTO", "ABBANDONATO", "NON_RAGGIUNTO"],
            example: "ABBANDONATO",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ contactPoint: "+39 333 111 2223", outcome: "ABBANDONATO" }, null, 2),
        },
        responses: [
          {
            status: 200,
            description: "Trattative chiuse. Con `RAGGIUNTO` la lista è vuota perché non si chiude niente",
            example: JSON.stringify({ status: "closed", ids: ["dea_18f2c0"] }, null, 2),
          },
          {
            status: 404,
            description: "Nessuna trattativa da chiudere per quel recapito",
            example: JSON.stringify({ error: "No deal to close for that contact point" }, null, 2),
          },
        ],
      },
      {
        id: "crm-opt-out",
        method: "POST",
        path: "/api/crm/opt-out",
        summary: "Registra che non vuole più essere contattata",
        description:
          "La persona ha detto all'integrazione di non essere più contattata.\n\n" +
          "⚠️ Vale su ENTRAMBI i consensi. Marketing e trattative erano due elenchi che non si parlavano: chi si toglieva da uno restava nell'altro, e continuava a ricevere. Questa rotta li tocca insieme, che è ciò che la persona intendeva dicendolo una volta sola.",
        auth: "session",
        scope: "privacy:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Telefono o email della persona",
            example: "+39 333 111 2223",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ contactPoint: "+39 333 111 2223" }, null, 2),
        },
        responses: [
          {
            status: 200,
            description: "Registrato. `ids` elenca i record messi a tacere",
            example: JSON.stringify({ status: "opted_out", ids: ["led_31ka9", "cnt_77bb1"] }, null, 2),
          },
          {
            status: 404,
            description: "Nessuno è raggiungibile a quel recapito",
            example: JSON.stringify({ error: "No person reachable at that contact point" }, null, 2),
          },
        ],
      },
      {
        id: "crm-erasure",
        method: "POST",
        path: "/api/crm/erasure",
        summary: "Cancellazione GDPR art. 17",
        description:
          "Cancella la persona raggiungibile a quel recapito.\n\n" +
          "⚠️ La risposta è un REPORT, non una conferma: dice cosa è stato cancellato, cosa è stato conservato con la persona tolta da dentro, e cosa è stato deliberatamente lasciato stare. Chi risponde all'interessato deve poter dire quale delle tre cose è successa a ciascun dato, e una conferma generica non glielo permette.\n\n" +
          "Con `preview: true` conta soltanto e non cancella niente: è come si guarda prima di premere.",
        auth: "session",
        scope: "privacy:write",
        parameters: [
          {
            name: "contactPoint",
            in: "body",
            required: true,
            type: "string",
            description: "Telefono o email della persona",
            example: "mario@acme.it",
          },
          {
            name: "preview",
            in: "body",
            required: false,
            type: "boolean",
            description: "Conta e non cancella. Assente vale `false`",
            example: "true",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ contactPoint: "mario@acme.it", preview: true }, null, 2),
        },
        responses: [
          {
            status: 200,
            description: "Conteggio, senza aver cancellato niente (`preview: true`)",
            example: JSON.stringify({ status: "preview", found: { leads: 1, contacts: 0, activities: 12 } }, null, 2),
          },
          {
            status: 200,
            description: "Cancellazione eseguita, con il report di cosa è successo a ciascuna cosa",
            example: JSON.stringify(
              {
                status: "erased",
                report: {
                  deleted: { lead: 1, activity: 12, task: 3 },
                  anonymised: { ticket: 2 },
                  kept: { order: "obbligo fiscale" },
                },
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  },
];

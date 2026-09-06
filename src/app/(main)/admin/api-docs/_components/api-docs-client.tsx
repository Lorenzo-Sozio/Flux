"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Lock,
  Mail,
  Search,
  Server,
  Shield,
  Terminal,
  UserPlus,
  Users,
  Webhook,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type AuthLevel = "public" | "session" | "admin" | "cron";

interface Param {
  name: string;
  in: "query" | "path" | "body" | "form" | "header";
  required: boolean;
  type: string;
  description: string;
  example?: string;
  enum?: string[];
}

interface ApiEndpoint {
  id: string;
  method: Method;
  path: string;
  summary: string;
  description: string;
  auth: AuthLevel;
  parameters?: Param[];
  requestBody?: { contentType: string; example: string };
  responses: Array<{ status: number; description: string; example: string }>;
}

interface ApiGroup {
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
const CRM_COMMON_RESPONSES: ApiEndpoint["responses"] = [
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
 * The responses common to every route guarded by `CRON_SECRET`.
 *
 * ⚠️ The 500 is not theoretical: with `CRON_SECRET` unset on the server every job
 * answers 500 for ever and none of them run. Worth knowing in advance.
 */
const CRON_COMMON_RESPONSES: ApiEndpoint["responses"] = [
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
 * ⚠️ The bulk variants do not return 422. A rejected row does not fail the request: the
 * answer is 200 and the error sits inside `results`, row by row.
 * Documentare un 422 su di esse manderebbe chi integra a cercare un codice di
 * status that never arrives, instead of inside the body where it actually is.
 */
function responsesFor(endpoint: ApiEndpoint): ApiEndpoint["responses"] {
  const isCrm = endpoint.path.startsWith("/api/crm/");
  const isCron = endpoint.path.startsWith("/api/cron/");
  if (!isCrm && !isCron) return endpoint.responses;

  // ⚠️ Opt-out and erasure are not metered against the plan and therefore never answer
  // 429. That is a choice: refusing an opt-out because the plan is
  // esaurito significa continuare a contattare chi ha chiesto di smettere, e
  // refusing an erasure means missing a deadline that is not ours to move. Neither is a
  // billing decision.
  const UNMETERED = ["/api/crm/opt-out", "/api/crm/erasure"];

  const common = isCron
    ? CRON_COMMON_RESPONSES
    : CRM_COMMON_RESPONSES.filter(
        (r) =>
          !(endpoint.path.endsWith("/bulk") && r.status === 422) &&
          !(UNMETERED.includes(endpoint.path) && r.status === 429),
      );

  const declared = new Set(endpoint.responses.map((r) => r.status));
  return [...endpoint.responses, ...common.filter((r) => !declared.has(r.status))].sort((a, b) => a.status - b.status);
}

// ─── Data ──────────────────────────────────────────────────────────────────────

const GROUPS: ApiGroup[] = [
  {
    id: "authentication",
    label: "Authentication",
    icon: Lock,
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    description:
      "Ci sono tre credenziali e non sono intercambiabili.\n\n" +
      "1. CHIAVE DEL WORKSPACE — è così che si autentica un'integrazione, ed è la via normale per tutto ciò che sta sotto /api/crm. Si passa come `Authorization: Bearer <chiave>` e si genera dal workspace stesso, in Impostazioni → Chiavi API.\n" +
      "⚠️ Il workspace è una proprietà della chiave, non della richiesta: `X-Tenant-ID` non serve, e un `X-Tenant-ID` che ne indica un altro fa fallire la chiamata con 401 invece di essere ignorato. Ignorarlo lascerebbe un'integrazione mal configurata scrivere allegramente nel proprio workspace mentre chi l'ha configurata crede stia scrivendo in un altro, e non lo scoprirebbe nessuno finché un messaggio non arriva al cliente sbagliato.\n\n" +
      "2. CHIAVE DI PIATTAFORMA (`IMPORT_API_KEY`) — la sola credenziale che può nominare un workspace qualsiasi, ed è di Flux, non del cliente. Anche questa come `Authorization: Bearer <chiave>`, ma richiede `X-Tenant-ID` con l'identificativo del workspace di destinazione, validato contro il registro. Senza quell'header si riceve 400 `Tenant context required`; con un identificativo che non esiste, 404.\n\n" +
      "3. SESSIONE — il cookie HttpOnly `authjs.session-token` di NextAuth v5, cioè il modo in cui il prodotto chiama sé stesso dal browser. Il workspace viene dal JWT e il proxy inietta `x-tenant-id` internamente; lo stesso header inviato dal client non viene mai creduto.\n" +
      "⚠️ Il diritto di scrivere lo decide il ruolo nel WORKSPACE, non quello di piattaforma: un membro `viewer` è in sola lettura anche qui e riceve 401, esattamente come nell'interfaccia.\n\n" +
      "Un `Authorization: Bearer` presente ma non valido si ferma lì: non viene mai promosso a sessione dal cookie che casualmente accompagna la richiesta.\n\n" +
      "Fuori da /api/crm: i cron usano `Authorization: Bearer <CRON_SECRET>`, un segreto a parte. I webhook di terze parti (Stripe, Resend) si verificano dalla firma del payload, non da una nostra chiave. Il feed calendario porta un token firmato dentro l'indirizzo, perché un programma di calendario non sa fare login. Il verso opposto — un calendario esterno letto qui dentro — non è una rotta: l'indirizzo si salva dalle impostazioni del calendario e viene riletto dal server ogni quindici minuti.",
    isInfoOnly: true,
    endpoints: [],
  },
  {
    id: "tenant",
    label: "Multi-tenancy & Routing",
    icon: Globe,
    color: "text-cyan-600",
    bg: "bg-cyan-50",
    border: "border-cyan-200",
    description:
      "Flux CRM è un'applicazione multi-tenant a dominio singolo: ogni organizzazione ha il proprio database isolato e tutti i tenant condividono lo stesso dominio (app.fluxcrm.com). Il tenant attivo viene identificato dal JWT di sessione (campo activeTenantId) — il middleware inietta l'header interno x-tenant-id dopo aver verificato la firma del token, rendendo impossibile la falsificazione lato client. Dopo il login, se l'utente appartiene a un solo workspace viene selezionato automaticamente; se appartiene a più workspace viene mostrata la pagina /select-tenant. Il cambio workspace aggiorna il JWT tramite session.update(). Un workspace che non esiste fa fallire una pagina della dashboard con 500 (TENANT_NOT_FOUND), perché lì è un errore di sistema e non un dato in ingresso; le rotte /api/crm invece lo controllano e rispondono 404, perché lì l'identificativo arriva da chi chiama.\n\n" +
      "⚠️ Tutto questo descrive la SESSIONE. Un'integrazione non ha un JWT: il suo workspace viene dalla credenziale, e la sezione Authentication dice come. Il proprietario dei record segue la stessa distinzione — con la sessione il record nasce assegnato a chi ha chiamato, con una chiave API nasce senza proprietario, perché una chiave non è una persona.",
    isInfoOnly: true,
    endpoints: [],
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: Users,
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    description: "Importazione ed esportazione dei dati dei contatti in formato CSV.",
    endpoints: [
      {
        id: "contacts-export",
        method: "GET",
        path: "/api/contacts/export",
        summary: "Esporta contatti come CSV",
        description:
          "Restituisce tutti i contatti visibili all'utente autenticato come file CSV allegato. Admin e Owner vedono tutti i contatti; Editor e Viewer vedono solo i propri.",
        auth: "session",
        responses: [
          {
            status: 200,
            description: "CSV file — Content-Disposition: attachment",
            example: `id,firstName,lastName,email,phone,jobTitle,company,status,source,leadScore,tags,createdAt\n"cnt_01JX","Mario","Rossi","mario@example.com","+39 02 1234567","CEO","Acme Srl","active","referral",85,"partner;vip","2025-01-15T10:30:00.000Z"`,
          },
          {
            status: 401,
            description: "Sessione non trovata o scaduta",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
      {
        id: "contacts-import",
        method: "POST",
        path: "/api/contacts/import",
        summary: "Importa contatti da CSV",
        description:
          "Accetta un file CSV tramite `multipart/form-data` e importa i contatti in bulk. I duplicati (rilevati per email) vengono saltati. Restituisce un riepilogo delle righe importate, saltate ed errate.",
        auth: "session",
        parameters: [
          {
            name: "file",
            in: "form",
            required: true,
            type: "File (text/csv)",
            description: "File CSV con i dati dei contatti. Colonna `email` obbligatoria.",
            example: "contacts.csv",
          },
        ],
        requestBody: {
          contentType: "multipart/form-data",
          example: `curl -X POST /api/contacts/import \\\n  -H "Cookie: authjs.session-token=..." \\\n  -F "file=@contacts.csv;type=text/csv"`,
        },
        responses: [
          {
            status: 429,
            description: "Troppe importazioni ravvicinate dallo stesso indirizzo",
            example: '{\n  "error": "Too many imports. Try again in 10 minutes."\n}',
          },
          {
            status: 200,
            description: "Import completato",
            example: JSON.stringify({ imported: 42, skipped: 3, errors: ["Row 7: formato email non valido"] }, null, 2),
          },
          {
            status: 400,
            description: "File mancante o formato CSV non valido",
            example: JSON.stringify({ error: "No file provided or invalid CSV format." }, null, 2),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "companies",
    label: "Companies",
    icon: Building2,
    color: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    description: "Importazione ed esportazione dei dati delle aziende in formato CSV.",
    endpoints: [
      {
        id: "companies-export",
        method: "GET",
        path: "/api/companies/export",
        summary: "Esporta aziende come CSV",
        description:
          "Restituisce tutte le aziende dell'organizzazione come file CSV allegato. Richiede sessione autenticata.",
        auth: "session",
        responses: [
          {
            status: 200,
            description: "CSV file",
            example: `id,name,industry,website,employees,country,city,status,createdAt\n"cmp_01JX","Acme Srl","Technology","https://acme.it","50","IT","Milano","active","2025-01-10T09:00:00.000Z"`,
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
      {
        id: "companies-import",
        method: "POST",
        path: "/api/companies/import",
        summary: "Importa aziende da CSV",
        description:
          "Accetta un file CSV e importa le aziende in bulk. I duplicati vengono rilevati per nome aziendale.",
        auth: "session",
        parameters: [
          {
            name: "file",
            in: "form",
            required: true,
            type: "File (text/csv)",
            description: "CSV con le colonne delle aziende.",
            example: "companies.csv",
          },
        ],
        requestBody: {
          contentType: "multipart/form-data",
          example: `curl -X POST /api/companies/import \\\n  -H "Cookie: authjs.session-token=..." \\\n  -F "file=@companies.csv;type=text/csv"`,
        },
        responses: [
          {
            status: 429,
            description: "Troppe importazioni ravvicinate dallo stesso indirizzo",
            example: '{\n  "error": "Too many imports. Try again later."\n}',
          },
          {
            status: 200,
            description: "Import completato",
            example: JSON.stringify({ imported: 15, skipped: 2, errors: [] }, null, 2),
          },
          {
            status: 400,
            description: "File non valido",
            example: JSON.stringify({ error: "No file provided." }, null, 2),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    icon: UserPlus,
    color: "text-green-600",
    bg: "bg-green-50",
    border: "border-green-200",
    description: "Esportazione dei lead in formato CSV.",
    endpoints: [
      {
        id: "leads-export",
        method: "GET",
        path: "/api/leads/export",
        summary: "Esporta lead come CSV",
        description:
          "Restituisce tutti i lead visibili all'utente come file CSV allegato. Admin e Owner vedono tutti i lead; gli altri vedono solo i propri.",
        auth: "session",
        responses: [
          {
            status: 200,
            description: "CSV file",
            example: `id,firstName,lastName,email,companyName,status,source,score,assignedTo,createdAt\n"led_01JX","Anna","Bianchi","anna@startup.io","StartupIO","new","website",72,"user_abc","2025-03-01T14:00:00.000Z"`,
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    icon: FileText,
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    description:
      "Gestione degli allegati associati alle entità CRM (contatti, lead, aziende, deal, ticket). I file sono memorizzati fuori dalla cartella pubblica e serviti tramite route autenticata.",
    endpoints: [
      {
        id: "documents-list",
        method: "GET",
        path: "/api/documents",
        summary: "Elenca documenti per entità",
        description:
          "Restituisce la lista dei documenti allegati a una specifica entità CRM, ordinati per data di creazione.",
        auth: "session",
        parameters: [
          {
            name: "entityType",
            in: "query",
            required: true,
            type: "string",
            description: "Tipo di entità CRM.",
            example: "contact",
            enum: ["contact", "lead", "company", "deal", "ticket"],
          },
          {
            name: "entityId",
            in: "query",
            required: true,
            type: "string",
            description: "ID dell'entità (alfanumerico, max 128 caratteri).",
            example: "cnt_01JX4K",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Lista documenti",
            example: JSON.stringify(
              {
                documents: [
                  {
                    id: "doc_01",
                    name: "contratto.pdf",
                    mimeType: "application/pdf",
                    size: 204800,
                    entityType: "contact",
                    entityId: "cnt_01JX4K",
                    ownerId: "usr_abc",
                    createdAt: "2025-04-10T09:00:00.000Z",
                  },
                ],
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Tipo o ID entità non valido",
            example: JSON.stringify({ error: "Invalid entity type." }, null, 2),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
      {
        id: "documents-upload",
        method: "POST",
        path: "/api/documents/upload",
        summary: "Carica un documento",
        description:
          "Carica un file e lo associa a un'entità CRM. Il file viene verificato tramite magic bytes, tipo MIME e estensione. Dimensione massima: 10 MB. Formati accettati: PDF, JPEG, PNG, GIF, WebP, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV. Il file non è mai accessibile pubblicamente.",
        auth: "session",
        parameters: [
          {
            name: "file",
            in: "form",
            required: true,
            type: "File",
            description: "Il file da caricare (max 10 MB, MIME type nella whitelist).",
            example: "contratto.pdf",
          },
          {
            name: "entityType",
            in: "form",
            required: true,
            type: "string",
            description: "Tipo di entità CRM.",
            example: "contact",
            enum: ["contact", "lead", "company", "deal"],
          },
          {
            name: "entityId",
            in: "form",
            required: true,
            type: "string",
            description: "ID dell'entità a cui allegare il file.",
            example: "cnt_01JX4K",
          },
        ],
        requestBody: {
          contentType: "multipart/form-data",
          example: `curl -X POST /api/documents/upload \\\n  -H "Cookie: authjs.session-token=..." \\\n  -F "file=@contratto.pdf;type=application/pdf" \\\n  -F "entityType=contact" \\\n  -F "entityId=cnt_01JX4K"`,
        },
        responses: [
          {
            status: 401,
            description: "Sessione assente",
            example: '{\n  "error": "Unauthorized"\n}',
          },
          {
            status: 402,
            description:
              "⚠️ Spazio del piano esaurito: il file non viene salvato finché non si libera spazio o si cambia piano",
            example: '{\n  "error": "Storage limit reached for your plan."\n}',
          },
          {
            status: 500,
            description: "Il salvataggio nello store non è riuscito",
            example: '{\n  "error": "Upload failed. Please try again."\n}',
          },
          {
            status: 200,
            description: "Upload completato",
            example: JSON.stringify(
              {
                success: true,
                document: {
                  id: "doc_02",
                  name: "contratto.pdf",
                  mimeType: "application/pdf",
                  size: 204800,
                  entityType: "contact",
                  entityId: "cnt_01JX4K",
                  ownerId: "usr_abc",
                  createdAt: "2025-04-10T09:30:00.000Z",
                },
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "File mancante o parametri non validi",
            example: JSON.stringify({ error: "No file provided." }, null, 2),
          },
          {
            status: 413,
            description: "File troppo grande (max 10 MB)",
            example: JSON.stringify({ error: "File too large (max 10 MB)." }, null, 2),
          },
          {
            status: 415,
            description: "MIME type non supportato o magic bytes mismatch",
            example: JSON.stringify({ error: 'File type "text/html" is not allowed.' }, null, 2),
          },
        ],
      },
      {
        id: "documents-delete",
        method: "DELETE",
        path: "/api/documents",
        summary: "Elimina un documento",
        description:
          "Elimina un documento per ID. Solo il proprietario del documento può eliminarlo. Il file viene rimosso anche dal disco.",
        auth: "session",
        parameters: [
          {
            name: "id",
            in: "query",
            required: true,
            type: "string",
            description: "ID del documento da eliminare.",
            example: "doc_02",
          },
        ],
        responses: [
          {
            status: 400,
            description: "`id` assente o non valido",
            example: '{\n  "error": "Invalid document ID."\n}',
          },
          {
            status: 401,
            description: "Sessione assente",
            example: '{\n  "error": "Unauthorized"\n}',
          },
          {
            status: 403,
            description: "Il documento appartiene a un altro workspace",
            example: '{\n  "error": "Forbidden."\n}',
          },
          {
            status: 404,
            description: "Nessun documento con quell'id",
            example: '{\n  "error": "Document not found."\n}',
          },
          {
            status: 200,
            description: "Eliminazione completata",
            example: JSON.stringify({ success: true }, null, 2),
          },
          {
            status: 403,
            description: "L'utente non è il proprietario del documento",
            example: JSON.stringify({ error: "Forbidden." }, null, 2),
          },
          {
            status: 404,
            description: "Documento non trovato",
            example: JSON.stringify({ error: "Document not found." }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "search",
    label: "Search",
    icon: Search,
    color: "text-sky-600",
    bg: "bg-sky-50",
    border: "border-sky-200",
    description: "Ricerca globale full-text su tutte le entità CRM.",
    endpoints: [
      {
        id: "global-search",
        method: "GET",
        path: "/api/search",
        summary: "Ricerca globale",
        description:
          "Esegue una ricerca case-insensitive su contatti, lead, aziende, deal, ticket, preventivi e ordini. Restituisce fino a 5 risultati per tipo. La query deve essere di almeno 2 caratteri.",
        auth: "session",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            type: "string",
            description: "Termine di ricerca (minimo 2 caratteri).",
            example: "Mario Rossi",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Risultati raggruppati per tipo di entità",
            example: JSON.stringify(
              {
                results: {
                  contacts: [
                    {
                      id: "cnt_01JX",
                      label: "Mario Rossi",
                      sub: "mario@example.com",
                      url: "/dashboard/contacts/cnt_01JX",
                      entity: "contact",
                    },
                  ],
                  leads: [],
                  companies: [
                    {
                      id: "cmp_01JX",
                      label: "Acme Srl",
                      sub: "Technology",
                      url: "/dashboard/companies/cmp_01JX",
                      entity: "company",
                    },
                  ],
                  deals: [],
                  tickets: [],
                  quotes: [],
                  orders: [],
                },
              },
              null,
              2,
            ),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    description: "Endpoint di polling per le notifiche dell'utente corrente.",
    endpoints: [
      {
        id: "notifications-list",
        method: "GET",
        path: "/api/notifications",
        summary: "Elenca le notifiche utente",
        description:
          "Restituisce le ultime 50 notifiche dell'utente autenticato, ordinate dalla più recente. Usato dal NotificationCenter con polling ogni 60 secondi.",
        auth: "session",
        responses: [
          {
            status: 200,
            description: "Lista notifiche",
            example: JSON.stringify(
              {
                notifications: [
                  {
                    id: "ntf_01",
                    type: "deal_won",
                    title: "Deal vinto!",
                    body: "Il deal 'Acme Enterprise' è stato chiuso.",
                    read: false,
                    createdAt: "2025-05-10T14:30:00.000Z",
                  },
                  {
                    id: "ntf_02",
                    type: "ticket_assigned",
                    title: "Ticket assegnato",
                    body: "Il ticket #TKT-0042 è stato assegnato a te.",
                    read: true,
                    createdAt: "2025-05-09T10:00:00.000Z",
                  },
                ],
              },
              null,
              2,
            ),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "quotes",
    label: "Quotes (Public)",
    icon: FileText,
    color: "text-teal-600",
    bg: "bg-teal-50",
    border: "border-teal-200",
    description:
      "Endpoint pubblici per la visualizzazione e l'accettazione dei preventivi da parte dei clienti. Nessuna autenticazione richiesta — il token univoco funge da identificatore sicuro.",
    endpoints: [
      {
        id: "quotes-public-get",
        method: "GET",
        path: "/api/quotes/public",
        summary: "Visualizza preventivo per token",
        description:
          "Restituisce il preventivo associato al token pubblico. Se lo stato è `sent`, il preventivo viene automaticamente marcato come `viewed` con timestamp e IP registrati.",
        auth: "public",
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            type: "string",
            description: "Token univoco pubblico del preventivo.",
            example: "qt_pTkXz3mNR9aQv8",
          },
        ],
        responses: [
          {
            status: 429,
            description: "Troppe richieste per lo stesso token",
            example: '{\n  "error": "Too many requests"\n}',
          },
          {
            status: 200,
            description: "Preventivo con items, contatto e azienda",
            example: JSON.stringify(
              {
                quote: {
                  id: "quo_01",
                  quoteNumber: "QUO-2025-0042",
                  status: "viewed",
                  total: 12500,
                  currency: "EUR",
                  validUntil: "2025-06-30T00:00:00.000Z",
                  contact: { firstName: "Mario", lastName: "Rossi" },
                  company: { name: "Acme Srl" },
                  items: [
                    {
                      description: "Licenza CRM annuale",
                      quantity: 5,
                      unitPrice: 2500,
                      total: 12500,
                    },
                  ],
                },
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Token mancante",
            example: JSON.stringify({ error: "Missing token" }, null, 2),
          },
          {
            status: 404,
            description: "Preventivo non trovato",
            example: JSON.stringify({ error: "Not found" }, null, 2),
          },
        ],
      },
      {
        id: "quotes-public-post",
        method: "POST",
        path: "/api/quotes/public",
        summary: "Accetta o rifiuta un preventivo",
        description:
          "Permette al cliente di accettare o rifiutare un preventivo tramite token pubblico. L'azione viene registrata con timestamp e IP. Il preventivo deve essere in stato `sent` o `viewed`.",
        auth: "public",
        parameters: [
          {
            name: "token",
            in: "body",
            required: true,
            type: "string",
            description: "Token pubblico del preventivo.",
            example: "qt_pTkXz3mNR9aQv8",
          },
          {
            name: "action",
            in: "body",
            required: true,
            type: "string",
            description: "Azione da eseguire.",
            example: "accepted",
            enum: ["accepted", "declined"],
          },
          {
            name: "reason",
            in: "body",
            required: false,
            type: "string",
            description: "Motivazione del rifiuto (solo per `action: declined`).",
            example: "Budget non disponibile per il Q3.",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ token: "qt_pTkXz3mNR9aQv8", action: "accepted" }, null, 2),
        },
        responses: [
          {
            status: 404,
            description: "Token sconosciuto, oppure il preventivo non esiste piu'",
            example: '{\n  "error": "Not found"\n}',
          },
          {
            status: 409,
            description:
              "Il preventivo non è più in uno stato che ammette una risposta: già accettato, rifiutato, o scaduto",
            example: '{\n  "error": "Quote cannot be actioned in its current status"\n}',
          },
          {
            status: 429,
            description: "Troppe richieste per lo stesso token",
            example: '{\n  "error": "Too many requests"\n}',
          },
          {
            status: 200,
            description: "Azione registrata",
            example: JSON.stringify({ success: true }, null, 2),
          },
          {
            status: 400,
            description: "Token o azione non valida",
            example: JSON.stringify({ error: "Invalid request" }, null, 2),
          },
          {
            status: 409,
            description: "Il preventivo non è in uno stato azionabile",
            example: JSON.stringify({ error: "Quote cannot be actioned in its current status" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "currency-geo",
    label: "Currency & Geo",
    icon: Globe,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    description:
      "Endpoint di riferimento per tassi di cambio e dati geografici (paesi e città). I tassi di cambio sono cachati nel database per 6 ore.",
    endpoints: [
      {
        id: "currency-rates-get",
        method: "GET",
        path: "/api/currency/rates",
        summary: "Tassi di cambio EUR",
        description:
          "Restituisce i tassi di cambio correnti con base EUR (forniti dall'API Fawaz, DB-cached 6h). Supporta l'header opzionale `X-Currency` per validare una valuta specifica. La risposta è cachata lato CDN per 1 ora.",
        auth: "public",
        parameters: [
          {
            name: "X-Currency",
            in: "header",
            required: false,
            type: "string",
            description: "Codice ISO 4217 della valuta da validare (es. USD, GBP, JPY).",
            example: "USD",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Tassi di cambio (Cache-Control: public, s-maxage=3600)",
            example: JSON.stringify(
              {
                rates: { usd: 1.0831, gbp: 0.8612, jpy: 163.42, chf: 0.9721 },
                baseCurrency: "EUR",
                fetchedAt: "2025-05-15T08:00:00.000Z",
                requestedCurrency: "USD",
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Valuta non trovata nei tassi",
            example: JSON.stringify({ error: "Currency XYZ not found in rates" }, null, 2),
          },
          {
            status: 503,
            description: "Servizio tassi di cambio non disponibile",
            example: JSON.stringify({ error: "Failed to fetch exchange rates" }, null, 2),
          },
        ],
      },
      {
        id: "currency-convert",
        method: "POST",
        path: "/api/currency/rates",
        summary: "Converti importo tra valute",
        description:
          "Converte un importo da una valuta a un'altra usando i tassi correnti (EUR come pivot). Il risultato è calcolato in tempo reale.",
        auth: "public",
        parameters: [
          {
            name: "amount",
            in: "body",
            required: true,
            type: "number",
            description: "Importo da convertire.",
            example: "1000",
          },
          {
            name: "from",
            in: "body",
            required: true,
            type: "string",
            description: "Valuta sorgente (ISO 4217).",
            example: "USD",
          },
          {
            name: "to",
            in: "body",
            required: true,
            type: "string",
            description: "Valuta destinazione (ISO 4217).",
            example: "GBP",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ amount: 1000, from: "USD", to: "GBP" }, null, 2),
        },
        responses: [
          {
            status: 503,
            description: "Il fornitore dei tassi di cambio non risponde",
            example: '{\n  "error": "Failed to fetch exchange rates"\n}',
          },
          {
            status: 200,
            description: "Importo convertito",
            example: JSON.stringify({ amount: 795.52, from: "USD", to: "GBP", rate: 0.79552 }, null, 2),
          },
          {
            status: 400,
            description: "Parametri mancanti o valuta sconosciuta",
            example: JSON.stringify({ error: "amount, from, and to are required" }, null, 2),
          },
        ],
      },
      {
        id: "geo-countries",
        method: "GET",
        path: "/api/geo/countries",
        summary: "Lista paesi",
        description:
          "Restituisce la lista dei paesi disponibili nel sistema, usata per i form di indirizzo in tutto il CRM.",
        auth: "session",
        responses: [
          {
            status: 200,
            description: "Array di paesi",
            example: JSON.stringify(
              [
                { code: "IT", name: "Italy" },
                { code: "DE", name: "Germany" },
                { code: "FR", name: "France" },
              ],
              null,
              2,
            ),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
      {
        id: "geo-cities",
        method: "GET",
        path: "/api/geo/cities",
        summary: "Lista città per paese",
        description:
          "Restituisce le città associate a un paese specifico, usata per l'autocompletamento dei form di indirizzo.",
        auth: "session",
        parameters: [
          {
            name: "country",
            in: "query",
            required: true,
            type: "string",
            description: "Codice ISO 3166-1 alpha-2 del paese.",
            example: "IT",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Array di città",
            example: JSON.stringify([{ name: "Milano" }, { name: "Roma" }, { name: "Napoli" }], null, 2),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "appointments",
    label: "Appointments",
    icon: Clock,
    color: "text-pink-600",
    bg: "bg-pink-50",
    border: "border-pink-200",
    description: "Endpoint pubblici per la gestione delle risposte RSVP agli appuntamenti tramite link email.",
    endpoints: [
      {
        id: "appointments-rsvp",
        method: "GET",
        path: "/api/appointments/rsvp",
        summary: "Risposta RSVP appuntamento",
        description:
          "Gestisce la risposta RSVP di un partecipante tramite link email. Aggiorna il database e restituisce una pagina HTML di conferma. Non richiede autenticazione — il token funge da credenziale sicura monouso.",
        auth: "public",
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            type: "string",
            description: "Token RSVP univoco inviato via email.",
            example: "rsvp_abc123def456",
          },
          {
            name: "r",
            in: "query",
            required: true,
            type: "string",
            description: "Risposta del partecipante.",
            example: "accept",
            enum: ["accept", "decline", "tentative"],
          },
        ],
        responses: [
          {
            status: 200,
            description: "Risposta registrata — restituisce pagina HTML di conferma (text/html)",
            example: `<!-- Content-Type: text/html -->\n<!DOCTYPE html>\n<html lang="it">\n  <body>\n    <h1>✓ Partecipazione confermata</h1>\n    <p>La tua risposta è stata registrata.</p>\n    <a href="/dashboard/calendar">Vai al calendario</a>\n  </body>\n</html>`,
          },
          {
            status: 400,
            description: "Token non valido, scaduto o risposta non riconosciuta — HTML di errore",
            example: `<!-- Content-Type: text/html -->\n<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Errore</h1>\n    <p>Link non valido o scaduto.</p>\n  </body>\n</html>`,
          },
        ],
      },
    ],
  },
  {
    id: "tracking",
    label: "Marketing Tracking",
    icon: Mail,
    color: "text-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
    description:
      "Endpoint di tracking per le campagne email: aperture (pixel), click e disiscrizioni. Non richiedono autenticazione — operano su token o ID di log.",
    endpoints: [
      {
        id: "track-click",
        method: "GET",
        path: "/api/track/click",
        summary: "Track click su link email",
        description:
          "Registra il click su un link di una campagna email e reindirizza l'utente all'URL destinazione. Aggiorna il log con stato `clicked` solo al primo click. Protegge da Open Redirect: accetta solo URL con schema `http` o `https`.",
        auth: "public",
        parameters: [
          {
            name: "log",
            in: "query",
            required: false,
            type: "string",
            description: "ID del log di campagna da aggiornare.",
            example: "clog_01JX4K",
          },
          {
            name: "url",
            in: "query",
            required: true,
            type: "string",
            description: "URL di destinazione (URL-encoded, schema http/https obbligatorio).",
            example: "https%3A%2F%2Facme.com%2Flanding",
          },
        ],
        responses: [
          {
            status: 302,
            description: "Redirect HTTP verso l'URL destinazione",
            example: `HTTP/1.1 302 Found\nLocation: https://acme.com/landing`,
          },
          {
            status: 400,
            description: "URL mancante, non valido o schema non consentito",
            example: JSON.stringify({ error: "Invalid url" }, null, 2),
          },
        ],
      },
      {
        id: "track-open",
        method: "GET",
        path: "/api/track/open",
        summary: "Track apertura email (pixel)",
        description:
          "Registra l'apertura di un'email di campagna tramite pixel di tracciamento 1×1. Restituisce un'immagine GIF trasparente (43 bytes). Aggiorna il log con stato `opened` solo alla prima apertura.",
        auth: "public",
        parameters: [
          {
            name: "log",
            in: "query",
            required: true,
            type: "string",
            description: "ID del log di campagna.",
            example: "clog_01JX4K",
          },
        ],
        responses: [
          {
            status: 200,
            description: "GIF trasparente 1×1 (Content-Type: image/gif)",
            example: `HTTP/1.1 200 OK\nContent-Type: image/gif\nContent-Length: 43\n\n[Binary GIF data — 43 bytes]`,
          },
        ],
      },
      {
        id: "unsubscribe",
        method: "GET",
        path: "/api/unsubscribe",
        summary: "Disiscrizione da campagne marketing",
        description:
          "Gestisce la disiscrizione di un contatto dalle comunicazioni marketing tramite token sicuro. Imposta `marketingConsent = false` e registra l'evento nel log campagna. Restituisce una pagina HTML di conferma.",
        auth: "public",
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            type: "string",
            description: "Token di disiscrizione univoco incluso nelle email.",
            example: "unsub_xyz789abc",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Disiscrizione confermata — pagina HTML (text/html)",
            example: `<!-- Content-Type: text/html -->\n<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Disiscrizione completata</h1>\n    <p>Non riceverai più comunicazioni marketing.</p>\n  </body>\n</html>`,
          },
          {
            status: 200,
            description:
              "⚠️ Anche con un token non valido o già usato. Questa rotta la apre una persona da un client di posta, non un programma: la pagina cambia, il codice di stato no. Non c'è nessun 4xx da intercettare.",
            example: `<!-- Content-Type: text/html -->\n<html>\n  <body>\n    <h1>Link non valido</h1>\n  </body>\n</html>`,
          },
        ],
      },
    ],
  },
  {
    id: "webhooks",
    label: "Webhooks",
    icon: Webhook,
    color: "text-purple-600",
    bg: "bg-purple-50",
    border: "border-purple-200",
    description:
      "Endpoint per ricevere notifiche da servizi terzi. Ogni webhook verifica la firma/autenticità prima dell'elaborazione. Non richiedono sessione utente.",
    endpoints: [
      {
        id: "webhooks-stripe",
        method: "POST",
        path: "/api/webhooks/stripe",
        summary: "Webhook Stripe",
        description:
          "Riceve gli eventi di Stripe e aggiorna le sottoscrizioni nel database. Verifica la firma HMAC tramite `STRIPE_WEBHOOK_SECRET`. Implementa idempotenza con la tabella `billing_stripe_events`. Elabora: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_succeeded`, `invoice.payment_failed`.",
        auth: "cron",
        parameters: [
          {
            name: "stripe-signature",
            in: "header",
            required: true,
            type: "string",
            description: "Firma HMAC generata da Stripe per verificare l'autenticità.",
            example: "t=1715760000,v1=abc123def456...",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              id: "evt_1QabcXYZ",
              type: "customer.subscription.updated",
              data: {
                object: {
                  id: "sub_1QabcXYZ",
                  status: "active",
                  customer: "cus_NxYz123",
                  items: { data: [{ price: { id: "price_1QabcPro" } }] },
                },
              },
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Evento elaborato con successo",
            example: JSON.stringify({ received: true }, null, 2),
          },
          {
            status: 400,
            description: "Firma non valida o payload malformato",
            example: JSON.stringify({ error: "Webhook signature verification failed" }, null, 2),
          },
          {
            status: 500,
            description: "Errore interno — Stripe ritenterà automaticamente per 7 giorni",
            example: JSON.stringify({ error: "Internal processing error" }, null, 2),
          },
        ],
      },
      {
        id: "webhooks-resend",
        method: "POST",
        path: "/api/webhooks/resend",
        summary: "Webhook Resend (email events)",
        description:
          "Riceve gli eventi di delivery da Resend (`email.sent`, `email.delivered`, `email.bounced`, `email.complained`) e aggiorna i log delle campagne marketing. Verifica la firma con il secret Resend.",
        auth: "cron",
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              type: "email.bounced",
              data: {
                email_id: "msg_01HxYZ",
                to: ["mario@example.com"],
                from: "noreply@flux.io",
              },
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 401,
            description: "Firma del payload non valida",
            example: '{\n  "error": "Invalid signature"\n}',
          },
          {
            status: 500,
            description: "`RESEND_WEBHOOK_SECRET` non configurato sul server",
            example: '{\n  "error": "Webhook not configured"\n}',
          },
          {
            status: 200,
            description: "Evento elaborato",
            example: JSON.stringify({ ok: true }, null, 2),
          },
          {
            status: 400,
            description: "Firma o payload non valido",
            example: JSON.stringify({ error: "Invalid signature" }, null, 2),
          },
        ],
      },
      {
        id: "webhooks-inbound",
        method: "POST",
        path: "/api/webhooks/email-inbound",
        summary: "Email in entrata — ponte generico",
        description:
          "Riceve un'email già normalizzata da un ponte SMTP→webhook: Cloudmailin, Mailgun, SendGrid Inbound Parse o qualunque altro. Resend ha una rotta propria, `/api/webhooks/resend-inbound`, perché firma diversamente.\n\n" +
          "Due cose vengono decise qui, ed è utile non confonderle.\n\n" +
          "IL TICKET si riconosce dall'OGGETTO, non dal destinatario: si cerca un riferimento della forma `[TKT-202604-E8CF49]`. Se c'è, il messaggio si accoda a quel ticket; se non c'è, ne nasce uno nuovo. Per questo un client di posta che riscrive l'oggetto spezza il thread.\n\n" +
          "IL WORKSPACE si ricava dal riferimento del ticket quando c'è, altrimenti dal campo `to`: è il workspace configurato per spedire da quell'indirizzo (Impostazioni → Email). ⚠️ Per questo `to` è obbligatorio: senza, una prima email non appartiene a nessuno. Vengono provati tutti i destinatari, non solo il primo, perché il cliente spesso scrive a una persona e mette il supporto in copia.\n\n" +
          "Il mittente viene cercato fra i contatti per email e, se non c'è, ne viene creato uno con `source: \"email_inbound\"`. Gli allegati vengono salvati solo se il tipo è fra quelli ammessi e sotto i 10 MB; l'estensione viene dal tipo MIME e mai dal nome del file.",
        auth: "public",
        parameters: [
          {
            name: "X-Webhook-Secret",
            in: "header",
            required: true,
            type: "string",
            description: "Deve valere esattamente `INBOUND_EMAIL_SECRET`. Non è il segreto dei cron.",
            example: "9f2c8ab1d4e07b635c81af92",
          },
          {
            name: "from",
            in: "body",
            required: true,
            type: "string",
            description: "Mittente, anche con nome visualizzato",
            example: "Mario Rossi <mario@acme.it>",
          },
          {
            name: "to",
            in: "body",
            required: true,
            type: "string",
            description:
              "⚠️ A quale nostro indirizzo è stata scritta. È così che un'email senza riferimento ticket dice a quale workspace appartiene. Accetta anche `recipient` o `envelope.to`.",
            example: "Supporto <supporto@acme.it>, mario@acme.it",
          },
          {
            name: "subject",
            in: "body",
            required: true,
            type: "string",
            description: "Oggetto. Se contiene `[TKT-…]` il messaggio si accoda a quel ticket",
            example: "Re: [TKT-202604-E8CF49] Stampante inceppata",
          },
          {
            name: "html",
            in: "body",
            required: false,
            type: "string",
            description: "Corpo HTML. Preferito al testo; citazioni e firma vengono rimosse",
            example: "<p>Ho provato, non si sblocca.</p>",
          },
          {
            name: "text",
            in: "body",
            required: false,
            type: "string",
            description: "Corpo testuale, usato se manca l'HTML",
            example: "Ho provato, non si sblocca.",
          },
          {
            name: "messageId",
            in: "body",
            required: false,
            type: "string",
            description: "Message-ID del messaggio, per legare il thread",
            example: "<abc@mail.acme.it>",
          },
          {
            name: "inReplyTo",
            in: "body",
            required: false,
            type: "string",
            description: "In-Reply-To del messaggio",
            example: "<def@flux.app>",
          },
          {
            name: "attachments",
            in: "body",
            required: false,
            type: "array",
            description:
              "Allegati in base64. I nomi dei campi sono normalizzati fra i vari ponti (`filename`/`file_name`/`name`, `content_type`/`content-type`/`type`, `content`/`data`/`body`).",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              from: "Mario Rossi <mario@acme.it>",
              to: "Supporto <supporto@acme.it>",
              subject: "Re: [TKT-202604-E8CF49] Stampante inceppata",
              html: "<p>Ho provato, non si sblocca.</p>",
              text: "Ho provato, non si sblocca.",
              messageId: "<abc@mail.acme.it>",
              inReplyTo: "<def@flux.app>",
              attachments: [{ filename: "foto.png", content_type: "image/png", content: "iVBORw0KGgo…" }],
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Nuovo ticket aperto",
            example: JSON.stringify(
              { ok: true, action: "ticket_created", ticketId: "tkt_a1b2c3", ticketNumber: "TKT-202604-E8CF49" },
              null,
              2,
            ),
          },
          {
            status: 200,
            description: "Messaggio accodato a un ticket esistente",
            example: JSON.stringify(
              { ok: true, action: "message_appended", ticketId: "tkt_a1b2c3", messageId: "msg_7d8e9f" },
              null,
              2,
            ),
          },
          {
            status: 200,
            description:
              "⚠️ Nulla da fare, e il motivo è in `skipped`. `unknown_workspace` significa che né l'oggetto né il destinatario hanno identificato un workspace: il messaggio è perso e la causa consueta è un workspace senza indirizzo di invio configurato. Il 200 è voluto — ritentare non lo renderebbe riconoscibile — e resta una riga nei log del server.",
            example: JSON.stringify({ ok: true, skipped: "unknown_workspace" }, null, 2),
          },
          {
            status: 400,
            description: "`from` o `subject` mancanti, oppure corpo non JSON",
            example: JSON.stringify({ error: "Missing from or subject" }, null, 2),
          },
          {
            status: 401,
            description: "`X-Webhook-Secret` assente o diverso, o `INBOUND_EMAIL_SECRET` non configurato sul server",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
          {
            status: 500,
            description: "Elaborazione fallita",
            example: JSON.stringify({ error: "Processing failed" }, null, 2),
          },
        ],
      },
      {
        id: "webhooks-resend-inbound",
        method: "POST",
        path: "/api/webhooks/resend-inbound",
        summary: "Email in entrata — adattatore Resend",
        description:
          "La stessa elaborazione della rotta generica, con l'involucro di Resend attorno: firma Svix da verificare e corpo grezzo da scaricare e analizzare. Da usare quando la posta in entrata passa da Resend; negli altri casi si usa `/api/webhooks/email-inbound`.\n\n" +
          "Resend consegna i destinatari come array e vengono provati tutti, perché è quello di supporto a identificare il workspace e raramente è il primo.",
        auth: "public",
        parameters: [
          {
            name: "svix-id",
            in: "header",
            required: true,
            type: "string",
            description: "Identificativo dell'evento, parte della firma",
          },
          {
            name: "svix-timestamp",
            in: "header",
            required: true,
            type: "string",
            description: "Momento dell'invio, parte della firma",
          },
          {
            name: "svix-signature",
            in: "header",
            required: true,
            type: "string",
            description: "Firma HMAC verificata contro `RESEND_INBOUND_WEBHOOK_SECRET`",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Come la rotta generica: `action` oppure `skipped`",
            example: JSON.stringify(
              { ok: true, action: "ticket_created", ticketId: "tkt_a1b2c3", ticketNumber: "TKT-202604-E8CF49" },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Corpo non JSON, `email_id` assente, oppure `from`/`subject` mancanti nel messaggio",
            example: JSON.stringify({ error: "Missing email_id" }, null, 2),
          },
          {
            status: 401,
            description: "Firma Svix non valida",
            example: JSON.stringify({ error: "Invalid signature" }, null, 2),
          },
          {
            status: 500,
            description: "`RESEND_INBOUND_WEBHOOK_SECRET` o `RESEND_API_KEY` non configurati, o elaborazione fallita",
            example: JSON.stringify({ error: "Webhook not configured" }, null, 2),
          },
          {
            status: 502,
            description: "Resend non ha restituito i metadati del messaggio",
            example: JSON.stringify({ error: "Failed to fetch email metadata" }, null, 2),
          },
        ],
      },
    ],
  },
  {
    id: "cron",
    label: "Cron Jobs",
    icon: Zap,
    color: "text-yellow-600",
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    description:
      "Endpoint interni eseguiti periodicamente da un job scheduler (es. Vercel Cron). Protetti dall'header `Authorization: Bearer $CRON_SECRET`. Non devono essere invocati manualmente in produzione.",
    endpoints: [
      {
        id: "cron-campaign-scheduler",
        method: "GET",
        path: "/api/cron/campaign-scheduler",
        summary: "Scheduler campagne email",
        description:
          "Verifica le campagne email la cui `scheduledAt` è trascorsa e le invia. Eseguito ogni 5 minuti. Invoca `dispatchDueCampaigns()` che popola la coda di invio.",
        auth: "cron",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            type: "string",
            description: "Bearer token uguale alla variabile d'ambiente `CRON_SECRET`.",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Campagne processate",
            example: JSON.stringify(
              {
                dispatched: 3,
                campaigns: [{ id: "cmp_01", name: "Promo Maggio", recipients: 450 }],
              },
              null,
              2,
            ),
          },
          {
            status: 401,
            description: "Secret non valido o mancante",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
      {
        id: "cron-email-worker",
        method: "GET",
        path: "/api/cron/email-worker",
        summary: "Worker invio email",
        description:
          "Processa la coda di invio email individuali (batch da campagne). Invia i messaggi pendenti tramite Resend e aggiorna i log. Eseguito ogni minuto.",
        auth: "cron",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            type: "string",
            description: "Bearer token `CRON_SECRET`.",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Worker completato",
            example: JSON.stringify({ sent: 120, failed: 2, remaining: 0 }, null, 2),
          },
          {
            status: 401,
            description: "Non autorizzato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
      {
        id: "cron-task-reminders",
        method: "GET",
        path: "/api/cron/task-reminders",
        summary: "Promemoria task in scadenza",
        description: "Invia notifiche per i task in scadenza nelle prossime 24 ore. Eseguito ogni ora.",
        auth: "cron",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            type: "string",
            description: "Bearer token `CRON_SECRET`.",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Promemoria inviati",
            example: JSON.stringify({ notified: 8, tasks: ["task_01", "task_02"] }, null, 2),
          },
        ],
      },
      {
        id: "cron-task-overdue",
        method: "GET",
        path: "/api/cron/task-overdue-check",
        summary: "Segnala i task scaduti",
        description:
          "Marca come scaduti i task la cui data è passata e avvisa chi li ha in carico. Una volta al giorno.",
        auth: "cron",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            type: "string",
            description: "Bearer token `CRON_SECRET`.",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Task marcati e avvisi inviati",
            example: JSON.stringify({ flagged: 7 }, null, 2),
          },
        ],
      },
      {
        id: "cron-webhook-retry",
        method: "GET",
        path: "/api/cron/webhook-retry",
        summary: "Riprova i webhook non consegnati",
        description:
          "Rispedisce gli eventi in uscita la cui consegna è fallita. Ogni cinque minuti.\n\n" +
          "⚠️ È questo job a rendere gli eventi in uscita «almeno una volta» invece che «al massimo una volta». Senza, un evento perso è perso, e chi lo stava aspettando non ha modo di saperlo — non fallisce niente, semplicemente non arriva.",
        auth: "cron",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            type: "string",
            description: "Bearer token `CRON_SECRET`.",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Quanti ne sono stati ritentati e quanti sono passati",
            example: JSON.stringify({ retried: 4, delivered: 3 }, null, 2),
          },
        ],
      },
      {
        id: "cron-ticket-autoclose",
        method: "GET",
        path: "/api/cron/ticket-autoclose",
        summary: "Auto-chiusura ticket risolti",
        description:
          "Chiude automaticamente i ticket in stato `resolved` da più di 7 giorni senza risposta del cliente. Eseguito una volta al giorno.",
        auth: "cron",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            type: "string",
            description: "Bearer token `CRON_SECRET`.",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Ticket chiusi automaticamente",
            example: JSON.stringify({ closed: 12 }, null, 2),
          },
        ],
      },
      {
        id: "cron-ticket-sla",
        method: "GET",
        path: "/api/cron/ticket-sla-check",
        summary: "Controllo SLA ticket",
        description:
          "Verifica i ticket che stanno per violare (o hanno già violato) gli SLA configurati e invia alert agli agenti. Eseguito ogni 15 minuti.",
        auth: "cron",
        parameters: [
          {
            name: "Authorization",
            in: "header",
            required: true,
            type: "string",
            description: "Bearer token `CRON_SECRET`.",
            example: "Bearer sk_cron_abc123xyz",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Controllo SLA completato",
            example: JSON.stringify({ breached: 2, warned: 5 }, null, 2),
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
      "Ogni endpoint ha una variante bulk, fino a 500 record per richiesta, con `onDuplicate` a scelta fra `skip`, `update` ed `error`. Una richiesta bulk risponde sempre 200 e riporta l'esito riga per riga: le righe rifiutate stanno dentro il corpo, non nel codice di stato.",
    endpoints: [
      {
        id: "crm-leads-create",
        method: "POST",
        path: "/api/crm/leads",
        summary: "Crea un lead",
        description:
          "Crea un singolo lead con validazione completa. La deduplicazione avviene per email (case-insensitive). Se `onDuplicate` è `skip` (default) e l'email è già presente, restituisce lo status `skipped`. Con `update` aggiorna il record esistente; con `error` risponde con HTTP 409.",
        auth: "session",
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
        id: "crm-orders",
        method: "POST",
        path: "/api/crm/orders",
        summary: "Registra un ordine raccolto",
        description:
          "Crea un ordine per la persona a quel recapito, dalle righe che l'integrazione ha raccolto.\n\n" +
          "⚠️ I totali NON si accettano dal chiamante: vengono ricalcolati qui dalle righe ricevute. Due sistemi che si accordano sull'aritmetica costano poco; un ordine con il totale sbagliato costa molto, e non si vede finché non lo si legge in fattura.",
        auth: "session",
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
  {
    id: "internal",
    label: "Rotte interne",
    icon: Server,
    color: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    description:
      "Rotte che le schermate del prodotto chiamano per conto proprio. Sono documentate per completezza — chi legge i log o costruisce un client alternativo le incontra — ma non fanno parte della superficie pensata per un'integrazione: quella è /api/crm.\n\n" +
      "Tutte richiedono una sessione, e il workspace arriva dal JWT.",
    endpoints: [
      {
        id: "calendar-feed",
        method: "GET",
        path: "/api/calendar/{token}",
        summary: "Feed iCal degli appuntamenti",
        description:
          "Il calendario a cui Google Calendar, Outlook e Calendario di Apple si iscrivono. Restituisce `text/calendar` secondo RFC 5545, con `METHOD:PUBLISH`.\n\n" +
          "⚠️ Nessuna sessione, e non può averne una: un programma di calendario non sa fare login. È il token firmato nell'indirizzo a dire chi sei, quindi quell'indirizzo vale come una password. Chi lo possiede legge gli appuntamenti di quella persona. Non c'è revoca per singola persona: si ritirano tutte insieme ruotando `CALENDAR_FEED_SECRET`.\n\n" +
          "Contiene gli appuntamenti organizzati dalla persona o a cui è invitata, da 90 giorni indietro a 365 avanti. Un appuntamento annullato resta nel feed marcato `CANCELLED` e non viene tolto: un client che smette di vederlo non cancella la copia che ha già, quindi la riunione resterebbe sul calendario di tutti per sempre.\n\n" +
          "La risposta non è mai memorizzata in cache, e un token la cui persona non esiste più risponde 404 come uno inventato: non si distingue fra i due, così l'indirizzo non dice se un account esiste.",
        auth: "public",
        parameters: [
          {
            name: "token",
            in: "path",
            required: true,
            type: "string",
            description: "Il token firmato. Si ottiene dal pulsante «Iscriviti» nella pagina Calendario",
            example: "MTExMTExMTEtLi4u.9f2c8ab1d4e0",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Il calendario. `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: no-store`",
            example:
              "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//FluxCRM//FluxCRM//EN\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\nX-WR-CALNAME:Flux — Anna Rossi\nREFRESH-INTERVAL;VALUE=DURATION:PT15M\nX-PUBLISHED-TTL:PT15M\nBEGIN:VEVENT\nUID:a011600a-c347@fluxcrm.app\nDTSTAMP:20260608T092705Z\nDTSTART:20260608T100000Z\nDTEND:20260608T110000Z\nSUMMARY:Riunione con Acme\nSEQUENCE:1\nSTATUS:CONFIRMED\nEND:VEVENT\nEND:VCALENDAR",
          },
          {
            status: 404,
            description:
              "Token non valido, workspace non trovato, o persona non più esistente. I tre casi non si distinguono",
            example: "Not found",
          },
          {
            status: 429,
            description: "Troppe richieste per lo stesso token",
            example: "Too many requests",
          },
        ],
      },
      {
        id: "documents-download",
        method: "GET",
        path: "/api/documents/{id}",
        summary: "Scarica un documento",
        description:
          "Restituisce i byte del file. Di base come allegato: `Content-Disposition: attachment` e `X-Content-Type-Options: nosniff`, così un file caricato non può essere eseguito dal browser di chi lo apre. Con `?view=1` viene mostrato in linea, e solo per i tipi per cui è sicuro.\n\n" +
          "⚠️ I documenti caricati prima del passaggio all'archiviazione a oggetti contengono un percorso su disco invece di una chiave. Si leggono ancora solo dal driver locale, che su un server distribuito non ha quei byte: in quel caso la rotta lo dice invece di restituire un file rotto.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "Identificativo del documento" },
          {
            name: "view",
            in: "query",
            required: false,
            type: "string",
            description: "`1` per mostrarlo in linea invece di scaricarlo",
            example: "1",
          },
        ],
        responses: [
          { status: 200, description: "I byte del file", example: "<binario>" },
          { status: 401, description: "Sessione assente", example: "Unauthorized" },
          { status: 403, description: "Il documento è di un altro workspace", example: "Forbidden" },
          { status: 404, description: "Documento inesistente, o byte non più raggiungibili", example: "Not found" },
          { status: 502, description: "L'archivio non ha restituito il file", example: "Could not read the file." },
        ],
      },
      {
        id: "quote-read",
        method: "GET",
        path: "/api/quotes/{id}",
        summary: "Leggi un preventivo",
        description:
          "Il preventivo con le sue righe, usato dalle schermate interne. ⚠️ Lo vede chi ne è proprietario, chi possiede la trattativa collegata, o chi ha rango di amministratore nel workspace — non nella scala di piattaforma, che per ogni cliente vale «utente» e quindi non avrebbe mai concesso niente a nessuno.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "Identificativo del preventivo" },
        ],
        responses: [
          {
            status: 200,
            description: "Il preventivo",
            example: JSON.stringify({ id: "qte_1a2b", quoteNumber: "Q-2026-014" }, null, 2),
          },
          { status: 401, description: "Sessione assente", example: "Unauthorized" },
          { status: 403, description: "Non è tuo e non hai il rango per vederlo", example: "Forbidden" },
          { status: 404, description: "Preventivo inesistente", example: "Not found" },
        ],
      },
      {
        id: "reports-export",
        method: "GET",
        path: "/api/reports/export",
        summary: "Esporta il registro attività",
        description:
          "CSV del registro di chi ha fatto cosa. ⚠️ Richiede la capacità `report:manage`, cioè rango amministratore NEL WORKSPACE. Questa riga leggeva il ruolo di piattaforma, che vale «utente» per ogni cliente: l'esportazione era vietata a chiunque, proprietario compreso, e restava aperta solo al personale di Flux.",
        auth: "session",
        parameters: [
          {
            name: "from",
            in: "query",
            required: false,
            type: "string (YYYY-MM-DD)",
            description: "Dalla data",
            example: "2026-09-01",
          },
          {
            name: "to",
            in: "query",
            required: false,
            type: "string (YYYY-MM-DD)",
            description: "Alla data, inclusa",
            example: "2026-09-30",
          },
          {
            name: "userId",
            in: "query",
            required: false,
            type: "string",
            description: "Solo le azioni di questa persona",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Il CSV",
            example: "data,utente,azione,entita\n2026-09-05,Anna Rossi,create_ticket,TKT-202609-1A2B",
          },
          { status: 401, description: "Sessione assente", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
          {
            status: 403,
            description: "Serve il rango amministratore del workspace",
            example: JSON.stringify({ error: "Forbidden" }, null, 2),
          },
          {
            status: 500,
            description: "Esportazione fallita",
            example: JSON.stringify({ error: "Export failed" }, null, 2),
          },
        ],
      },
      {
        id: "ticket-presence-get",
        method: "GET",
        path: "/api/tickets/{id}/presence",
        summary: "Chi sta guardando il ticket",
        description:
          "Le persone che stanno guardando o scrivendo su questo ticket in questo momento, così due agenti non rispondono insieme.\n\n" +
          "⚠️ Lo stato sta in memoria del processo, non nel database: si azzera a ogni riavvio e non è condiviso fra istanze. È voluto — è un segnale di cortesia di pochi secondi, non un dato — ma va saputo prima di farci affidamento.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "Identificativo del ticket" },
        ],
        responses: [
          {
            status: 200,
            description: "Chi c'è adesso",
            example: JSON.stringify([{ userId: "usr_1", userName: "Anna Rossi", action: "typing" }], null, 2),
          },
          { status: 401, description: "Sessione assente", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "ticket-presence-post",
        method: "POST",
        path: "/api/tickets/{id}/presence",
        summary: "Segnala che stai guardando o scrivendo",
        description:
          "Registra la propria presenza sul ticket. Va richiamata periodicamente: una presenza smette di contare da sola dopo pochi secondi di silenzio.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "Identificativo del ticket" },
          {
            name: "action",
            in: "body",
            required: false,
            type: "string",
            description: "`typing` mentre si scrive, altrimenti `viewing`. Qualunque altro valore vale `viewing`",
            enum: ["viewing", "typing"],
            example: "typing",
          },
        ],
        requestBody: { contentType: "application/json", example: JSON.stringify({ action: "typing" }, null, 2) },
        responses: [
          { status: 200, description: "Registrato", example: JSON.stringify({ ok: true }, null, 2) },
          { status: 401, description: "Sessione assente", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
        ],
      },
      {
        id: "admin-migrate-all",
        method: "GET",
        path: "/api/admin/migrate-all",
        summary: "Applica le migrazioni a ogni workspace",
        description:
          "Applica le migrazioni pendenti al database di ogni cliente. È la rotta dietro il pulsante del pannello di amministrazione.\n\n" +
          "Le migrazioni viaggiano dentro il bundle e non vengono lette dal disco: un server distribuito non porta con sé file che il bundler non ha visto importare, e un Worker non ha filesystem. Dalla stessa ragione discende che il pulsante applica sempre e solo ciò che c'è nel bundle attualmente distribuito.\n\n" +
          "⚠️ Di norma non serve premerlo: il database di un workspace si migra da solo la prima volta che viene aperto dopo un rilascio.",
        auth: "admin",
        responses: [
          {
            status: 200,
            description: "Esito per ogni workspace",
            example: JSON.stringify({ ok: true, tenants: [{ subdomain: "acme", applied: 2 }] }, null, 2),
          },
          { status: 401, description: "Sessione di amministrazione assente", example: "Unauthorized" },
        ],
      },
    ],
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

const METHOD_STYLES: Record<Method, string> = {
  GET: "bg-emerald-100 text-emerald-800 border-emerald-200",
  POST: "bg-blue-100 text-blue-800 border-blue-200",
  PUT: "bg-orange-100 text-orange-800 border-orange-200",
  PATCH: "bg-yellow-100 text-yellow-800 border-yellow-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};

function MethodBadge({ method, small = false }: { method: Method; small?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded border font-bold font-mono uppercase",
        small ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-1 text-xs",
        METHOD_STYLES[method],
      )}
    >
      {method}
    </span>
  );
}

const AUTH_CONFIG: Record<AuthLevel, { label: string; icon: React.ElementType; className: string }> = {
  public: {
    label: "Pubblico",
    icon: Globe,
    className: "bg-gray-100 text-gray-700",
  },
  session: {
    label: "Session Required",
    icon: Lock,
    className: "bg-amber-100 text-amber-800",
  },
  admin: {
    label: "Admin / Owner",
    icon: Shield,
    className: "bg-red-100 text-red-700",
  },
  cron: {
    label: "CRON_SECRET / Webhook",
    icon: Zap,
    className: "bg-purple-100 text-purple-800",
  },
};

function AuthBadge({ level }: { level: AuthLevel }) {
  const cfg = AUTH_CONFIG[level];
  const Icon = cfg.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs", cfg.className)}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: number }) {
  const cls =
    status >= 500
      ? "bg-red-100 text-red-700"
      : status >= 400
        ? "bg-orange-100 text-orange-700"
        : status >= 300
          ? "bg-blue-100 text-blue-700"
          : "bg-emerald-100 text-emerald-700";
  return <span className={cn("rounded px-2 py-0.5 font-bold font-mono text-xs", cls)}>{status}</span>;
}

function CodeBlock({ code, lang = "json", label }: { code: string; lang?: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).catch((_err) => {
      // silently ignore clipboard errors
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between border-gray-200 border-b bg-white px-4 py-2">
        <span className="font-mono text-[11px] text-gray-400">{label ?? lang}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              <span className="text-emerald-600">Copiato</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copia
            </>
          )}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-4 text-[12px] text-gray-700 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ParamTable({ params }: { params: Param[] }) {
  const locationLabel: Record<string, string> = {
    query: "query",
    path: "path",
    body: "body",
    form: "form-data",
    header: "header",
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-gray-200 border-b bg-gray-50">
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
              Parametro
            </th>
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">In</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">Tipo</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
              Descrizione
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {params.map((p) => (
            <tr key={p.name} className="hover:bg-gray-50">
              <td className="px-3 py-3">
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-[11px] text-gray-800">
                    {p.name}
                  </code>
                  {p.required && <span className="font-bold text-[9px] text-red-500 uppercase tracking-wide">req</span>}
                </div>
              </td>
              <td className="px-3 py-3">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                  {locationLabel[p.in]}
                </span>
              </td>
              <td className="px-3 py-3 font-mono text-[11px] text-gray-500">{p.type}</td>
              <td className="px-3 py-3 text-gray-500 text-sm">
                <span>{p.description}</span>
                {p.enum && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.enum.map((v) => (
                      <code key={v} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-700">
                        {v}
                      </code>
                    ))}
                  </div>
                )}
                {p.example && (
                  <div className="mt-1 font-mono text-[10px] text-gray-400">
                    es: <code>{p.example}</code>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointSection({
  endpoint,
  sectionRef,
}: {
  endpoint: ApiEndpoint;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div id={endpoint.id} ref={sectionRef} className="scroll-mt-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Endpoint header */}
      <div className="flex flex-wrap items-start gap-3 border-gray-200 border-b p-5">
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 break-all font-mono font-semibold text-gray-900 text-sm">{endpoint.path}</code>
        <AuthBadge level={endpoint.auth} />
      </div>

      {/* Body */}
      <div className="p-5">
        {/* Come per le sezioni: chi scrive paragrafi deve poterli avere. */}
        <p className="mb-5 whitespace-pre-line text-gray-500 text-sm leading-relaxed">{endpoint.description}</p>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: params + request body */}
          <div className="space-y-5">
            {endpoint.parameters && endpoint.parameters.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold text-gray-400 text-xs uppercase tracking-wide">Parametri</h4>
                <ParamTable params={endpoint.parameters} />
              </div>
            )}

            {endpoint.requestBody && (
              <div>
                <h4 className="mb-2 font-semibold text-gray-400 text-xs uppercase tracking-wide">Request Body</h4>
                <CodeBlock
                  code={endpoint.requestBody.example}
                  lang={endpoint.requestBody.contentType}
                  label={endpoint.requestBody.contentType}
                />
              </div>
            )}
          </div>

          {/* Right: responses */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-400 text-xs uppercase tracking-wide">Risposte</h4>
            {responsesFor(endpoint).map((r) => (
              <div key={`${r.status}-${r.description}`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="text-gray-500 text-xs">{r.description}</span>
                </div>
                <CodeBlock code={r.example} label={`${r.status} Response`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupSection({
  group,
  groupRef,
  endpointRef,
}: {
  group: ApiGroup;
  groupRef: (el: HTMLElement | null) => void;
  endpointRef: (id: string, el: HTMLElement | null) => void;
}) {
  const Icon = group.icon;

  return (
    <section id={group.id} ref={groupRef} className="scroll-mt-4 space-y-4">
      {/* Group header */}
      <div className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <Icon className={cn("h-5 w-5", group.color)} />
        </div>
        <div>
          <h2 className="font-bold text-gray-900 text-lg">{group.label}</h2>
          {/*
            `whitespace-pre-line` so a section that needs paragraphs can have
            them. Descriptions written as one block are unaffected: they contain
            no newlines to honour.
          */}
          <p className="mt-1 whitespace-pre-line text-gray-500 text-sm leading-relaxed">{group.description}</p>
        </div>
      </div>

      {/* Endpoints */}
      {group.endpoints.map((ep) => (
        <EndpointSection key={ep.id} endpoint={ep} sectionRef={(el) => endpointRef(ep.id, el)} />
      ))}
    </section>
  );
}

function ErrorCodesSection() {
  const errors = [
    {
      status: 400,
      name: "Bad Request",
      description:
        "La richiesta contiene parametri non validi, mancanti o in un formato errato. Controlla il body JSON o i query parameter.",
    },
    {
      status: 401,
      name: "Unauthorized",
      description: "L'utente non è autenticato. La sessione è assente o scaduta. Effettua il login e riprova.",
    },
    {
      status: 403,
      name: "Forbidden",
      description:
        "L'utente è autenticato ma non ha i permessi necessari per questa operazione (es. tentativo di eliminare un documento altrui).",
    },
    {
      status: 404,
      name: "Not Found",
      description: "La risorsa richiesta non esiste o non è stata trovata nel database.",
    },
    {
      status: 409,
      name: "Conflict",
      description: "Lo stato attuale della risorsa non permette l'operazione richiesta (es. preventivo già accettato).",
    },
    {
      status: 413,
      name: "Payload Too Large",
      description: "Il file caricato supera il limite consentito (10 MB per i documenti).",
    },
    {
      status: 415,
      name: "Unsupported Media Type",
      description:
        "Il tipo MIME del file non è nella whitelist, l'estensione non corrisponde al MIME dichiarato, o i magic bytes del file non corrispondono al tipo dichiarato.",
    },
    {
      status: 500,
      name: "Internal Server Error",
      description:
        "Errore imprevisto lato server, o database del workspace irraggiungibile. I webhook rispondono 500 apposta, per far ritentare il mittente. Controlla i log. ⚠️ Un workspace sbagliato NON arriva qui: una credenziale senza workspace risponde 400, uno inesistente 404.",
    },
    {
      status: 503,
      name: "Service Unavailable",
      description: "Un servizio esterno (es. API tassi di cambio) non è disponibile. Riprova dopo qualche minuto.",
    },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-gray-200 border-b p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50">
          <AlertCircle className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <h2 className="font-bold text-lg">Codici di Errore</h2>
          <p className="text-gray-500 text-sm">
            Tutti gli errori restituiscono un body JSON con il campo{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">error</code>: stringa descrittiva.
          </p>
        </div>
      </div>

      <div className="p-5">
        <div className="mb-4">
          <CodeBlock
            code={JSON.stringify({ error: "Descrizione leggibile dell'errore" }, null, 2)}
            label="Formato errore standard"
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-gray-200 border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
                  Codice
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
                  Causa tipica
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {errors.map((e) => (
                <tr key={e.status} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">{e.name}</td>
                  <td className="px-4 py-3 text-gray-500">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Postman Toolbar ───────────────────────────────────────────────────────────

function PostmanToolbar() {
  const [collectionUrl, setCollectionUrl] = useState<string>("/admin/api-docs/postman-collection.json");
  const [nativeUrl, setNativeUrl] = useState<string>("");
  const [webUrl, setWebUrl] = useState<string>("");
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const base = window.location.origin;
    const col = `${base}/admin/api-docs/postman-collection.json`;
    setCollectionUrl(col);
    // postman:// URI opens the desktop app and fetches the collection locally
    // — works even on localhost, requires Postman desktop to be installed.
    setNativeUrl(`postman://app/collections/import?url=${encodeURIComponent(col)}`);
    // Web URL only works when the server is publicly accessible (not localhost).
    setWebUrl(`https://app.getpostman.com/run-collection?url=${encodeURIComponent(col)}`);
    setIsLocalhost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);

  function copyCollectionUrl() {
    navigator.clipboard.writeText(collectionUrl).catch((_err) => {
      // silently ignore clipboard permission errors
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-5 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
      <div className="flex flex-wrap items-start gap-4">
        {/* Left: title + description */}
        <div className="min-w-48 flex-1">
          <p className="font-semibold text-gray-900 text-sm">Testa in Postman</p>
          <p className="mt-0.5 text-gray-500 text-xs leading-relaxed">
            Importa la collezione pre-configurata con variabili{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[10px] text-blue-700">{"{{baseUrl}}"}</code>,{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[10px] text-blue-700">{"{{apiKey}}"}</code> e{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[10px] text-blue-700">{"{{cronSecret}}"}</code> già
            impostate.
          </p>
        </div>

        {/* Right: action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary: open Postman desktop via postman:// URI scheme — works on localhost */}
          {nativeUrl && (
            <a
              href={nativeUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6C37] px-4 py-2 font-semibold text-white text-xs shadow-sm transition-opacity hover:opacity-90"
              title="Apre l'app desktop Postman e importa la collezione"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Import in Postman
            </a>
          )}

          {/* Secondary: Postman web — only useful when server is publicly accessible */}
          {webUrl && !isLocalhost && (
            <a
              href={webUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#FF6C37]/40 bg-white px-3 py-2 font-medium text-[#FF6C37] text-xs shadow-sm transition-colors hover:bg-orange-50"
              title="Apre Postman Web (richiede URL pubblico)"
            >
              <ExternalLink className="h-3 w-3" />
              Postman Web
            </a>
          )}

          {/* Download Postman Collection */}
          <a
            href="/admin/api-docs/postman-collection.json"
            download="flux-crm-postman-collection.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 text-xs shadow-sm transition-colors hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>

          {/* Download OpenAPI Spec */}
          <a
            href="/admin/api-docs/openapi.json"
            download="flux-crm-openapi.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 text-xs shadow-sm transition-colors hover:bg-gray-50"
          >
            <FileText className="h-3.5 w-3.5" />
            OpenAPI
          </a>

          {/* Copy collection URL */}
          <button
            type="button"
            onClick={copyCollectionUrl}
            title="Copia URL della collezione"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 text-xs shadow-sm transition-colors hover:bg-gray-50"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-600">Copiato!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                URL
              </>
            )}
          </button>
        </div>
      </div>

      {/* Collection URL + localhost hint */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-white/60 px-3 py-2">
          <Globe className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          <code className="flex-1 truncate font-mono text-[10px] text-blue-700">{collectionUrl}</code>
          <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-[9px] text-blue-600 uppercase tracking-wide">
            Public
          </span>
        </div>
        {isLocalhost && (
          <p className="flex items-center gap-1.5 text-[10px] text-amber-600">
            <Info className="h-3 w-3 shrink-0" />
            <span>
              Localhost rilevato — <strong>Import in Postman</strong> usa l'app desktop (che può raggiungere localhost).
              Il pulsante <em>Postman Web</em> è nascosto perché richiede un URL pubblico.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ApiDocsClient() {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["authentication", "tenant", "contacts", "crm-import"]),
  );
  const [activeId, setActiveId] = useState<string>("authentication");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  function scrollTo(id: string) {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  }

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex min-h-full gap-6">
      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 xl:block">
        <div className="sticky top-4 space-y-3">
          {/* API badge */}
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-gray-700" />
              <span className="font-bold font-mono text-gray-900 text-xs">API Reference</span>
              <Badge className="ml-auto h-4 bg-blue-100 px-1.5 text-[10px] text-blue-700 hover:bg-blue-100">v1</Badge>
            </div>
            <p className="mt-2 font-mono text-[10px] text-gray-400">Base URL</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-blue-600">{"{tenant}"}.domain.com/api</p>
          </div>

          {/* Nav */}
          <nav className="space-y-0.5">
            {GROUPS.map((group) => {
              const Icon = group.icon;
              const isExpanded = expandedGroups.has(group.id);
              const count = group.endpoints.length;

              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => {
                      scrollTo(group.id);
                      if (count > 0) toggleGroup(group.id);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium text-xs transition-colors",
                      activeId === group.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", group.color)} />
                    <span className="flex-1 truncate">{group.label}</span>
                    {count > 0 && (
                      <>
                        <span className="rounded bg-gray-100 px-1 py-0.5 font-bold text-[9px] text-gray-500">
                          {count}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                      </>
                    )}
                  </button>

                  {isExpanded && count > 0 && (
                    <div className="mt-0.5 ml-5 space-y-0.5 border-gray-200 border-l pl-3">
                      {group.endpoints.map((ep) => (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() => scrollTo(ep.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                            activeId === ep.id
                              ? "bg-blue-50 text-blue-700"
                              : "text-gray-500 hover:bg-gray-100 hover:text-gray-800",
                          )}
                        >
                          <MethodBadge method={ep.method} small />
                          <span className="min-w-0 truncate font-mono text-[10px]">{ep.path.replace("/api", "")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => scrollTo("error-codes")}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium text-xs transition-colors",
                activeId === "error-codes"
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
              )}
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
              <span>Error Codes</span>
            </button>
          </nav>
        </div>
      </aside>

      {/* ── Main Content ───────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-8 pb-20">
        {/* Hero header */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-900">
              <Terminal className="h-6 w-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-bold text-2xl text-gray-900 tracking-tight">Flux CRM API Reference</h1>
                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">v1.0</Badge>
              </div>
              <p className="mt-1 text-gray-500 text-sm">
                Documentazione completa degli endpoint HTTP. Base URL:{" "}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-blue-600">
                  {"https://{tenant}.domain.com/api"}
                </code>
              </p>

              <div className="mt-4 flex flex-wrap gap-4">
                {[
                  { dot: "bg-cyan-400", text: "Multi-tenant su un dominio solo: il workspace lo dice la credenziale" },
                  {
                    dot: "bg-amber-400",
                    text: "Chiave del workspace, chiave di piattaforma con X-Tenant-ID, o sessione",
                  },
                  { dot: "bg-blue-400", text: "Risposte JSON (salvo CSV / HTML / GIF)" },
                  { dot: "bg-purple-400", text: "Webhook firmati (Stripe HMAC, Resend)" },
                  { dot: "bg-yellow-400", text: "Cron protetti da Authorization: Bearer $CRON_SECRET" },
                ].map(({ dot, text }) => (
                  <span key={text} className="flex items-center gap-1.5 text-gray-500 text-xs">
                    <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
                    {text}
                  </span>
                ))}
              </div>

              <PostmanToolbar />
            </div>
          </div>
        </div>

        {/* Group sections */}
        {GROUPS.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            groupRef={(el) => {
              sectionRefs.current[group.id] = el;
            }}
            endpointRef={(id, el) => {
              sectionRefs.current[id] = el;
            }}
          />
        ))}

        {/* Error codes */}
        <section
          id="error-codes"
          ref={(el) => {
            sectionRefs.current["error-codes"] = el;
          }}
          className="scroll-mt-4"
        >
          <ErrorCodesSection />
        </section>

        {/* Footer note */}
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <div className="text-gray-600 text-sm">
              <span className="font-medium text-gray-900">Nota:</span> Le mutazioni di dati CRM (creazione,
              aggiornamento, eliminazione di contatti, deal, ticket, ecc.) avvengono tramite{" "}
              <span className="font-medium text-gray-900">Next.js Server Actions</span>, non tramite endpoint REST. Le
              Server Actions sono definite in{" "}
              <code className="rounded bg-white px-1 text-blue-700 text-xs">src/actions/</code> e invocabili solo
              dall'app stessa (non espongono URL pubblici).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

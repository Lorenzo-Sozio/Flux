"use client";

import type React from "react";
import { useRef, useState } from "react";

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
  FileText,
  Globe,
  Info,
  Lock,
  Mail,
  Search,
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

// ─── Data ──────────────────────────────────────────────────────────────────────

const GROUPS: ApiGroup[] = [
  {
    id: "authentication",
    label: "Authentication",
    icon: Lock,
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    description:
      "Flux CRM utilizza l'autenticazione basata su sessione tramite NextAuth v5. Dopo il login, un cookie HttpOnly `authjs.session-token` viene impostato automaticamente e inviato con ogni richiesta successiva. Le Server Actions e gli endpoint API verificano la sessione invocando `auth()` lato server — non sono necessarie API key o token Bearer per l'uso normale. Per i cron job è previsto un secret separato (`CRON_SECRET`) passato come `Authorization: Bearer <secret>`. Per i webhook di terze parti (Stripe, Resend) viene verificata la firma HMAC del payload.",
    isInfoOnly: true,
    endpoints: [],
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: Users,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
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
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
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
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
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
    bg: "bg-orange-50 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800",
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
    bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "border-sky-200 dark:border-sky-800",
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
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "border-indigo-200 dark:border-indigo-800",
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
    bg: "bg-teal-50 dark:bg-teal-950/30",
    border: "border-teal-200 dark:border-teal-800",
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
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
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
    bg: "bg-pink-50 dark:bg-pink-950/30",
    border: "border-pink-200 dark:border-pink-800",
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
    bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "border-rose-200 dark:border-rose-800",
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
            status: 400,
            description: "Token non valido o già utilizzato — HTML di errore",
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
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
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
        summary: "Email in entrata (inbound)",
        description:
          "Riceve email in entrata inoltrate da Resend al CRM. Il sistema identifica il ticket dal campo `To` (es. `ticket-TKT0042@reply.flux.io`) e aggiunge il contenuto come commento al ticket.",
        auth: "cron",
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              from: "cliente@example.com",
              to: ["ticket-tkt0042@reply.flux.io"],
              subject: "Re: Problema accesso",
              text: "Ho seguito le istruzioni, il problema persiste.",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Email processata e aggiunta al ticket",
            example: JSON.stringify({ ok: true }, null, 2),
          },
          {
            status: 200,
            description: "Email ignorata (ticket non trovato dall'indirizzo reply)",
            example: JSON.stringify({ ok: true, skipped: true, reason: "No ticket found for reply address" }, null, 2),
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
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    border: "border-yellow-200 dark:border-yellow-800",
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
];

// ─── Sub-components ────────────────────────────────────────────────────────────

const METHOD_STYLES: Record<Method, string> = {
  GET: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  POST: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  PUT: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  PATCH:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800",
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
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  session: {
    label: "Session Required",
    icon: Lock,
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  admin: {
    label: "Admin / Owner",
    icon: Shield,
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  cron: {
    label: "CRON_SECRET / Webhook",
    icon: Zap,
    className: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
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
      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
      : status >= 400
        ? "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300"
        : status >= 300
          ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
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
    <div className="overflow-hidden rounded-lg border border-zinc-700/50 bg-zinc-950">
      <div className="flex items-center justify-between border-zinc-700/50 border-b px-4 py-2">
        <span className="font-mono text-[11px] text-zinc-500">{label ?? lang}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copiato</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copia
            </>
          )}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-4 text-[12px] text-zinc-300 leading-relaxed">
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
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Parametro
            </th>
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              In
            </th>
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Tipo
            </th>
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Descrizione
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {params.map((p) => (
            <tr key={p.name} className="hover:bg-muted/30">
              <td className="px-3 py-3">
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-semibold text-[11px] text-foreground">
                    {p.name}
                  </code>
                  {p.required && <span className="font-bold text-[9px] text-red-500 uppercase tracking-wide">req</span>}
                </div>
              </td>
              <td className="px-3 py-3">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {locationLabel[p.in]}
                </span>
              </td>
              <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">{p.type}</td>
              <td className="px-3 py-3 text-muted-foreground text-sm">
                <span>{p.description}</span>
                {p.enum && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.enum.map((v) => (
                      <code key={v} className="rounded bg-muted px-1 py-0.5 text-[10px] text-foreground">
                        {v}
                      </code>
                    ))}
                  </div>
                )}
                {p.example && (
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
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
    <div id={endpoint.id} ref={sectionRef} className="scroll-mt-4 rounded-xl border bg-card shadow-sm">
      {/* Endpoint header */}
      <div className="flex flex-wrap items-start gap-3 border-b p-5">
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 break-all font-mono font-semibold text-foreground text-sm">{endpoint.path}</code>
        <AuthBadge level={endpoint.auth} />
      </div>

      {/* Body */}
      <div className="p-5">
        <p className="mb-5 text-muted-foreground text-sm leading-relaxed">{endpoint.description}</p>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: params + request body */}
          <div className="space-y-5">
            {endpoint.parameters && endpoint.parameters.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Parametri</h4>
                <ParamTable params={endpoint.parameters} />
              </div>
            )}

            {endpoint.requestBody && (
              <div>
                <h4 className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  Request Body
                </h4>
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
            <h4 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">Risposte</h4>
            {endpoint.responses.map((r) => (
              <div key={`${r.status}-${r.description}`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="text-muted-foreground text-xs">{r.description}</span>
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
      <div className={cn("flex items-start gap-4 rounded-xl border p-5", group.bg, group.border)}>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
            group.bg,
            group.border,
          )}
        >
          <Icon className={cn("h-5 w-5", group.color)} />
        </div>
        <div>
          <h2 className="font-bold text-lg">{group.label}</h2>
          <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{group.description}</p>
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
        "Errore imprevisto lato server. I webhook restituiscono 500 per segnalare a Stripe di ritentare l'invio. Controlla i log dell'applicazione.",
    },
    {
      status: 503,
      name: "Service Unavailable",
      description: "Un servizio esterno (es. API tassi di cambio) non è disponibile. Riprova dopo qualche minuto.",
    },
  ];

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
          <AlertCircle className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <h2 className="font-bold text-lg">Codici di Errore</h2>
          <p className="text-muted-foreground text-sm">
            Tutti gli errori restituiscono un body JSON con il campo{" "}
            <code className="rounded bg-muted px-1 text-xs">error</code>: stringa descrittiva.
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

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  Codice
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  Causa tipica
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {errors.map((e) => (
                <tr key={e.status} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ApiDocsClient() {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["authentication", "contacts"]));
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
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-emerald-400" />
              <span className="font-bold font-mono text-xs text-zinc-100">API Reference</span>
              <Badge className="ml-auto h-4 bg-emerald-500/20 px-1.5 text-[10px] text-emerald-400 hover:bg-emerald-500/20">
                v1
              </Badge>
            </div>
            <p className="mt-2 font-mono text-[10px] text-zinc-500">Base URL</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-emerald-400">/api</p>
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
                        ? "bg-zinc-900 text-white"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", group.color)} />
                    <span className="flex-1 truncate">{group.label}</span>
                    {count > 0 && (
                      <>
                        <span className="rounded bg-muted px-1 py-0.5 font-bold text-[9px] text-muted-foreground">
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
                    <div className="mt-0.5 ml-5 space-y-0.5 border-border border-l pl-3">
                      {group.endpoints.map((ep) => (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() => scrollTo(ep.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                            activeId === ep.id
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
                  ? "bg-zinc-900 text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
        <div className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-white">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20">
              <Terminal className="h-6 w-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-bold text-2xl tracking-tight">Flux CRM API Reference</h1>
                <Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20">v1.0</Badge>
              </div>
              <p className="mt-1 text-sm text-zinc-400">
                Documentazione completa degli endpoint HTTP. Base URL:{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-emerald-400">/api</code>
              </p>

              <div className="mt-4 flex flex-wrap gap-4">
                {[
                  {
                    dot: "bg-amber-400",
                    text: "Session-based auth (NextAuth v5)",
                  },
                  { dot: "bg-blue-400", text: "Risposte JSON (salvo CSV / HTML / GIF)" },
                  {
                    dot: "bg-purple-400",
                    text: "Webhook firmati (Stripe HMAC, Resend)",
                  },
                  {
                    dot: "bg-yellow-400",
                    text: "Cron protetti da Authorization: Bearer $CRON_SECRET",
                  },
                ].map(({ dot, text }) => (
                  <span key={text} className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
                    {text}
                  </span>
                ))}
              </div>
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
        <div className="rounded-xl border bg-muted/30 p-5">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="text-muted-foreground text-sm">
              <span className="font-medium text-foreground">Nota:</span> Le mutazioni di dati CRM (creazione,
              aggiornamento, eliminazione di contatti, deal, ticket, ecc.) avvengono tramite{" "}
              <span className="font-medium text-foreground">Next.js Server Actions</span>, non tramite endpoint REST. Le
              Server Actions sono definite in <code className="rounded bg-muted px-1 text-xs">src/actions/</code> e
              invocabili solo dall'app stessa (non espongono URL pubblici).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

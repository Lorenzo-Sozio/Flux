"use client";

import {
  Bell,
  Building2,
  Clock,
  FileText,
  Globe,
  Lock,
  Mail,
  Receipt,
  Search,
  Server,
  UserPlus,
  Users,
  Webhook,
  Zap,
} from "lucide-react";

import { ApiDocsView } from "@/components/api-docs/api-docs-view";
import { type ApiGroup, PUBLIC_API_GROUPS } from "@/lib/api-docs/public-api";

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
          "Accetta un file CSV tramite `multipart/form-data` e importa i contatti. Obbligatori nome e cognome; i duplicati per email (senza distinzione di maiuscole, anche dentro lo stesso file) vengono saltati. La colonna `company` collega l'azienda con quel nome, o la crea una volta sola. Richiede la capacità `record:import` (editor in su). Intestazioni in camelCase (quelle dell'esportazione), snake_case o italiano (Nome, Cognome, Email, Telefono, Azienda, Città, CAP…); separatore `,` o `;` rilevato da solo; fino a 5.000 righe. Tutte le righe sono validate con le stesse regole dell'API d'importazione; una riga rifiutata non ferma le altre e torna in `errors` con il numero di riga del foglio. Se il file supererebbe il limite di record del piano viene rifiutato per intero, senza scrivere niente. Non fa partire regole né webhook: è un'importazione, non un evento.",
        auth: "session",
        parameters: [
          {
            name: "file",
            in: "form",
            required: true,
            type: "File (text/csv)",
            description: "File CSV con i dati dei contatti. Colonne obbligatorie: `firstName` e `lastName`.",
            example: "contacts.csv",
          },
          {
            name: "mapping",
            in: "form",
            required: false,
            type: "string (JSON)",
            description:
              'Quale campo riempie ogni colonna, come la sceglie l\'importazione guidata: `{ "Intestazione": "campo" }`, `""` per ignorare una colonna. Senza, le intestazioni vengono riconosciute da sole.',
            example: '{"Nome":"firstName","Cognome":"lastName","Codice cliente":""}',
          },
          {
            name: "onDuplicate",
            in: "form",
            required: false,
            type: '"skip" | "update" | "create"',
            description:
              "Cosa fare di una riga già presente: `skip` (predefinito) la salta; `update` riempie il record con le sole celle compilate — celle vuote, titolare e fonte non si toccano, l'ultima riga vince; `create` crea comunque. Gli aggiornamenti vanno a blocchi, un'istruzione per blocco.",
            example: "update",
          },
          {
            name: "dryRun",
            in: "form",
            required: false,
            type: '"1"',
            description:
              "Anteprima: esegue lo stesso piano senza scrivere niente e risponde con gli stessi conteggi. Un file oltre il limite del piano risponde 200 con `limitError` invece di 403. Ha un limite di frequenza suo, più largo.",
            example: "1",
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
            status: 403,
            description: "Manca la capacità `record:import`, oppure il file supererebbe il limite di record del piano",
            example: JSON.stringify({ error: "Limite del piano raggiunto" }, null, 2),
          },
          {
            status: 200,
            description: "Import completato",
            example:
              '{\n  "success": true,\n  "dryRun": false,\n  "created": 42,\n  "updated": 5,\n  "skipped": 3,\n  "duplicates": [\n    "anna@startup.io"\n  ],\n  "errors": [\n    {\n      "line": 7,\n      "errors": [\n        {\n          "field": "email",\n          "message": "email must be a valid email address"\n        }\n      ]\n    }\n  ],\n  "total": 45\n}',
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
        id: "companies-statement",
        method: "GET",
        path: "/api/companies/{id}/statement",
        summary: "Estratto conto del cliente come CSV",
        description:
          "Ogni fattura, fattura d'acconto e nota di credito emessa per l'azienda e ogni incasso o rimborso, in ordine di data, con il saldo dopo ciascuno, per valuta. `from` e `to` (AAAA-MM-GG) limitano il periodo; la prima riga di ogni valuta è il saldo iniziale. Intestazioni nella lingua di chi scarica; in italiano separatore `;` e virgola decimale. Richiede la capacità `record:export` e il modulo vendite.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "L'azienda.", example: "cmp_01JX" },
          {
            name: "from",
            in: "query",
            required: false,
            type: "date",
            description: "Primo giorno del periodo.",
            example: "2026-01-01",
          },
          {
            name: "to",
            in: "query",
            required: false,
            type: "date",
            description: "Ultimo giorno del periodo.",
            example: "2026-12-31",
          },
        ],
        responses: [
          {
            status: 200,
            description: "CSV file",
            example: `Data;Valuta;Movimento;Documento;Riferimento;Dare;Avere;Saldo
2026-09-01;EUR;Fattura;12;;1220,00;;1220,00
2026-09-15;EUR;Incasso;;CRO-1;;1220,00;0,00`,
          },
          { status: 400, description: "Data non in formato AAAA-MM-GG", example: "Bad date" },
          { status: 401, description: "Non autenticato", example: JSON.stringify({ error: "Unauthorized" }, null, 2) },
          {
            status: 403,
            description: "Senza la capacità `record:export` o senza il modulo vendite",
            example: JSON.stringify({ error: "Forbidden" }, null, 2),
          },
          { status: 404, description: "Azienda inesistente", example: "Not found" },
        ],
      },
      {
        id: "companies-import",
        method: "POST",
        path: "/api/companies/import",
        summary: "Importa aziende da CSV",
        description:
          "Accetta un file CSV e importa le aziende. Obbligatorio il nome; i duplicati si riconoscono dal nome, senza distinzione di maiuscole. Richiede la capacità `record:import` (editor in su). Intestazioni in camelCase (quelle dell'esportazione), snake_case o italiano (Nome, Cognome, Email, Telefono, Azienda, Città, CAP…); separatore `,` o `;` rilevato da solo; fino a 5.000 righe. Tutte le righe sono validate con le stesse regole dell'API d'importazione; una riga rifiutata non ferma le altre e torna in `errors` con il numero di riga del foglio. Se il file supererebbe il limite di record del piano viene rifiutato per intero, senza scrivere niente. Non fa partire regole né webhook: è un'importazione, non un evento.",
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
          {
            name: "mapping",
            in: "form",
            required: false,
            type: "string (JSON)",
            description:
              'Quale campo riempie ogni colonna, come la sceglie l\'importazione guidata: `{ "Intestazione": "campo" }`, `""` per ignorare una colonna. Senza, le intestazioni vengono riconosciute da sole.',
            example: '{"Nome":"firstName","Cognome":"lastName","Codice cliente":""}',
          },
          {
            name: "onDuplicate",
            in: "form",
            required: false,
            type: '"skip" | "update" | "create"',
            description:
              "Cosa fare di una riga già presente: `skip` (predefinito) la salta; `update` riempie il record con le sole celle compilate — celle vuote, titolare e fonte non si toccano, l'ultima riga vince; `create` crea comunque. Gli aggiornamenti vanno a blocchi, un'istruzione per blocco.",
            example: "update",
          },
          {
            name: "dryRun",
            in: "form",
            required: false,
            type: '"1"',
            description:
              "Anteprima: esegue lo stesso piano senza scrivere niente e risponde con gli stessi conteggi. Un file oltre il limite del piano risponde 200 con `limitError` invece di 403. Ha un limite di frequenza suo, più largo.",
            example: "1",
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
            status: 403,
            description: "Manca la capacità `record:import`, oppure il file supererebbe il limite di record del piano",
            example: JSON.stringify({ error: "Limite del piano raggiunto" }, null, 2),
          },
          {
            status: 200,
            description: "Import completato",
            example:
              '{\n  "success": true,\n  "dryRun": false,\n  "created": 42,\n  "updated": 5,\n  "skipped": 3,\n  "duplicates": [\n    "anna@startup.io"\n  ],\n  "errors": [\n    {\n      "line": 7,\n      "errors": [\n        {\n          "field": "email",\n          "message": "email must be a valid email address"\n        }\n      ]\n    }\n  ],\n  "total": 45\n}',
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
    description: "Importazione ed esportazione dei lead in formato CSV.",
    endpoints: [
      {
        id: "leads-import",
        method: "POST",
        path: "/api/leads/import",
        summary: "Importa lead da CSV",
        description:
          "Accetta un file CSV e importa i lead. Serve almeno uno fra nome, cognome, email e telefono; i duplicati per email vengono saltati. Lo stato, se presente, è uno di new, contacting, engaged, qualified, unqualified. Richiede la capacità `record:import` (editor in su). Intestazioni in camelCase (quelle dell'esportazione), snake_case o italiano (Nome, Cognome, Email, Telefono, Azienda, Città, CAP…); separatore `,` o `;` rilevato da solo; fino a 5.000 righe. Tutte le righe sono validate con le stesse regole dell'API d'importazione; una riga rifiutata non ferma le altre e torna in `errors` con il numero di riga del foglio. Se il file supererebbe il limite di record del piano viene rifiutato per intero, senza scrivere niente. Non fa partire regole né webhook: è un'importazione, non un evento.",
        auth: "session",
        parameters: [
          {
            name: "file",
            in: "form",
            required: true,
            type: "File (text/csv)",
            description: "CSV con le colonne dei lead.",
            example: "leads.csv",
          },
          {
            name: "mapping",
            in: "form",
            required: false,
            type: "string (JSON)",
            description:
              'Quale campo riempie ogni colonna, come la sceglie l\'importazione guidata: `{ "Intestazione": "campo" }`, `""` per ignorare una colonna. Senza, le intestazioni vengono riconosciute da sole.',
            example: '{"Nome":"firstName","Cognome":"lastName","Codice cliente":""}',
          },
          {
            name: "onDuplicate",
            in: "form",
            required: false,
            type: '"skip" | "update" | "create"',
            description:
              "Cosa fare di una riga già presente: `skip` (predefinito) la salta; `update` riempie il record con le sole celle compilate — celle vuote, titolare e fonte non si toccano, l'ultima riga vince; `create` crea comunque. Gli aggiornamenti vanno a blocchi, un'istruzione per blocco.",
            example: "update",
          },
          {
            name: "dryRun",
            in: "form",
            required: false,
            type: '"1"',
            description:
              "Anteprima: esegue lo stesso piano senza scrivere niente e risponde con gli stessi conteggi. Un file oltre il limite del piano risponde 200 con `limitError` invece di 403. Ha un limite di frequenza suo, più largo.",
            example: "1",
          },
        ],
        requestBody: {
          contentType: "multipart/form-data",
          example: `curl -X POST /api/leads/import \\\n  -H "Cookie: authjs.session-token=..." \\\n  -F "file=@leads.csv;type=text/csv"`,
        },
        responses: [
          {
            status: 403,
            description: "Manca la capacità `record:import`, oppure il file supererebbe il limite di record del piano",
            example: JSON.stringify({ error: "Limite del piano raggiunto" }, null, 2),
          },
          {
            status: 200,
            description: "Import completato",
            example:
              '{\n  "success": true,\n  "dryRun": false,\n  "created": 42,\n  "updated": 5,\n  "skipped": 3,\n  "duplicates": [\n    "anna@startup.io"\n  ],\n  "errors": [\n    {\n      "line": 7,\n      "errors": [\n        {\n          "field": "email",\n          "message": "email must be a valid email address"\n        }\n      ]\n    }\n  ],\n  "total": 45\n}',
          },
          {
            status: 400,
            description: "File mancante o non leggibile come CSV",
            example: JSON.stringify({ error: "No file provided." }, null, 2),
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
        ],
      },
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
    id: "invoices",
    label: "Fatture",
    icon: Receipt,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    description:
      "Il file XML FatturaPA di una fattura emessa. Il documento è costruito dai dati congelati al momento dell'emissione — emittente, cliente e righe come erano quel giorno — quindi la stessa fattura produce sempre lo stesso file.",
    endpoints: [
      {
        id: "invoice-xml",
        method: "GET",
        path: "/api/invoices/{id}/xml",
        summary: "Scarica il tracciato FatturaPA",
        description:
          "Restituisce il file XML in formato FPR12 (schema 1.2.3) della fattura o nota di credito emessa, con il nome file previsto da SDI. Una bozza non ha un tracciato: va prima emessa.",
        auth: "session",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            type: "string",
            description: "ID della fattura.",
            example: "8f1c2b7e-4a3d-4f16-9d21-0b7e5c9a1234",
          },
        ],
        responses: [
          {
            status: 200,
            description: "File XML (application/xml), allegato con nome ITxxxxxxxxxxx_00001.xml",
            example:
              '<?xml version="1.0" encoding="UTF-8"?>\n<p:FatturaElettronica versione="FPR12" …>…</p:FatturaElettronica>',
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
          {
            status: 404,
            description: "Fattura inesistente",
            example: "Not found",
          },
          {
            status: 409,
            description: "La fattura è ancora una bozza",
            example: "A draft has no XML: issue it first.",
          },
        ],
      },
      {
        id: "invoice-pdf",
        method: "GET",
        path: "/api/invoices/{id}/pdf",
        summary: "Scarica la copia di cortesia in PDF",
        description:
          "Restituisce il PDF leggibile della fattura o nota di credito emessa, costruito dagli stessi dati congelati dell'XML. È una copia di cortesia priva di valore fiscale, come riportato a piè di pagina: l'originale è il tracciato trasmesso tramite SDI. Il file archiviato all'emissione viene servito se integro; altrimenti è ricostruito e archiviato.",
        auth: "session",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            type: "string",
            description: "ID della fattura.",
            example: "8f1c2b7e-4a3d-4f16-9d21-0b7e5c9a1234",
          },
        ],
        responses: [
          {
            status: 200,
            description: "File PDF (application/pdf), allegato con nome Fattura-{numero}.pdf",
            example: "%PDF-1.3 …",
          },
          {
            status: 401,
            description: "Non autenticato",
            example: JSON.stringify({ error: "Unauthorized" }, null, 2),
          },
          {
            status: 404,
            description: "Fattura inesistente",
            example: "Not found",
          },
          {
            status: 409,
            description: "La fattura è ancora una bozza",
            example: "A draft has no PDF: issue it first.",
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
        id: "workspace-logo",
        method: "GET",
        path: "/api/workspace/logo",
        summary: "Logo del workspace",
        description:
          "Il logo impostato in Impostazioni → Generale, per l'anteprima. Solo per chi è entrato nel workspace: ai clienti il logo arriva dentro i PDF dei preventivi, non da qui. PNG o JPEG, `Cache-Control: private, no-store`.",
        auth: "session",
        responses: [
          { status: 200, description: "L'immagine (`image/png` o `image/jpeg`)", example: "<bytes>" },
          { status: 401, description: "Non autenticato", example: "Unauthorized" },
          { status: 404, description: "Nessun logo impostato, o l'archivio non lo restituisce", example: "Not found" },
        ],
      },
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
        id: "chat-message-attachment",
        method: "POST",
        path: "/api/chat/messages",
        summary: "Invia un messaggio in chat con un allegato",
        description:
          "Invia in una conversazione della chat interna un messaggio con un file allegato (il testo è facoltativo). Stessi controlli dei documenti: tipo MIME in whitelist, estensione coerente, magic bytes, massimo 10 MB, spazio del piano. Solo i membri della conversazione possono inviare; le menzioni valgono solo per chi è nella conversazione.",
        auth: "session",
        parameters: [
          {
            name: "conversationId",
            in: "form",
            required: true,
            type: "string",
            description: "ID della conversazione.",
            example: "conv_01",
          },
          {
            name: "file",
            in: "form",
            required: true,
            type: "File",
            description: "Il file da inviare (max 10 MB, MIME type nella whitelist).",
            example: "preventivo.pdf",
          },
          {
            name: "content",
            in: "form",
            required: false,
            type: "string",
            description: "Il testo che accompagna il file.",
            example: "Ecco il preventivo firmato",
          },
          {
            name: "mentionIds",
            in: "form",
            required: false,
            type: "string",
            description: "Array JSON degli utenti menzionati; chi non è nella conversazione viene ignorato.",
            example: '["usr_luca"]',
          },
        ],
        requestBody: {
          contentType: "multipart/form-data",
          example: `curl -X POST /api/chat/messages \\\n  -H "Cookie: authjs.session-token=..." \\\n  -F "conversationId=conv_01" \\\n  -F "file=@preventivo.pdf;type=application/pdf"`,
        },
        responses: [
          {
            status: 200,
            description: "Messaggio inviato, con il suo allegato",
            example: JSON.stringify(
              {
                message: {
                  id: "msg_01",
                  conversationId: "conv_01",
                  content: "",
                  attachments: [{ id: "att_01", name: "preventivo.pdf", mimeType: "application/pdf", size: 204800 }],
                },
              },
              null,
              2,
            ),
          },
          {
            status: 400,
            description: "Richiesta non multipart, conversationId mancante o malformato, file assente",
            example: JSON.stringify({ error: "Invalid request." }, null, 2),
          },
          {
            status: 401,
            description: "Sessione assente",
            example: '{\n  "error": "Unauthorized"\n}',
          },
          {
            status: 402,
            description: "Spazio del piano esaurito: documenti e file della chat contano insieme",
            example: '{\n  "error": "Storage limit reached for your plan."\n}',
          },
          {
            status: 403,
            description: "Chi invia non è membro della conversazione",
            example: '{\n  "error": "Forbidden"\n}',
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
          {
            status: 500,
            description: "Salvataggio del file o del messaggio non riuscito; il file caricato viene rimosso",
            example: JSON.stringify({ error: "Could not save the file." }, null, 2),
          },
        ],
      },
      {
        id: "chat-attachment-download",
        method: "GET",
        path: "/api/chat/attachments/{id}",
        summary: "Scarica un allegato della chat",
        description:
          "Restituisce il file, solo a chi è membro della conversazione in cui è stato inviato: chi ha lasciato un gruppo non lo apre più. Con `view=1` le immagini sono mostrate inline (anteprima nel thread); ogni altro tipo è sempre un download. `nosniff` e una CSP che non consente nulla.",
        auth: "session",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            type: "string",
            description: "ID dell'allegato.",
            example: "att_01",
          },
          {
            name: "view",
            in: "query",
            required: false,
            type: "string",
            description: "`1` per mostrare un'immagine inline invece di scaricarla.",
            example: "1",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Il file, con il suo Content-Type",
            example: "(contenuto binario)",
          },
          {
            status: 401,
            description: "Sessione assente",
            example: "Unauthorized",
          },
          {
            status: 403,
            description: "Chiave di archiviazione non riconosciuta: il file non viene servito",
            example: "Forbidden",
          },
          {
            status: 404,
            description:
              "Allegato inesistente, oppure chi chiede non è nella conversazione (stessa risposta, per non confermare che esiste)",
            example: "Not found",
          },
          {
            status: 502,
            description: "L'archivio dei file non ha risposto",
            example: "Could not read the file.",
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
          "Permette al cliente di accettare o rifiutare un preventivo tramite token pubblico. Il preventivo deve essere in stato `sent` o `viewed`. ⚠️ **Accettare è firmare** (firma elettronica semplice): servono `signerName` e `consent: true`, altrimenti 422 `signature_required`. Si registrano il nome, il testo del consenso ricostruito dal server nella lingua del cliente, data e ora, l'IP visto dalla piattaforma, il browser e l'impronta SHA-256 del PDF accettato, i cui byte sono conservati. Il rifiuto non si firma.",
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
          {
            name: "signerName",
            in: "body",
            required: false,
            type: "string",
            description:
              "Nome e cognome di chi firma (obbligatorio per `action: accepted`, 3–120 caratteri, con lettere).",
            example: "Mario Rossi",
          },
          {
            name: "consent",
            in: "body",
            required: false,
            type: "boolean",
            description: "La casella di consenso spuntata (obbligatoria per `action: accepted`).",
            example: "true",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            { token: "qt_pTkXz3mNR9aQv8", action: "accepted", signerName: "Mario Rossi", consent: true },
            null,
            2,
          ),
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
            status: 422,
            description: "Accettazione senza nome o senza consenso: accettare è firmare",
            example: JSON.stringify(
              { error: "Type your name and tick the consent to sign.", code: "signature_required" },
              null,
              2,
            ),
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
            status: 401,
            description:
              "Sessione assente. La cache dei tassi sta nel database del workspace, quindi senza sessione non c'e nessun database da leggere",
            example: '{\n  "error": "Unauthorized"\n}',
          },
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
            status: 401,
            description:
              "Sessione assente. La cache dei tassi sta nel database del workspace, quindi senza sessione non c'e nessun database da leggere",
            example: '{\n  "error": "Unauthorized"\n}',
          },
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
        id: "appointments-ics",
        method: "GET",
        path: "/api/appointments/{id}/ics",
        summary: "Scarica un appuntamento in formato .ics",
        description:
          'Il file per "Aggiungi al mio calendario": `text/calendar` secondo RFC 5545 con `METHOD:PUBLISH`, così il calendario che lo apre lo archivia invece di chiedere una risposta all\'organizzatore.\n\n' +
          "Un appuntamento ricorrente porta la regola (`RRULE`), le date escluse (`EXDATE`) e il fuso orario (`VTIMEZONE`): gli orari restano quelli locali anche al cambio dell'ora legale. Uno di tutto il giorno usa date senza ora.",
        auth: "session",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            type: "string",
            description: "ID dell'appuntamento.",
            example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Il file .ics (attachment)",
            example: `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:PUBLISH\nBEGIN:VEVENT\nUID:…@fluxcrm.app\nDTSTART:20261005T080000Z\nDTEND:20261005T090000Z\nSUMMARY:Riunione con il cliente\nEND:VEVENT\nEND:VCALENDAR`,
          },
          { status: 401, description: "Nessuna sessione, o senza permesso di lettura", example: "Unauthorized" },
          { status: 404, description: "Appuntamento inesistente", example: "Not found" },
        ],
      },
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
      {
        id: "forms-public-post",
        method: "POST",
        path: "/api/forms",
        summary: "Invia un modulo pubblico (contatto o assistenza)",
        description:
          "Il modulo di contatto crea un lead — oppure, per chi è già nel CRM, aggiunge il messaggio alla sua cronologia — e il modulo di assistenza apre un ticket. JSON o un normale invio di modulo HTML; aperto a qualunque origine (CORS), senza autenticazione, limitato a 5 invii al minuto per indirizzo. Con Cloudflare Turnstile configurato serve il campo `cf-turnstile-response`. Un campo `website` compilato viene trattato come un robot. `redirect` (http/https) porta il browser a una pagina dopo un invio riuscito.",
        auth: "public",
        parameters: [
          {
            name: "workspace",
            in: "body",
            required: true,
            type: "string",
            description: "Sottodominio del workspace.",
            example: "acme",
          },
          {
            name: "token",
            in: "body",
            required: true,
            type: "string",
            description: "Token del modulo (Impostazioni → Moduli).",
            example: "q7m2x9k4b8n6t5r2wzv3",
          },
          {
            name: "name",
            in: "body",
            required: true,
            type: "string",
            description: "Nome del mittente.",
            example: "Mario Rossi",
          },
          {
            name: "email",
            in: "body",
            required: true,
            type: "string",
            description: "Email del mittente.",
            example: "mario@example.com",
          },
          {
            name: "message",
            in: "body",
            required: false,
            type: "string",
            description: "Modulo di contatto: il messaggio.",
            example: "Vorrei un preventivo.",
          },
          {
            name: "consent",
            in: "body",
            required: false,
            type: "boolean",
            description: "Modulo di contatto: consenso marketing spuntato.",
            example: "false",
          },
          {
            name: "subject",
            in: "body",
            required: false,
            type: "string",
            description: "Modulo di assistenza: oggetto (obbligatorio).",
            example: "Non riesco ad accedere",
          },
          {
            name: "description",
            in: "body",
            required: false,
            type: "string",
            description: "Modulo di assistenza: descrizione (obbligatoria).",
            example: "Dopo l'aggiornamento...",
          },
          {
            name: "redirect",
            in: "body",
            required: false,
            type: "string",
            description: "Pagina a cui mandare il browser dopo l'invio.",
            example: "https://www.example.com/grazie",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              workspace: "acme",
              token: "q7m2x9k4b8n6t5r2wzv3",
              name: "Mario Rossi",
              email: "mario@example.com",
              message: "Vorrei un preventivo.",
              consent: false,
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Ricevuto",
            example: '{\n  "ok": true,\n  "kind": "ticket",\n  "ticketNumber": "TKT-202609-A1B2C3"\n}',
          },
          { status: 303, description: "Ricevuto, con redirect", example: "Location: https://www.example.com/grazie" },
          { status: 400, description: "Corpo illeggibile", example: '{\n  "ok": false,\n  "reason": "invalid"\n}' },
          {
            status: 403,
            description: "Controllo Turnstile non superato",
            example: '{\n  "ok": false,\n  "reason": "captcha"\n}',
          },
          {
            status: 404,
            description: "Modulo inesistente o chiuso",
            example: '{\n  "ok": false,\n  "reason": "notFound"\n}',
          },
          {
            status: 422,
            description: "Campi mancanti o non validi",
            example: '{\n  "ok": false,\n  "reason": "invalid"\n}',
          },
          { status: 429, description: "Troppi invii", example: '{\n  "ok": false,\n  "reason": "tooMany"\n}' },
        ],
      },
      {
        id: "booking-public-post",
        method: "POST",
        path: "/api/booking",
        summary: "Prenota un orario da una pagina di prenotazione",
        description:
          "Il modulo della pagina pubblica `/b/{workspace}/{token}`. L'orario deve essere tra quelli offerti in quel momento (liberi nel calendario della persona, dentro le sue ore); l'appuntamento viene creato, chi prenota riceve l'invito e viene archiviato come contatto o lead esistente, oppure come nuovo lead. Senza autenticazione; limitato a 5 richieste al minuto per indirizzo. Un campo `website` compilato viene trattato come un robot: risposta di successo, nessuna scrittura.",
        auth: "public",
        parameters: [
          {
            name: "workspace",
            in: "body",
            required: true,
            type: "string",
            description: "Sottodominio del workspace.",
            example: "acme",
          },
          {
            name: "token",
            in: "body",
            required: true,
            type: "string",
            description: "Token della pagina di prenotazione.",
            example: "k3v7q2m9x4b8n6t5r2wz",
          },
          {
            name: "start",
            in: "body",
            required: true,
            type: "string",
            description: "Inizio scelto, ISO 8601, uno di quelli offerti.",
            example: "2026-09-29T07:00:00.000Z",
          },
          {
            name: "name",
            in: "body",
            required: true,
            type: "string",
            description: "Nome di chi prenota.",
            example: "Mario Rossi",
          },
          {
            name: "email",
            in: "body",
            required: true,
            type: "string",
            description: "Email di chi prenota.",
            example: "mario@example.com",
          },
          {
            name: "phone",
            in: "body",
            required: false,
            type: "string",
            description: "Telefono.",
            example: "+39 333 1234567",
          },
          {
            name: "note",
            in: "body",
            required: false,
            type: "string",
            description: "Nota per l'incontro.",
            example: "Vorrei parlare del rinnovo.",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify(
            {
              workspace: "acme",
              token: "k3v7q2m9x4b8n6t5r2wz",
              start: "2026-09-29T07:00:00.000Z",
              name: "Mario Rossi",
              email: "mario@example.com",
            },
            null,
            2,
          ),
        },
        responses: [
          {
            status: 200,
            description: "Prenotato",
            example:
              '{\n  "ok": true,\n  "startAt": "2026-09-29T07:00:00.000Z",\n  "endAt": "2026-09-29T08:00:00.000Z"\n}',
          },
          { status: 400, description: "Corpo non JSON", example: '{\n  "ok": false,\n  "reason": "invalid"\n}' },
          {
            status: 404,
            description: "Pagina inesistente o chiusa",
            example: '{\n  "ok": false,\n  "reason": "notFound"\n}',
          },
          {
            status: 409,
            description: "Orario non più disponibile",
            example: '{\n  "ok": false,\n  "reason": "taken"\n}',
          },
          {
            status: 422,
            description: "Nome, email o orario non validi",
            example: '{\n  "ok": false,\n  "reason": "invalid"\n}',
          },
          { status: 429, description: "Troppi tentativi", example: '{\n  "ok": false,\n  "reason": "tooMany"\n}' },
        ],
      },
      {
        id: "ticket-rating-post",
        method: "POST",
        path: "/api/tickets/public",
        summary: "Registra il giudizio del cliente su una richiesta risolta",
        description:
          "Il riquadro «Com'è andata?» della pagina di stato `/t/{workspace}/{token}`, a cui portano i pulsanti dell'email di risoluzione. Vale solo per un ticket risolto o chiuso; l'ultima risposta prevale e un commento dato in precedenza resta. Un giudizio negativo viene notificato a chi ha gestito il ticket, una volta. Senza autenticazione: il token è l'intero permesso. Limitato a 10 richieste al minuto per indirizzo.",
        auth: "public",
        parameters: [
          {
            name: "workspace",
            in: "body",
            required: true,
            type: "string",
            description: "Sottodominio del workspace.",
            example: "acme",
          },
          {
            name: "token",
            in: "body",
            required: true,
            type: "string",
            description: "Token del ticket, dal link dell'email.",
            example: "k3v7q2m9x4b8n6t5r2wz",
          },
          {
            name: "rating",
            in: "body",
            required: true,
            type: "string",
            description: "`good` oppure `bad`.",
            example: "bad",
          },
          {
            name: "comment",
            in: "body",
            required: false,
            type: "string",
            description: "Facoltativo, fino a 2000 caratteri.",
            example: "Ci è voluta una settimana.",
          },
        ],
        requestBody: {
          contentType: "application/json",
          example: JSON.stringify({ workspace: "acme", token: "k3v7q2m9x4b8n6t5r2wz", rating: "good" }, null, 2),
        },
        responses: [
          { status: 200, description: "Registrato", example: '{\n  "ok": true\n}' },
          {
            status: 400,
            description: "Corpo non JSON, giudizio o token non validi",
            example: '{\n  "ok": false,\n  "reason": "invalid"\n}',
          },
          {
            status: 404,
            description: "Workspace o ticket inesistente",
            example: '{\n  "ok": false,\n  "reason": "notFound"\n}',
          },
          {
            status: 409,
            description: "Il ticket non è ancora risolto",
            example: '{\n  "ok": false,\n  "reason": "notYet"\n}',
          },
          { status: 429, description: "Troppi tentativi", example: '{\n  "ok": false,\n  "reason": "tooMany"\n}' },
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
        summary: "Pagina di disiscrizione: chiede, non agisce",
        description:
          "Il link delle email. ⚠️ Aprirlo non disiscrive nessuno: mostra l'indirizzo e un pulsante che fa POST. Gli scanner della posta aziendale aprono ogni link, e un GET che agiva disiscriveva persone che non l'avevano chiesto (deciso il 27 settembre 2026).",
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
      {
        id: "unsubscribe-post",
        method: "POST",
        path: "/api/unsubscribe",
        summary: "Disiscrizione: il pulsante della pagina, o il clic unico del client di posta",
        description:
          "Aggiunge l'indirizzo alle esclusioni, ferma le sequenze, ritira il consenso marketing con la sua data e annuncia `consent.withdrawn`. È anche il `List-Unsubscribe-Post` di RFC 8058: le email portano `List-Unsubscribe` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, così il pulsante «Annulla iscrizione» di Gmail e Outlook arriva qui con il token nell'indirizzo.",
        auth: "public",
        parameters: [
          {
            name: "token",
            in: "query",
            required: false,
            type: "string",
            description: "Il token firmato: nell'indirizzo (clic unico) o nel corpo del modulo (`token=…`).",
            example: "eyJlIjoibWFyaW9AY2xpZW50ZS5pdCIs…",
          },
        ],
        responses: [
          {
            status: 200,
            description:
              "Disiscrizione eseguita — pagina HTML. Anche con un token non valido la pagina cambia, lo stato no.",
            example: `<!-- Content-Type: text/html -->\n<html>\n  <body>\n    <h1>Unsubscribed successfully</h1>\n  </body>\n</html>`,
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
        id: "cron-idempotency-sweep",
        method: "GET",
        path: "/api/cron/idempotency-sweep",
        summary: "Pulizia chiavi di idempotenza",
        description:
          "Dimentica le chiavi `Idempotency-Key` più vecchie di 30 giorni, insieme alle risposte memorizzate per rigiocarle. Serve perché ogni richiesta con chiave conserva la propria risposta per intero: è ciò che permette a una ripetizione di ricevere la stessa risposta invece di reimportare, ed è anche il motivo per cui la tabella non può essere lasciata crescere. Una risposta da cinquecento record sono decine di kilobyte, scritte una al giorno da qualunque workspace che importa ogni giorno. Trenta giorni sono ben oltre qualsiasi ritentativo automatico e oltre il punto in cui rimandare il file di ieri sarebbe ancora la stessa importazione. Eseguito una volta al giorno, sulla stessa schedule dell'auto-chiusura ticket.",
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
            description: "Quante chiavi sono state dimenticate",
            example: JSON.stringify({ forgotten: 143 }, null, 2),
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
  // The public API: written once, in src/lib/api-docs/public-api.ts.
  ...PUBLIC_API_GROUPS,
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
        id: "mail-connect",
        method: "GET",
        path: "/api/mail/connect/{provider}",
        summary: "Collega la propria casella Google o Microsoft 365",
        description:
          "Porta la persona alla schermata di consenso del fornitore (V3.2). Lo stato inviato è firmato e nomina workspace, persona e fornitore, con dieci minuti di validità; un cookie httpOnly lega il ritorno allo stesso browser, e PKCE rende inutile il codice senza il verificatore.\n\n" +
          "⚠️ Dormiente finché può funzionare: senza credenziali (`MAIL_GOOGLE_*` / `MAIL_MICROSOFT_*`) risponde rimandando al profilo con `?mail=unavailable`; con le credenziali ma senza la verifica del fornitore dichiarata (`MAIL_*_VERIFIED=1`) solo il personale di Flux può collegarsi.",
        auth: "session",
        parameters: [
          {
            name: "provider",
            in: "path",
            required: true,
            type: "string",
            description: "`google` oppure `microsoft`",
            example: "google",
          },
        ],
        responses: [
          {
            status: 307,
            description:
              "Verso la schermata di consenso del fornitore, o di ritorno al profilo con `?mail=unavailable`",
            example: "Location: https://accounts.google.com/o/oauth2/v2/auth?…",
          },
          { status: 404, description: "Fornitore sconosciuto", example: "Not found" },
        ],
      },
      {
        id: "mail-callback",
        method: "GET",
        path: "/api/mail/callback/{provider}",
        summary: "Ritorno dal consenso: salva la casella collegata",
        description:
          "Dove il fornitore rimanda la persona. Prima di riscattare il codice controlla firma e scadenza dello stato, il cookie, che la persona collegata sia quella che ha iniziato e che il workspace aperto sia lo stesso. I token sono cifrati con la chiave di piattaforma; si legge la posta da quel momento in poi, mai l'arretrato.\n\n" +
          "Risponde sempre rimandando al profilo con `?mail=connected`, `denied`, `error` o `unavailable`: il motivo di un rifiuto finisce nel log, non nell'indirizzo.",
        auth: "session",
        parameters: [
          {
            name: "provider",
            in: "path",
            required: true,
            type: "string",
            description: "`google` oppure `microsoft`",
            example: "microsoft",
          },
          {
            name: "code",
            in: "query",
            required: false,
            type: "string",
            description: "Il codice di autorizzazione del fornitore",
            example: "4/0AbC…",
          },
          {
            name: "state",
            in: "query",
            required: false,
            type: "string",
            description: "Lo stato firmato inviato all'andata",
            example: "eyJ0ZW5hbnRJZCI6…",
          },
        ],
        responses: [
          {
            status: 307,
            description: "Di ritorno al profilo, con l'esito in `?mail=`",
            example: "Location: /dashboard/profile?mail=connected",
          },
          { status: 404, description: "Fornitore sconosciuto", example: "Not found" },
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
        summary: "Stampa un preventivo",
        description:
          "La pagina HTML di stampa del preventivo, con il pulsante «Stampa / Salva come PDF». È scritta nella lingua del cliente (campo `language` dell'azienda, oppure dedotta dal paese) e gli importi sono nella valuta del preventivo, qualunque sia la lingua di chi la apre. ⚠️ La vede chi ne è proprietario, chi possiede la trattativa collegata, o chi ha rango di amministratore nel workspace.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "Identificativo del preventivo" },
        ],
        responses: [
          { status: 200, description: "La pagina di stampa (text/html)", example: "<!DOCTYPE html>…" },
          { status: 401, description: "Sessione assente", example: "Unauthorized" },
          { status: 403, description: "Non è tuo e non hai il rango per vederlo", example: "Forbidden" },
          { status: 404, description: "Preventivo inesistente", example: "Not found" },
        ],
      },
      {
        id: "quote-pdf",
        method: "GET",
        path: "/api/quotes/{id}/pdf",
        summary: "Scarica il PDF di un preventivo",
        description:
          "Il PDF del preventivo nella lingua del cliente e nella valuta del documento, intestato alla denominazione del profilo di fatturazione. Con una sessione lo scarica chi può vedere il preventivo; senza sessione serve il `token` pubblico del preventivo, lo stesso del link inviato al cliente, e il workspace è ricavato da quello.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "Identificativo del preventivo" },
          {
            name: "token",
            in: "query",
            required: false,
            type: "string",
            description: "Token pubblico del preventivo, per scaricarlo senza sessione",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Il PDF (application/pdf), allegato come Preventivo-{numero}.pdf o Quote-{numero}.pdf",
            example: "%PDF-1.7 …",
          },
          { status: 401, description: "Nessuna sessione e nessun token", example: "Unauthorized" },
          { status: 403, description: "Token errato, o preventivo non visibile a chi lo chiede", example: "Forbidden" },
          { status: 404, description: "Preventivo o token inesistente", example: "Not found" },
        ],
      },
      {
        id: "quote-signed-pdf",
        method: "GET",
        path: "/api/quotes/{id}/signed-pdf",
        summary: "Scarica il PDF esattamente come è stato firmato",
        description:
          "I byte conservati al momento della firma, per chi può vedere il preventivo. Servito solo se corrispondono ancora all'impronta SHA-256 registrata con la firma: un documento firmato che potrebbe essere stato sostituito non prova niente.",
        auth: "session",
        parameters: [
          { name: "id", in: "path", required: true, type: "string", description: "Identificativo del preventivo" },
        ],
        responses: [
          { status: 200, description: "Il PDF firmato (application/pdf)", example: "%PDF-1.7 …" },
          { status: 401, description: "Nessuna sessione", example: "Unauthorized" },
          { status: 403, description: "Preventivo non visibile a chi lo chiede", example: "Forbidden" },
          {
            status: 404,
            description: "Preventivo inesistente, o nessun file firmato conservato",
            example: JSON.stringify({ error: "No signed file kept." }, null, 2),
          },
          {
            status: 409,
            description: "Il file non corrisponde più all'impronta",
            example: JSON.stringify({ error: "The signed file no longer matches its fingerprint." }, null, 2),
          },
        ],
      },
      {
        id: "reports-export",
        method: "GET",
        path: "/api/reports/export",
        summary: "Esporta le attività registrate",
        description:
          "CSV delle chiamate, riunioni, email e note registrate nel periodo, con chi le ha registrate e il record a cui sono collegate (lead, contatto, azienda, trattativa). La data è quella dell'attività, o quella di registrazione se non ne ha una. Fino a 10.000 righe. Prima esportava un registro che il prodotto non scriveva mai: il file conteneva solo l'intestazione. ⚠️ Richiede la capacità `report:manage`, cioè rango amministratore NEL WORKSPACE. Questa riga leggeva il ruolo di piattaforma, che vale «utente» per ogni cliente: l'esportazione era vietata a chiunque, proprietario compreso, e restava aperta solo al personale di Flux.",
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
            description: "Solo le attività registrate da questa persona",
          },
        ],
        responses: [
          {
            status: 200,
            description: "Il CSV",
            example:
              "Date,User,Email,Type,Lead,Contact,Company,Deal,Minutes,Content\n2026-09-05 10:30,Anna Rossi,anna@studio.it,call,,Mario Rossi,Rossi Impianti Srl,Impianto sede,15,Richiamare dopo il 20",
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

/** The staff reference: every route, internal ones included. */
export function ApiDocsClient() {
  return <ApiDocsView groups={GROUPS} variant="admin" />;
}

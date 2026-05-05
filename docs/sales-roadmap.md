# Flux CRM — Sales Section Development Roadmap

> **Analisi effettuata:** maggio 2026  
> **Maturity level attuale:** 6/10 — CRM funzionale per PMI, mancano funzionalità di intelligence, forecasting e collaboration enterprise-grade.

---

## Stato attuale della sezione vendite

### Cosa funziona bene
- Kanban pipeline con drag-and-drop, stage personalizzabili, probabilità auto-assegnata
- Deal lifecycle completo (open → won/lost) con webhook e automation rules
- Preventivi (quotes) con line items, sconti, tasse, invio email, view token pubblico, tracciamento aperture/click
- Contatti e aziende con modello dati ricco, campi custom, filtri salvati, import/export
- Attività (note, chiamate, riunioni, email) collegate a ogni entità
- Task avanzati: gerarchia, dipendenze (FS/SS/FF/SF), time tracking, RACI multi-assegnatario
- RBAC a 4 livelli (owner / admin / editor / viewer)
- Engine di automazione con regole configurabili da DB
- Reporting di base: KPI, attività per utente, trend giornaliero, performance campagne

### Lacune principali identificate

| Area | Lacuna | Impatto |
|---|---|---|
| Pipeline | Nessun deal forecasting / health score | Alto |
| Pipeline | Nessun bulk action sulle deal | Medio |
| Preventivi | Nessun PDF export | Alto |
| Preventivi | Nessuna firma digitale / e-signature | Alto |
| Preventivi | Nessun workflow di approvazione | Medio |
| Preventivi | Nessun template riutilizzabile | Medio |
| Contatti | Nessun duplicate detection / merge | Alto |
| Contatti | Nessun enrichment automatico | Medio |
| Aziende | Nessuna gerarchia parent/subsidiary | Medio |
| Analytics | Nessun forecasting predittivo | Alto |
| Analytics | Nessun funnel analysis (lead→deal→won) | Alto |
| Analytics | Nessun custom report builder | Medio |
| Analytics | Nessun confronto periodi (MoM, YoY) | Medio |
| Analytics | Nessuna gestione quota/target | Medio |
| Email | Nessuna schedulazione campagne | Medio |
| Email | Nessun A/B testing | Basso |
| Collaborazione | Nessun thread di commenti sulle deal | Medio |
| Sync | Nessun Calendar sync (Google/Outlook) | Medio |
| Prodotti | Catalogo base esistente, mancano categorie, IVA preimpostata, UDM, import/export | Basso |
| Lead | Conversione lead→contatto/deal non automatizzata | Alto |

---

## Piano di sviluppo — Priority tiers

### Tier 1 — Fondamenta mancanti (priorità massima)
*Queste funzionalità bloccano l'adozione professionale del CRM.*

---

#### 1.1 — Catalogo Prodotti ✅ Parzialmente implementato

**Stato attuale:** Il catalogo prodotti è già funzionante a `/dashboard/products` con:
- CRUD completo (create, read, update, delete) con validazione Zod
- Campi: `name`, `sku`, `price`, `description`, `isActive`
- Toggle attivo/inattivo, ricerca per nome o SKU, filtro per stato
- Stats panel con contatori Totale / Attivi / Inattivi
- Selettore prodotti in `QuoteEditForm` con `SearchableSelect` + autocomplete
- Auto-popolamento di `unitPrice` e `description` al momento della selezione
- Supporto dual-mode nei preventivi: prodotto da catalogo **oppure** voce custom libera

**Lacune rimanenti (bassa priorità):**

- Nessuna categoria prodotto (filtro per tipo di servizio/prodotto)
- Nessuna aliquota IVA preimpostata per prodotto (il `taxPercent` viene inserito manualmente in ogni riga preventivo)
- Nessuna unità di misura (ore, pezzi, giorni, mesi…)
- Nessun import/export CSV del catalogo
- SKU non univoco a livello DB (manca constraint `unique`)
- Nessun costo di acquisto (COGS) — solo prezzo di vendita
- Nessuna paginazione (funziona finché i prodotti sono poche decine)

**Cosa costruire (miglioramenti):**

1. Campo `taxPercent` nel schema prodotto → pre-popola l'aliquota IVA nella riga preventivo alla selezione
2. Campo `unit` (enum: `unit`, `hour`, `day`, `month`, `kg`, `km`…) → mostrato nella riga preventivo
3. Campo `category` (text, nullable) → filtro aggiuntivo nella lista e raggruppamento nel selettore quote
4. Import/export CSV → bottone "Importa" e "Esporta" nella lista prodotti
5. Aggiungere constraint `unique` su `sku` a livello DB

**File da modificare:**
- `src/db/schema.ts` — aggiungere `taxPercent`, `unit`, `category` alla tabella `products`
- `src/actions/products.ts` — aggiornare schema Zod
- `src/app/(main)/dashboard/products/` — aggiornare form con nuovi campi, aggiungere import/export
- `src/app/(main)/dashboard/quotes/[id]/edit/_components/quote-edit-form.tsx` — auto-popolare `taxPercent` e mostrare `unit` alla selezione prodotto

---

#### 1.2 — PDF Export Preventivi

**Perché:** Un preventivo professionale deve essere esportabile. Attualmente mancante, richiesto in ogni CRM.

**Cosa costruire:**
- Libreria: `@react-pdf/renderer` oppure `puppeteer` (headless) via API route
- Route API: `GET /api/quotes/[id]/pdf` con autenticazione + public token
- Template PDF branded con logo, intestazione azienda, line items, totali, note, scadenza
- Bottone "Scarica PDF" nel dettaglio preventivo
- Opzione "Allega PDF" all'invio email preventivo (allegato automatico)
- Configurazione: logo azienda, intestazione personalizzata (in `/dashboard/settings`)

**File da creare:**
- `src/app/api/quotes/[id]/pdf/route.ts`
- `src/components/pdf/quote-pdf-template.tsx`

---

#### 1.3 — Conversione Lead → Company + Contact + Deal ⚠️ Parzialmente implementato, con rischi critici

**Stato attuale:**
Il flusso di conversione esiste (`convertLead()` in `src/actions/crm.ts`, lines 96–162) ma è incompleto e presenta un **rischio di perdita dati** reale.

Cosa funziona:
- `ConvertLeadButton` nella pagina dettaglio lead con dialog di conferma
- Ricerca o creazione di una Company dal `companyName` del lead
- Creazione di un Contact con i dati anagrafici del lead (nome, email, telefono, job title)
- Creazione opzionale di un Deal collegato a company e contact
- Setta `isConverted = true` e `status = "converted"` sul lead
- Dispatcha webhook `lead.converted`
- Badge "Converted" visibile nel dettaglio lead

**Problemi critici:**

1. **Perdita di storia garantita** — Attività e task sono collegati al lead con `ON DELETE CASCADE`. Se il record lead viene mai eliminato, tutta la cronologia scompare. Durante la conversione, queste relazioni non vengono migrate a contact/company/deal: la storia resta agganciata all'entità lead, non al nuovo cliente.

2. **Nessuna tracciabilità bidirezionale** — Il Contact e la Company creati non hanno alcun riferimento al lead di origine (`sourceLeadId`). Non è possibile sapere "da quale lead è nato questo cliente".

3. **Nessun timestamp di conversione** — Il campo `convertedAt` non esiste. Impossibile misurare il ciclo di vita lead-to-customer (metrica fondamentale nei CRM professionali).

4. **Ticket e appuntamenti orfani** — Le entità `tickets` e `appointments` collegate al lead via `leadId` non vengono gestite durante la conversione.

5. **Bypass manuale** — Il campo `status` nel lead modal permette di impostare "converted" manualmente senza passare dal flusso di conversione, lasciando contact/company/deal non creati.

---

**Cosa costruire per completare il flusso:**

**Step 1 — Schema DB** (`src/db/schema.ts`):
```
leads:
  + convertedAt: timestamp (nullable)
  + convertedToContactId: uuid FK → contacts (set null)
  + convertedToCompanyId: uuid FK → companies (set null)
  + convertedToDealId: uuid FK → deals (set null)

contacts:
  + sourceLeadId: uuid FK → leads (set null)

companies:
  + sourceLeadId: uuid FK → leads (set null)
```

**Step 2 — Migrazione storia** in `convertLead()`:

La conversione deve essere **atomica** (una transazione DB unica) e deve:
1. Creare/trovare la **Company** dal `companyName` del lead → assegnare `sourceLeadId`
2. Creare il **Contact** dai dati anagrafici → assegnare `companyId` e `sourceLeadId`
3. Opzionalmente creare un **Deal** → collegare a company e contact
4. **Migrare le attività**: `UPDATE activities SET leadId = NULL, contactId = newContactId, companyId = newCompanyId WHERE leadId = lead.id`
5. **Migrare i task**: stessa logica — `taskId` punta al contact/company, `leadId` viene nullato (non eliminato, il lead rimane)
6. **Migrare i ticket**: `UPDATE tickets SET leadId = NULL, contactId = newContactId WHERE leadId = lead.id`
7. Settare sul lead: `isConverted = true`, `status = "converted"`, `convertedAt = now()`, `convertedToContactId`, `convertedToCompanyId`, `convertedToDealId`
8. Dispatcha webhook `lead.converted`

> Il record lead **non viene eliminato** — rimane come archivio storico con tutti i campi `convertedTo*` che permettono la tracciabilità.

**Step 3 — UI migliorata** (`convert-lead-button.tsx`):
- Il dialog attuale è minimalista (solo toggle "crea deal"). Estendere con:
  - Anteprima dei dati che verranno creati (nome company, nome contact)
  - Campo per scegliere uno stage della pipeline se si crea il deal
  - Avviso visibile: "N attività e M task verranno migrati al nuovo cliente"
  - Link al record creato nel toast di successo (non solo redirect alla lista lead)

**Step 4 — Tracciabilità nell'UI:**
- Nel dettaglio Contact: sezione "Origine" con link al lead sorgente se `sourceLeadId` presente
- Nel dettaglio Company: stessa sezione "Origine"
- Nel dettaglio Lead (già convertito): link diretto a Contact, Company e Deal creati (dai campi `convertedTo*`)

**File da modificare:**
- `src/db/schema.ts` — aggiungere `convertedAt`, `convertedTo*Id` ai leads; `sourceLeadId` a contacts e companies
- `src/db/migrations/` — nuova migration
- `src/actions/crm.ts` — riscrivere `convertLead()` con transazione DB e migrazione storia
- `src/app/(main)/dashboard/leads/[id]/_components/convert-lead-button.tsx` — migliorare UI dialog
- `src/app/(main)/dashboard/contacts/[id]/` — aggiungere sezione "Origine lead"
- `src/app/(main)/dashboard/companies/[id]/` — aggiungere sezione "Origine lead"

---

#### 1.4 — Duplicate Detection Contatti/Aziende

**Perché:** Senza dedup, i dati CRM degradano rapidamente. Blocco fondamentale per la qualità dei dati.

**Cosa costruire:**
- Server-side: funzione `findDuplicates(email, phone, name)` che cerca match esatti e fuzzy
- Chiamata durante la creazione di contatti/aziende (prima del save)
- UI: banner "Possibili duplicati trovati" con anteprima dei record simili e azioni:
  - "Usa record esistente" → apre il record trovato
  - "Continua comunque" → salva il nuovo record
- Merge tool: pagina dedicata (o modal) per fondere due record:
  - Scegli quale valore mantenere campo per campo
  - Migra automaticamente relazioni (deal, attività, task, preventivi)
  - Archivia il record duplicato
- Batch dedup: report nella sezione Settings con lista duplicati rilevati (matching su email o nome+telefono)

**File da creare:**
- `src/lib/duplicate-detection.ts`
- `src/app/(main)/dashboard/contacts/_components/duplicate-warning.tsx`
- `src/app/(main)/dashboard/contacts/_components/merge-contacts-modal.tsx`

---

### Tier 2 — Intelligence e Analytics (priorità alta)

---

#### 2.1 — Pipeline Forecasting

**Perché:** Il forecasting è la funzionalità più richiesta dai sales manager. Senza, il CRM è un glorificato elenco di opportunità.

**Cosa costruire:**
- **Revenue Forecast dashboard** in `/dashboard/pipeline` (tab aggiuntivo):
  - Forecast mensile/trimestrale: `Σ(amount × probability)` per data chiusura attesa
  - Grafico a barre: committed (prob > 80%) vs. best case (prob > 50%) vs. pipeline totale
  - Confronto forecast vs. target (se quota definita — vedi 2.3)
  - Breakdown per stage e per owner
- **Deal Health Score** (calcolato lato server):
  - Score 0–100 basato su: giorni nello stage corrente, attività recenti (< 7 giorni), date di chiusura in ritardo, probabilità relativa allo stage
  - Badge colorato (verde/giallo/rosso) su ogni card kanban e in lista
  - Ordinamento pipeline per health score
- Aggiornamento automatico: `after()` callback al salvataggio deal

**File da modificare:**
- `src/actions/pipeline.ts` — aggiungere calcolo health score + forecast query
- `src/app/(main)/dashboard/pipeline/_components/` — tab Forecast + badge salute

---

#### 2.2 — Funnel Analysis

**Perché:** Capire dove i lead si bloccano è fondamentale per ottimizzare il processo di vendita.

**Cosa costruire:**
- Pagina o sezione in `/dashboard/analytics`:
  - Funnel interattivo: Lead → Contatto → Deal → Preventivo Inviato → Won
  - Metriche per ogni stage: count, conversion rate, tempo medio di transizione
  - Filtri: periodo, owner, fonte (source), prodotto
- Drill-down: clic su uno stage mostra i record in quello stato
- Cohort: raggruppamento per mese di creazione lead (per analisi tendenze)
- Grafico Sankey opzionale per visualizzare i flussi di conversione

**File da modificare:**
- `src/actions/reports.ts` — aggiungere query funnel
- `src/app/(main)/dashboard/analytics/_components/` — FunnelChart component

---

#### 2.3 — Gestione Quote/Target di Vendita

**Perché:** I sales manager devono poter definire obiettivi e misurare il raggiungimento.

**Cosa costruire:**
- Schema DB: tabella `salesTargets` — `userId`, `period` (YYYY-MM / YYYY-QN), `targetAmount`, `targetDeals`
- UI in `/dashboard/settings/targets` (admin-only):
  - Definizione target per utente, per mese o trimestre
  - Vista a griglia: tutti gli utenti × periodi
- Widget "Progress vs. Target" nel dashboard personale dell'utente:
  - Barra di progresso: won YTD vs. target annuale
  - Breakdown mensile
- Incluso nel Forecast Dashboard (2.1) come linea obiettivo

**File da creare:**
- `src/db/migrations/` — aggiungere `salesTargets` table
- `src/actions/targets.ts`
- `src/app/(main)/dashboard/settings/targets/`

---

#### 2.4 — Custom Report Builder

**Perché:** Ogni team di vendita ha esigenze diverse. Un report builder riduce il supporto richiesto.

**Cosa costruire:**
- UI drag-and-drop in `/dashboard/reports/builder`:
  - Scegli entità sorgente: deals, contacts, companies, activities, quotes
  - Scegli campi da mostrare (inclusi campi custom)
  - Filtri: qualsiasi campo, operatori (=, >, <, contiene, tra date)
  - Raggruppamento (group by): stage, owner, mese, fonte
  - Aggregazioni: count, sum, avg, min, max
  - Scegli tipo di visualizzazione: tabella, bar chart, line chart, pie
- Salvataggio report con nome → appaiono in sidebar sotto "Reports"
- Export CSV del risultato
- Condivisione report (link o visibile a tutti gli admin)

**File da creare:**
- `src/app/(main)/dashboard/reports/builder/`
- `src/actions/report-builder.ts`
- `src/components/report-builder/` — query builder UI

---

### Tier 3 — Workflow e Collaboration (priorità media)

---

#### 3.1 — Workflow di Approvazione Preventivi

**Perché:** Nelle aziende strutturate, i preventivi sopra una certa soglia richiedono approvazione del manager prima dell'invio.

**Cosa costruire:**
- Configurazione in Settings: soglia importo per approvazione, approver (ruolo admin o utente specifico)
- Nuovo status preventivo: `pending_approval`
- Flusso:
  1. Utente clicca "Invia per Approvazione"
  2. Preventivo passa a `pending_approval`
  3. Notifica in-app + email all'approver
  4. Approver vede lista preventivi in attesa in `/dashboard/quotes?status=pending_approval`
  5. Approver approva (→ `draft`, pronto per invio) o rifiuta (→ `draft`, con nota rifiuto)
  6. Notifica al creatore
- Audit trail: ogni approvazione/rifiuto loggato in `quoteActivities`

**File da modificare:**
- `src/db/schema.ts` — aggiungere status `pending_approval`, campo `approvalNote`
- `src/actions/quotes.ts` — aggiungere `requestApproval()`, `approveQuote()`, `rejectQuote()`
- `src/app/(main)/dashboard/quotes/_components/` — UI approvazione

---

#### 3.2 — Thread di Commenti sulle Deal

**Perché:** Oggi le deal hanno solo "attività" strutturate. I team hanno bisogno di comunicazione informale contestuale senza usare Slack/email.

**Cosa costruire:**
- Schema: tabella `dealComments` — `dealId`, `userId`, `content` (markdown), `parentId` (per reply), `createdAt`, `editedAt`
- UI: sezione "Commenti" nel dettaglio deal con:
  - Thread view (reply indentate)
  - Mention `@utente` con autocomplete → notifica all'utente menzionato
  - Markdown support (grassetto, codice, link)
  - Edit/delete proprio commento (entro 5 minuti)
  - Indicatore "non letto" per commenti nuovi dall'ultima visita
- Notifiche in-app per mention e reply

**File da creare:**
- `src/db/migrations/` — tabella `dealComments`
- `src/actions/deal-comments.ts`
- `src/app/(main)/dashboard/pipeline/[dealId]/_components/comments-thread.tsx`

---

#### 3.3 — Schedulazione Campagne Email

**Perché:** Oggi le campagne si inviano subito. I marketer devono poter pianificare in anticipo.

**Cosa costruire:**
- Campo `scheduledAt` su `marketingCampaigns`
- UI: date-time picker nella modal di invio campagna → "Invia ora" vs. "Pianifica invio"
- Cron job (`/api/cron/campaign-scheduler`) che ogni ora controlla campagne con `scheduledAt <= now` e status `scheduled` → lancia l'invio
- Lista campagne pianificate con possibilità di cancellare la schedulazione
- Timezone support (salvare scheduledAt in UTC, mostrare nel timezone dell'utente)

**File da modificare:**
- `src/db/schema.ts` — aggiungere `scheduledAt` a `marketingCampaigns`
- `src/actions/marketing.ts` — aggiungere `scheduleCampaign()`
- `src/app/api/cron/campaign-scheduler/route.ts` — nuovo endpoint cron

---

#### 3.4 — Calendar Sync (Google Calendar / Outlook)

**Perché:** Le attività (riunioni, chiamate) rimangono isolate nel CRM. I venditori lavorano dal calendario, non dal CRM.

**Cosa costruire:**
- OAuth flow per Google Calendar e Microsoft Outlook (separato dall'OAuth login)
- Tabella `calendarTokens` — `userId`, `provider`, `accessToken`, `refreshToken`, `expiresAt`
- Sync bidirezionale:
  - CRM → Calendar: creare attività di tipo "meeting" o "call" → crea evento nel calendario collegato
  - Calendar → CRM (opzionale, v2): webhook Google/Microsoft → crea attività nel CRM
- UI in Settings: "Collega Calendario" con pulsanti Google/Outlook e stato connessione
- Indicatore nell'activity form: "Aggiungi al calendario"

**File da creare:**
- `src/app/api/auth/google-calendar/` — OAuth callback
- `src/app/api/auth/outlook/` — OAuth callback
- `src/lib/calendar-sync.ts` — helper per creare/aggiornare eventi

---

### Tier 4 — E-Signature e Gestione Documenti (priorità media-bassa)

---

#### 4.1 — E-Signature Preventivi

**Perché:** La firma digitale chiude il loop quote-to-cash senza scambi di email/PDF firmati manualmente.

**Opzioni di integrazione:**
- **Hosted (consigliato):** [Docusign](https://developers.docusign.com/) o [HelloSign/Dropbox Sign](https://www.hellosign.com/api) via API
- **Self-hosted leggero:** firma con mouse/touch nella pagina pubblica del preventivo (canvas HTML5), salvataggio immagine firma + timestamp + IP address

**Cosa costruire (opzione self-hosted):**
- Nella pagina pubblica del preventivo (`/q/[token]`):
  - Sezione firma in fondo: canvas touch/mouse + campo "Nome e Cognome" + checkbox "Accetto i termini"
  - Submit → salva firma come base64 image in DB, setta `acceptedAt`, `signerName`, `signerIp`, cambia status a `accepted`
  - Email di conferma al cliente + notifica al venditore
- Campo `signatureData` (text/blob), `signerName`, `signerIp` in tabella `quotes`
- Firma visibile nel PDF export (4.1 → vedi 1.2)

**File da modificare:**
- `src/db/schema.ts` — aggiungere campi firma a `quotes`
- `src/app/(external)/q/[token]/` — aggiungere firma canvas
- `src/actions/quotes.ts` — `signQuote()`

---

#### 4.2 — Template Preventivi

**Perché:** I venditori riutilizzano sempre gli stessi prodotti/servizi. I template accelerano la creazione.

**Cosa costruire:**
- Schema: tabella `quoteTemplates` — `name`, `description`, `ownerId`, `isPublic`, `currency`, `validityDays`, `notes`
- Tabella `quoteTemplateItems` — mirror di `quoteItems` ma senza `quoteId`
- UI in `/dashboard/quotes`:
  - Sezione "Template" separata dalla lista preventivi
  - Salva preventivo esistente come template (button nel dettaglio)
  - Crea preventivo da template: seleziona template → pre-compila tutti i campi e line items
- Gestione template: CRUD, visibilità pubblica/privata

**File da creare:**
- `src/db/migrations/` — tabelle `quoteTemplates`, `quoteTemplateItems`
- `src/actions/quote-templates.ts`
- `src/app/(main)/dashboard/quotes/templates/`

---

### Tier 5 — Mobile e Real-time (priorità bassa, effort alto)

---

#### 5.1 — Real-time Updates (WebSocket / SSE)

**Perché:** In un team che lavora sullo stesso CRM, i dati cambiano mentre sei sulla pagina. Oggi c'è solo `revalidatePath`.

**Approccio consigliato:** Server-Sent Events (SSE) — più semplice di WebSocket, funziona con Next.js App Router.

**Cosa costruire:**
- Route SSE: `GET /api/events` con autenticazione — stream eventi per userId
- Client: hook `useRealtimeEvents()` che si connette all'SSE e invalida le query React Query (o chiama `router.refresh()`) sui messaggi
- Server: dispatcher `emitEvent(userId, eventType, payload)` chiamato nei server actions dopo mutazioni critiche
- Event types iniziali: `deal.updated`, `deal.moved`, `task.assigned`, `comment.added`, `notification.new`
- Fallback: polling ogni 30s se SSE non supportato

**File da creare:**
- `src/app/api/events/route.ts` — SSE endpoint
- `src/hooks/use-realtime-events.ts`
- `src/lib/event-emitter.ts` — Redis pub/sub o in-memory (Neon serverless → Redis consigliato)

---

#### 5.2 — PWA / Mobile Optimization

**Perché:** I venditori sul campo usano smartphone. Layout desktop-first limita l'usabilità mobile.

**Cosa costruire:**
- `manifest.json` e service worker per installabilità PWA
- Audit responsive: sidebar collassabile su mobile (hamburger menu), table → card layout su mobile, modal fullscreen su mobile
- Pagine prioritarie da ottimizzare: pipeline kanban (scroll orizzontale), deal detail, contact detail, quick task form
- Push notifications via Web Push API (attività assegnate, scadenze task)

---

## Dipendenze e ordine di implementazione consigliato

```
Tier 1 (settimane 1-6):
  1. Catalogo Prodotti (1.1) → prerequisito per Quote Templates (4.2)
  2. PDF Export Preventivi (1.2) → prerequisito per E-Signature (4.1)
  3. Conversione Lead (1.3) → standalone
  4. Duplicate Detection (1.4) → standalone

Tier 2 (settimane 7-12):
  5. Pipeline Forecasting (2.1) → usa dati già in DB
  6. Funnel Analysis (2.2) → richiede dati lead + deal completi
  7. Sales Targets (2.3) → prerequisito per Forecasting completo
  8. Report Builder (2.4) → standalone, lungo da implementare

Tier 3 (settimane 13-18):
  9. Approval Workflow Preventivi (3.1) → richiede PDF export
  10. Deal Comments (3.2) → standalone
  11. Campaign Scheduling (3.3) → standalone
  12. Calendar Sync (3.4) → lungo per OAuth

Tier 4 (settimane 19-24):
  13. E-Signature (4.1) → richiede PDF export
  14. Quote Templates (4.2) → richiede Catalogo Prodotti

Tier 5 (settimane 25+):
  15. Real-time SSE (5.1) → infrastrutturale, alto impatto
  16. PWA/Mobile (5.2) → cross-cutting, lungo
```

---

## Stack tecnico — scelte consigliate

| Funzionalità | Libreria/Approccio |
|---|---|
| PDF Generation | `@react-pdf/renderer` (SSR-safe) oppure Puppeteer via API route |
| E-Signature | Canvas HTML5 self-hosted (low cost) oppure Docusign API |
| Funnel Chart | `recharts` (già probabile in codebase) |
| Gantt dependencies viz | `svar-ui/react-gantt` (già selezionato dal dev) |
| Real-time | Server-Sent Events (`ReadableStream`) |
| Calendar sync | Google Calendar API v3 + Microsoft Graph API |
| Duplicate detection | Levenshtein distance (`fastest-levenshtein`) + DB query |
| Report Builder | `react-querybuilder` per il UI del filtro |

---

## Metriche di successo

Una volta implementate le funzionalità Tier 1 e Tier 2, il CRM passerà da livello 6/10 a **8.5/10**, competitivo con soluzioni come Pipedrive e Freshsales nella fascia PMI/Mid-market, con i seguenti benchmark:

- **Time-to-quote:** < 3 minuti (da zero a preventivo inviato)
- **Pipeline visibility:** forecasting a 30/60/90 giorni disponibile
- **Data quality:** deduplicazione automatica < 2% duplicati
- **Conversion tracking:** funnel completo lead-to-cash visibile
- **Sales productivity:** template + calendar sync riducono data entry del 40%

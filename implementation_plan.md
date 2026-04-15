# Flux CRM — Piano di Sviluppo Completo

## Panoramica del Progetto

**Flux CRM** è una piattaforma CRM full-stack costruita con Next.js 16, TypeScript, Tailwind CSS v4, shadcn/ui, Drizzle ORM (Neon Postgres) e NextAuth v5. Il progetto ha una base molto solida: schema DB completo, sistema di autenticazione con RBAC a 4 livelli, motore di automazione, e diversi moduli già funzionanti.

---

## Analisi dello Stato Attuale

### ✅ Moduli Completamente Implementati

| Modulo | Route | Stato |
|---|---|---|
| **Pipeline / Deals** | `/dashboard/pipeline` | ✅ Kanban drag-and-drop, detail view, stage management |
| **Contacts** | `/dashboard/contacts` | ✅ Lista, detail `[id]`, filtri avanzati, custom fields |
| **Companies** | `/dashboard/companies` | ✅ Lista, detail `[id]`, attività, task |
| **Leads** | `/dashboard/leads` | ✅ Lista, detail `[id]`, conversione in contact |
| **Tasks** | `/dashboard/tasks` | ✅ Lista, filtri, assegnazione utenti |
| **Quotes** | `/dashboard/quotes` | ✅ Lista, nuova (`/new`), detail `[id]`, email invio |
| **Support / Tickets** | `/dashboard/support` + `/tickets` | ✅ Dashboard, Kanban, detail `[id]`, SLA |
| **Marketing Campaigns** | `/dashboard/marketing/campaigns` | ✅ Campagne, invio email, tracking |
| **Email Templates** | `/dashboard/marketing/templates` | ✅ Builder HTML, preview, gestione |
| **Automation Rules** | `/dashboard/automation` | ✅ Motore regole con condizioni avanzate, log |
| **Reports** | `/dashboard/reports` | ✅ KPI, attività per utente/azione, trend, campagne |
| **Users** | `/dashboard/users` | ✅ Lista, inviti, gestione ruoli |
| **Settings** | `/dashboard/settings` | ✅ Custom fields, email, webhooks, SLA |
| **Calendar** | `/dashboard/calendar` | ✅ Vista eventi, creazione |
| **Internal Chat** | (componenti pronti) | ✅ DM + Group conversations in schema |
| **Notifications** | (componenti pronti) | ✅ In-app notifications, mark as read |

### ⚠️ Moduli Abbozzati / Incompleti

| Modulo | Route | Problemi Identificati |
|---|---|---|
| **CRM Dashboard** | `/dashboard/crm` | Solo pagina base. Mancano KPI reali, funnel, grafici collegati a DB |
| **Finance Dashboard** | `/dashboard/finance` | Dati statici mock. Tab "Activity", "Insights", "Utilities" disabilitati |
| **Analytics Dashboard** | `/dashboard/analytics` | Componenti esistono ma i dati sono probabilmente mock |
| **Support Dashboard** | `/dashboard/support` | `avgResolutionTime` hardcoded a "4h 32m", customer satisfaction mock |
| **Internal Chat** | `/dashboard/chat` (mancante) | Schema DB pronto, Server Actions pronti (`chat-internal.ts`), ma nessuna route UI |
| **Products / Catalog** | `/dashboard/products` (mancante) | Schema `products` e `orderItems` presente ma nessuna UI |
| **Orders** | `/dashboard/orders` (mancante) | Schema `orders` + `orderItems` presente ma nessuna UI |
| **Task Board** | `/dashboard/tasks` | Lista semplice, manca vista Kanban |
| **Leads Detail** | `/dashboard/leads/[id]` | Verificare completezza rispetto a contacts/companies |
| **Reports Avanzati** | `/dashboard/reports` | Mancano: revenue report, deal forecast, ticket analytics |

### ❌ Funzionalità Mancanti Chiave

| Funzionalità | Priorità | Note |
|---|---|---|
| **Chat Interna (UI)** | 🔴 Alta | Schema e actions pronti, solo la route manca |
| **Catalogo Prodotti** | 🔴 Alta | CRUD completo, collegato a Quotes e Orders |
| **Gestione Ordini** | 🔴 Alta | Schema pronto, nessuna UI |
| **CRM Dashboard KPI reali** | 🔴 Alta | Collegare a DB reale |
| **Task Kanban View** | 🟡 Media | Vista board per tasks, come il pipeline |
| **Forecast Pipeline** | 🟡 Media | Previsione ricavi da deals per stage |
| **Revenue Reports** | 🟡 Media | Ricavi da deals won, quotes convertite |
| **Ticket Analytics** | 🟡 Media | Report specifici per support: CSAT, MTTR, FCR |
| **Import/Export Globale** | 🟡 Media | Import CSV già esiste per alcune entità (components esistenti) |
| **Sidebar Chat** | 🟡 Media | Aggiungere chat nella sidebar navigation |
| **Finance Dashboard Reale** | 🟢 Bassa | Collegare a dati reali (deals won = revenue) |
| **Analytics Template** | 🟢 Bassa | Connettere ai dati reali del CRM |
| **Roles CRUD** | 🟢 Bassa | Esiste `/dashboard/roles` nella struttura? |
| **Lead Scoring automatico** | 🟢 Bassa | Campo `leadScore` presente ma non popolato automaticamente |
| **Email preview pubblico quote** | 🟢 Bassa | Link esterno per customer per accettare/declinare |
| **Onboarding / Welcome flow** | 🟢 Bassa | Nessun wizard di setup iniziale |

---

## Piano di Sviluppo

Le funzionalità sono ordinate per impatto e fattibilità (dal più veloce al più complesso).

---

### FASE 1 — Quick Wins ad Alto Impatto (1–2 settimane)

#### 1.1 · Chat Interna (UI completa)
Il backend è già completamente pronto (`chat-internal.ts` server actions, schema `dmConversations`, `dmMessages`, `dmConversationMembers`). Serve solo la route UI.

**File da creare:**
- `src/app/(main)/dashboard/chat/page.tsx` — Layout main con lista conversazioni
- `src/app/(main)/dashboard/chat/[id]/page.tsx` — Vista conversazione singola
- `src/app/(main)/dashboard/chat/_components/conversation-list.tsx`
- `src/app/(main)/dashboard/chat/_components/message-thread.tsx`
- `src/app/(main)/dashboard/chat/_components/new-conversation-modal.tsx`
- Aggiungere item in `sidebar-items.ts`

**Complessità:** ⭐⭐ (Media — backend pronto)

---

#### 1.2 · Catalogo Prodotti (CRUD)
Schema `products` con `name`, `sku`, `price`, `isActive` già nel DB. Già usato in `quotes` e `quoteItems`.

**File da creare:**
- `src/app/(main)/dashboard/products/page.tsx` — Lista con tabella
- `src/app/(main)/dashboard/products/[id]/page.tsx` — Detail/edit
- `src/actions/products.ts` — CRUD actions
- Aggiungere in sidebar sotto "Sales"

**Complessità:** ⭐ (Bassa — pattern già esistente in contacts/companies)

---

#### 1.3 · CRM Dashboard KPI Reali
La pagina `/dashboard/crm` è quasi vuota (solo layout). Deve diventare la vera homepage del CRM.

**Contenuto:**
- KPI Cards: Leads attivi, Deals aperti (valore totale), Contatti, Task in scadenza oggi
- Funnel pipeline (deals per stage → bar chart)
- Recent activities stream
- Top deals
- Task di oggi
- Campagne attive

**File da modificare/creare:**
- `src/app/(main)/dashboard/crm/page.tsx` — Ricostruire completo (server component)
- `src/app/(main)/dashboard/crm/_components/crm-kpi-cards.tsx`
- `src/app/(main)/dashboard/crm/_components/pipeline-funnel-chart.tsx`
- `src/app/(main)/dashboard/crm/_components/recent-feed.tsx`
- `src/actions/dashboard.ts` — Già esiste, verificare e ampliare

**Complessità:** ⭐⭐ (Media)

---

#### 1.4 · Task Kanban View
I tasks hanno già status `todo/done`. Aggiungere stato `in_progress`. Vista board drag-and-drop come il pipeline.

**DB Change:**
- Aggiungere status `in_progress` alla validazione (solo a livello app — il DB accetta qualsiasi testo)

**File da creare/modificare:**
- `src/app/(main)/dashboard/tasks/_components/task-board.tsx` — DnD Kanban con @dnd-kit (già usato)
- `src/app/(main)/dashboard/tasks/page.tsx` — Aggiungere tab List/Board

**Complessità:** ⭐⭐ (Media — pattern già presente nel pipeline)

---

### FASE 2 — Moduli Sales Completi (2–3 settimane)

#### 2.1 · Gestione Ordini (UI completa)
Schema `orders` + `orderItems` già nel DB ma mai esposto nell'UI.

**File da creare:**
- `src/app/(main)/dashboard/orders/page.tsx` — Lista ordini
- `src/app/(main)/dashboard/orders/[id]/page.tsx` — Detail ordine
- `src/app/(main)/dashboard/orders/new/page.tsx` — Creazione
- `src/actions/orders.ts` — CRUD
- Aggiungere in sidebar sotto "Sales"

**Complessità:** ⭐⭐ (Media)

---

#### 2.2 · Pipeline Forecast
Vista aggiuntiva nel pipeline per prevedere i ricavi futuri.

**Contenuto:**
- Ricavi attesi per mese (groupBy `expectedCloseDate`)
- Win rate per stage
- Weighted pipeline value (amount × probability)
- Confronto periodo precedente

**File da creare:**
- `src/app/(main)/dashboard/pipeline/report/page.tsx` — Forecast view (route già esistente come stub)
- `src/app/(main)/dashboard/pipeline/report/_components/` — Chart components
- Aggiungere query a `src/actions/pipeline.ts`

**Complessità:** ⭐⭐ (Media)

---

#### 2.3 · Report: Revenue & Sales Analytics
Estendere il modulo reports con sezione vendite specifica.

**Metriche da aggiungere:**
- Revenue totale da deals won
- Average Deal Size
- Sales velocity
- Quote acceptance rate
- Revenue per utente/owner
- Grafico revenue mensile

**File da modificare:**
- `src/actions/reports.ts` — Aggiungere `getSalesReport()`, `getRevenueByPeriod()`, `getQuoteStats()`
- `src/app/(main)/dashboard/reports/_components/` — Aggiungere tab "Sales" nel report client

**Complessità:** ⭐⭐ (Media)

---

### FASE 3 — Completamento Moduli Esistenti (2–3 settimane)

#### 3.1 · Support Dashboard — Dati Reali
Sostituire tutti i valori mock con dati reali dal DB.

**Problemi attuali:**
- `avgResolutionTime` → hardcoded "4h 32m"
- `satisfaction` → sempre 92 (nessun dato surveys)
- Nessun ticket analytics (trend, MTTR, FCR)

**Fix:**
- Calcolare `avgResolutionTime` da `resolvedAt - createdAt` su tickets chiusi
- Aggiungere tabella `ticketSatisfaction` (CSAT surveys) — **schema change**
- Creare `src/actions/support-analytics.ts` con metriche reali

**Complessità:** ⭐⭐⭐ (Alta — richiede schema change + calcoli)

#### 3.2 · Ticket Analytics Report
Nuova sezione in `/dashboard/reports` dedicata al support.

**Metriche:**
- Mean Time to Resolution (MTTR)
- First Contact Resolution (FCR)
- Ticket volume per canale/periodo
- SLA compliance rate
- Agent leaderboard

**Complessità:** ⭐⭐ (Media)

---

#### 3.3 · Finance Dashboard — Collegamento a Dati Reali
Sostituire i dati mock con dati da deals/quotes.

**Mapping:**
- "Revenue" → somma `deals.amount` dove `status = 'won'`
- "Pipeline value" → somma `deals.amount` dove `status = 'open'`
- "Quotes sent/accepted" → da `quotes` table

**Complessità:** ⭐ (Bassa)

---

#### 3.4 · Lead Scoring Automatico  
Il campo `leadScore` esiste ma non viene calcolato. Aggiungere logica di scoring automatica.

**Regole scoring (esempi):**
- +10 ha email
- +10 ha telefono
- +20 ha company_name
- +15 status non è "unqualified"
- +25 marketingConsent = true
- Rating bonus: hot=30, warm=15, cold=0

**Integrazione:**
- Calcolare score in `src/actions/crm.ts` al create/update
- Oppure come automation rule nel motore esistente

**Complessità:** ⭐ (Bassa)

---

### FASE 4 — Miglioramenti UX & Raffinamenti (ongoing)

#### 4.1 · Global Search Potenziato
Aggiungere ricerca globale multi-entità (se non già presente).

#### 4.2 · Bulk Actions
Operazioni massive su lead/contacts/deals (delete, assign, tag).

#### 4.3 · Email Preview Pubblica per Quote
Link esterno `/q/[token]` per customer acceptance senza login.

#### 4.4 · Onboarding Wizard
Wizard di setup iniziale per nuovi workspace (invita team, configura pipeline stages, crea primo deal).

#### 4.5 · Mobile Responsive Polish
Audit e miglioramento dell'esperienza mobile su tutti i moduli.

#### 4.6 · Roles Management UI
Route `/dashboard/roles` per gestione permessi granulare (se richiesto oltre RBAC attuale).

---

## Riepilogo Priorità

```
🔴 ALTA — Da fare subito:
  1. Chat Interna UI           (backend pronto, solo UI mancante)
  2. Catalogo Prodotti         (schema pronto, pattern semplice)
  3. CRM Dashboard reale       (homepage del CRM praticamente vuota)
  4. Task Kanban               (miglioramento UX significativo)

🟡 MEDIA — Fase 2–3:
  5. Gestione Ordini           (schema pronto)
  6. Pipeline Forecast         (route stub già presente)
  7. Revenue Reports           (estendere reports esistenti)
  8. Support Dashboard reale   (sostituire mock data)
  9. Ticket Analytics Report

🟢 BASSA — Miglioramenti:
 10. Finance Dashboard reale
 11. Lead Scoring automatico
 12. Global Search
 13. Bulk Actions
 14. Quote Public Preview
 15. Onboarding Wizard
```

---

## Stack & Vincoli Tecnici

- **Framework:** Next.js 16 App Router (Server Components + Server Actions)
- **DB:** Drizzle ORM + Neon Postgres
- **Auth:** NextAuth v5, RBAC 4 livelli (owner > admin > editor > viewer)
- **UI:** shadcn/ui + Tailwind CSS v4
- **DnD:** @dnd-kit (già in use nel pipeline)
- **Charts:** Recharts (già importato)
- **Forms:** react-hook-form + zod
- **Linting:** Biome (non ESLint)
- **Pattern:** ogni mutazione va in `src/actions/*.ts`, ogni route in `src/app/(main)/dashboard/`

## Nota Architetturale

Il progetto usa un pattern di **colocation**: ogni route contiene la propria cartella `_components/`. I componenti condivisi CRM vanno in `src/components/crm/`. **Seguire sempre questo pattern** per mantenere la coerenza del codebase.

---

*Piano generato il 14 Aprile 2026 — analisi basata su 50+ file ispezionati*

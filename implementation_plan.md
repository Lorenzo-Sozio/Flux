# Flux CRM — Piano di Sviluppo Completo

> **Ultimo aggiornamento:** 16 Aprile 2026

---

## Analisi dello Stato Attuale

### ✅ Moduli Completamente Implementati

| Modulo | Route | Stato |
|---|---|---|
| **Pipeline / Deals** | `/dashboard/pipeline` | ✅ Kanban drag-and-drop, detail view, stage management |
| **Contacts** | `/dashboard/contacts` | ✅ Lista, detail `[id]`, filtri avanzati, custom fields |
| **Companies** | `/dashboard/companies` | ✅ Lista, detail `[id]`, attività, task |
| **Leads** | `/dashboard/leads` | ✅ Lista, detail `[id]`, conversione in contact |
| **Tasks** | `/dashboard/tasks` | ✅ Lista + **Kanban Board** (drag-and-drop, colonne Todo/In Progress/Done) |
| **Quotes** | `/dashboard/quotes` | ✅ Lista, nuova (`/new`), detail `[id]`, email invio |
| **Products** | `/dashboard/products` | ✅ CRUD completo, toggle attivo/inattivo, integrato con Quotes |
| **Support / Tickets** | `/dashboard/support` + `/tickets` | ✅ Dashboard, Kanban, detail `[id]`, SLA |
| **Marketing Campaigns** | `/dashboard/marketing/campaigns` | ✅ Campagne, invio email, tracking |
| **Email Templates** | `/dashboard/marketing/templates` | ✅ Builder HTML, preview, gestione |
| **Automation Rules** | `/dashboard/automation` | ✅ Motore regole con condizioni avanzate, log |
| **Reports** | `/dashboard/reports` | ✅ KPI, attività per utente/azione, trend, campagne |
| **Users** | `/dashboard/users` | ✅ Lista, inviti, gestione ruoli |
| **Settings** | `/dashboard/settings` | ✅ Custom fields, email, webhooks, SLA |
| **Calendar** | `/dashboard/calendar` | ✅ Vista eventi, creazione |
| **Internal Chat** | (widget globale) | ✅ Widget floating DM + Group, unread badge, mute, delete, notifiche |
| **Notifications** | (componenti pronti) | ✅ In-app notifications, mark as read, polling |

### ⚠️ Moduli Abbozzati / Incompleti

| Modulo | Route | Stato attuale |
|---|---|---|
| **CRM Dashboard** | `/dashboard/crm` | ✅ KPI reali, pipeline funnel, top deals, recent activities feed |
| **Finance Dashboard** | `/dashboard/finance` | ⚠️ Dati statici mock. Tab "Activity", "Insights", "Utilities" disabilitati |
| **Analytics Dashboard** | `/dashboard/analytics` | ⚠️ Componenti esistono, dati probabilmente mock |
| **Support Dashboard** | `/dashboard/support` | ✅ `avgResolutionTime` calcolato da dati reali (resolvedAt - createdAt) |
| **Chat Route dedicata** | `/dashboard/chat` | ✅ Pagina full-screen con lista conversazioni + thread, sidebar entry |
| **Orders** | `/dashboard/orders` | ✅ Lista, stats, new order dialog, detail `[id]`, add/remove items |
| **Pipeline Forecast** | `/dashboard/pipeline/report` | ⚠️ Route stub presente, contenuto da implementare |
| **Reports Avanzati** | `/dashboard/reports` | ⚠️ Mancano: revenue report, deal forecast, ticket analytics |

### ❌ Funzionalità Mancanti

| Funzionalità | Priorità | Note |
|---|---|---|
| ~~**Gestione Ordini**~~ | ✅ Completato | UI completa: lista, stats, new order, detail con line items |
| ~~**CRM Dashboard KPI reali**~~ | ✅ Completato | Pipeline funnel, top deals, recent activities feed |
| **Forecast Pipeline** | 🟡 Media | Previsione ricavi da deals per stage, route stub presente |
| **Revenue Reports** | 🟡 Media | Ricavi da deals won, quotes convertite |
| **Ticket Analytics** | 🟡 Media | Report specifici per support: CSAT, MTTR, FCR |
| **Finance Dashboard Reale** | 🟡 Media | Collegare a dati reali (deals won = revenue, quotes) |
| **Chat Route dedicata** | 🟡 Media | Pagina full-screen `/dashboard/chat` + voce sidebar |
| **Import/Export Globale** | 🟡 Media | Import CSV già esiste per alcune entità |
| **Support Dashboard reale** | 🟡 Media | Sostituire avgResolutionTime e satisfaction con dati DB |
| **Analytics Template** | 🟢 Bassa | Connettere ai dati reali del CRM |
| **Roles CRUD** | 🟢 Bassa | Route `/dashboard/roles` per permessi granulari |
| **Lead Scoring automatico** | 🟢 Bassa | Campo `leadScore` presente, logica da implementare |
| **Email preview pubblico quote** | 🟢 Bassa | Link `/q/[token]` per customer acceptance senza login |
| **Onboarding / Welcome flow** | 🟢 Bassa | Wizard setup iniziale |

---

## Piano di Sviluppo

### ✅ FASE 1 — Completata

#### 1.1 · Chat Interna (Widget globale) ✅
Widget floating disponibile su tutte le pagine. Supporta DM, gruppi, unread badge, mute, delete conversazione, notifiche in-app.
- `src/components/chat/chat-widget.tsx`
- `src/actions/chat-internal.ts`
- Schema: `dmConversations`, `dmConversationMembers`, `dmMessages`

#### 1.2 · Catalogo Prodotti ✅
CRUD completo con toggle attivo/inattivo, ricerca per nome/SKU.
- `src/app/(main)/dashboard/products/page.tsx`
- `src/app/(main)/dashboard/products/_components/products-client.tsx`
- `src/actions/products.ts`
- Aggiunto in sidebar sotto "Sales"

#### 1.3 · Task Kanban View ✅
Vista board drag-and-drop con 3 colonne (Todo / In Progress / Done). Toggle List/Board nel toolbar.
- Modificato `src/app/(main)/dashboard/tasks/_components/tasks-client.tsx`
- Usa `@hello-pangea/dnd` (già in uso nel pipeline)
- Status `in_progress` gestito a livello app

#### 1.4 · AssigneeSelect standardizzato ✅
Campo "Assegnato a" con selezione utenti e gruppi uniformata su tutte le entità.
- Contacts, Leads, Companies, Deals: già implementato
- Task Modal: aggiornato (`assigneeValue` → decode → `assigneeId`)
- Ticket detail (reassign dialog): aggiornato
- Create Ticket Modal: aggiunto campo opzionale "Assign to"

---

### 🔴 FASE 2 — Alta Priorità (prossima)

#### ✅ 2.1 · Gestione Ordini (UI completa)
- `src/actions/orders.ts` — CRUD completo
- `src/app/(main)/dashboard/orders/page.tsx` — lista + stats
- `src/app/(main)/dashboard/orders/_components/orders-client.tsx` — UI
- `src/app/(main)/dashboard/orders/[id]/page.tsx` — detail con line items
- Sidebar aggiornata (Sales → Orders)

#### ✅ 2.2 · CRM Dashboard KPI reali (completamento)
- `src/actions/dashboard.ts` — aggiunto `getTopDeals()`, `getRecentActivities()`
- `src/app/(main)/dashboard/crm/page.tsx` — Top Deals card, Recent Activities feed, rimosso `@ts-nocheck`

---

### 🟡 FASE 3 — Media Priorità

#### 3.1 · Pipeline Forecast
- `src/app/(main)/dashboard/pipeline/report/page.tsx` — implementare contenuto
- Ricavi attesi per mese, win rate per stage, weighted pipeline

#### ✅ 3.2 · Revenue Reports
- `src/actions/reports.ts` — aggiunto `getSalesReport()` (deals won + quotes accepted + orders completed, monthly trend, revenue by stage)
- `src/app/(main)/dashboard/reports/_components/reports-client.tsx` — aggiunto tab "Sales" con KPI cards e grafici

#### 3.3 · Finance Dashboard Reale
- Collegare a `deals.amount` (won = revenue), `quotes` stats
- Complessità: ⭐ (Bassa)

#### 3.4 · Support Dashboard Reale
- Calcolare `avgResolutionTime` da `resolvedAt - createdAt`
- Ticket analytics: MTTR, FCR, SLA compliance

#### ✅ 3.5 · Chat Route dedicata
- `src/app/(main)/dashboard/chat/page.tsx` — pagina full-screen con 2 pannelli
- Sidebar aggiornata (CRM → Chat)

---

### 🟢 FASE 4 — Bassa Priorità / Miglioramenti

- **Lead Scoring automatico** — campo `leadScore` già nel DB, implementare regole
- **Global Search** — ricerca multi-entità
- **Bulk Actions** — operazioni massive su leads/contacts/deals
- **Quote Public Preview** — `/q/[token]` per customer acceptance
- **Roles Management UI** — `/dashboard/roles`
- **Onboarding Wizard** — setup iniziale workspace
- **Mobile Responsive Polish** — audit UX mobile

---

## Stack & Vincoli Tecnici

- **Framework:** Next.js 16 App Router (Server Components + Server Actions)
- **DB:** Drizzle ORM + Neon Postgres
- **Auth:** NextAuth v5, RBAC 4 livelli (owner > admin > editor > viewer)
- **UI:** shadcn/ui + Tailwind CSS v4
- **DnD:** `@hello-pangea/dnd` (pipeline e task board)
- **Charts:** Recharts (già importato)
- **Forms:** react-hook-form + zod
- **Linting:** Biome (non ESLint)
- **Pattern:** ogni mutazione va in `src/actions/*.ts`, ogni route in `src/app/(main)/dashboard/`
- **Colocation:** ogni route ha la propria cartella `_components/`; condivisi in `src/components/crm/`

---

## Progresso Complessivo

```
✅ Completati (Fase 1):
  [x] Chat Interna (widget globale, DM + gruppi)
  [x] Catalogo Prodotti (CRUD + sidebar)
  [x] Task Kanban Board (drag-and-drop, 3 colonne)
  [x] AssigneeSelect standard su tutte le entità

✅ Alta priorità (completati):
  [x] Gestione Ordini (UI completa, sidebar)
  [x] CRM Dashboard KPI (top deals + activities feed)

🟡 Media priorità:
  [x] Pipeline Forecast (già implementata in /pipeline/report)
  [x] Revenue Reports (tab Sales in reports con getSalesReport())
  [ ] Finance Dashboard reale
  [x] Support Dashboard reale (avgResolutionTime calcolato)
  [x] Chat Route dedicata (/dashboard/chat)

🟢 Bassa priorità:
  [ ] Lead Scoring automatico
  [ ] Global Search
  [ ] Bulk Actions
  [ ] Quote Public Preview
  [ ] Roles Management UI
  [ ] Onboarding Wizard
```

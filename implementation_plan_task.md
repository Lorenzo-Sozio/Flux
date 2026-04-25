# Flux CRM — Piano di Sviluppo: Modulo Task Avanzato

> **Ultimo aggiornamento:** 25 Aprile 2026

---

## Analisi dello Stato Attuale

### ✅ Funzionalità Task Già Implementate

| Funzionalità | Dettaglio |
|---|---|
| **Vista Lista** | Filtri per status, priorità, ricerca testuale |
| **Vista Kanban** | Drag-and-drop con `@hello-pangea/dnd`, colonne Todo / In Progress / Done |
| **Toggle List/Board** | Switch UI nella toolbar |
| **Priorità base** | `low`, `normal`, `high` |
| **Scadenze** | Campo `dueDate`, integrazione con `/dashboard/calendar` |
| **Assegnazione singola** | `ownerId` (creatore) + `assigneeId` (assegnatario) |
| **Link entità** | Collegamento a `lead`, `contact`, `company`, `deal` |
| **Notifica completamento** | In-app notification all'assegnatario/owner quando task → done |
| **Webhook task.completed** | Dispatch automatico a endpoint esterni |
| **Activity log automatico** | Aggiunge nota all'entity timeline al completamento |
| **RBAC filtering** | Admin/owner vede tutti, editor/viewer vede solo propri + assegnati |
| **Overdue popover** | `overdue-tasks-popover.tsx` — badge task scaduti nel header |
| **Calendar pill** | `calendar-task-pill.tsx` — task visibili nel calendario |

### ❌ Funzionalità Mancanti

| Funzionalità | Fase | Priorità |
|---|---|---|
| Gerarchia Task / Subtask (parentId, depth) | F1 | 🔴 Alta |
| Calcolo automatico progressione padre (%) | F1 | 🔴 Alta |
| Multi-assegnatario + ruoli RACI | F1 | 🔴 Alta |
| Followers / osservatori | F1 | 🔴 Alta |
| Tag priorità dinamici (Bloccante, Critico) | F1 | 🔴 Alta |
| Time tracking (timer + log ore stimato vs effettivo) | F2 | 🟡 Media |
| Vista Kanban per subtask | F2 | 🟡 Media |
| Dipendenze (Finish-to-Start, SS, FF) | F3 | 🟡 Media |
| Blocco status se dipendenze aperte | F3 | 🟡 Media |
| Gantt interattivo | F3 | 🟡 Media |
| Dashboard workload / overbooking | F4 | 🟢 Bassa |
| Auto-scheduling (propagazione ritardi) | F4 | 🟢 Bassa |
| Alert conflitti di schedulazione | F4 | 🟢 Bassa |

---

## Schema DB Attuale

```ts
// src/db/schema.ts — tabella task (stato corrente)
export const tasks = pgTable("task", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  status: text("status").default("todo"),        // todo | in_progress | done
  priority: text("priority").default("normal"),  // low | normal | high
  ownerId: text("owner_id"),
  assigneeId: text("assignee_id"),
  completedAt: timestamp("completed_at"),
  leadId: text("lead_id"),
  contactId: text("contact_id"),
  companyId: text("company_id"),
  dealId: text("deal_id"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

---

## Piano di Sviluppo

### 🔴 FASE 1 — Fondamenta Architetturali e Gerarchia (Settimane 1–4)

#### 1.1 · Schema DB — Gerarchia e RACI

**Modifiche alla tabella `task`** (`src/db/schema.ts`):

```ts
// Nuovi campi da aggiungere alla tabella tasks
parentId:       text("parent_id").references(() => tasks.id, { onDelete: "cascade" })
depth:          integer("depth").default(0).notNull()  // 0=root, 1=subtask, 2=sub-subtask (max 3)
progressPct:    integer("progress_pct").default(0).notNull()  // 0-100, calcolato
startDate:      timestamp("start_date")
priority:       text("priority")  // espandi: low | normal | high | critical | blocker
```

**Nuova tabella `task_assignees`** (RACI):

```ts
export const taskAssignees = pgTable("task_assignee", {
  id:     text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role:   text("role").notNull(), // responsible | accountable | consulted | informed
});
```

**File da modificare:**
- `src/db/schema.ts` — aggiungi campi + tabella `taskAssignees`
- `src/db/migrations/` — nuova migration via `npx drizzle-kit generate`

#### 1.2 · Server Actions — Gerarchia

**File:** `src/actions/tasks.ts`

Nuove funzioni:

```ts
// Crea subtask figlio
export async function createSubtask(parentId: string, data: {...})
  // valida depth padre ≤ 2 (figlio sarà depth 3 max)
  // inserisce con parentId + depth = parent.depth + 1
  // chiama recalcParentProgress(parentId)

// Ricalcola progressione ricorsiva verso root
export async function recalcParentProgress(taskId: string)
  // conta figli: total, done
  // progressPct = Math.round((done / total) * 100)
  // se task ha parentId → chiama ricorsivamente recalcParentProgress(parentId)

// Recupera albero completo (root + figli annidati)
export async function getTaskTree(rootId: string)

// Recupera subtask diretti di un task
export async function getSubtasks(parentId: string)
```

**Modifiche a funzioni esistenti:**
- `updateTaskStatus` → aggiunge chiamata a `recalcParentProgress(task.parentId)` se esiste parentId
- `createTask` → accetta campo opzionale `parentId`
- `getAllTasks` → aggiunge join su `taskAssignees` per mostrare assegnatari multipli

#### 1.3 · Server Actions — RACI e Followers

**File:** `src/actions/tasks.ts`

```ts
export async function addTaskAssignee(taskId: string, userId: string, role: string)
export async function removeTaskAssignee(taskId: string, userId: string)
export async function getTaskAssignees(taskId: string)

// Notifica followers (role="informed") quando task aggiornato
async function notifyFollowers(taskId: string, event: string)
  // recupera tutti assignees con role="informed"
  // crea in-app notification per ognuno
```

#### 1.4 · UI — TaskModal esteso

**File:** `src/components/crm/task-modal.tsx`

Aggiunte:
- Sezione "Assegnatari" con `MultiAssigneeSelect` (avatar stack + badge ruolo RACI)
- Dropdown priorità aggiornato: Low / Normal / High / **Critical** (arancione) / **Blocker** (rosso)
- Progress bar circolare sul task padre (mostra `progressPct`)
- Pulsante "+ Aggiungi Subtask" che apre form inline
- Campo `startDate` (date picker)

**Nuovo file:** `src/app/(main)/dashboard/tasks/_components/subtask-list.tsx`
- Lista subtask annidati sotto il task padre
- Checkbox completamento inline per ogni subtask
- Indicatore depth (indentazione visiva 16px per livello)
- Pulsante "+ Subtask" per aggiungere figli
- Ricorsivo fino a depth 3 (poi nasconde il pulsante aggiungi)

**Nuovo file:** `src/components/crm/multi-assignee-select.tsx`
- Componente condiviso per selezione multipla utenti con ruolo RACI
- Avatar stack (max 3 visibili + "+N")
- Tooltip con nome e ruolo su hover

#### 1.5 · UI — tasks-client aggiornato

**File:** `src/app/(main)/dashboard/tasks/_components/tasks-client.tsx`

Aggiunte:
- Colonna/card subtask: se task ha figli, mostra `SubtaskList` collassabile
- Progress bar lineare su card task padre (verde/giallo/rosso in base a %)
- Chip priorità aggiornati per `critical` e `blocker`
- Avatar stack assegnatari (sostituisce singolo `assigneeName`)

**Milestone F1:** utenti possono creare task con subtask annidati (max 3 livelli), assegnare più persone con ruoli RACI, vedere la percentuale di avanzamento del padre aggiornata automaticamente alla chiusura dei figli.

---

### 🟡 FASE 2 — Viste Dinamiche e Time Tracking (Settimane 5–8)

#### 2.1 · Schema DB — Time Logs

**Nuova tabella `task_time_logs`** (`src/db/schema.ts`):

```ts
export const taskTimeLogs = pgTable("task_time_log", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId:      text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startedAt:   timestamp("started_at").notNull(),
  stoppedAt:   timestamp("stopped_at"),
  hours:       numeric("hours", { precision: 5, scale: 2 }),
  note:        text("note"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
```

**Modifiche alla tabella `task`:**

```ts
estimatedHours: numeric("estimated_hours", { precision: 5, scale: 2 })
actualHours:    numeric("actual_hours", { precision: 5, scale: 2 }).default("0")  // aggiornato da trigger action
```

#### 2.2 · Server Actions — Time Tracking

**File:** `src/actions/tasks.ts`

```ts
export async function startTimer(taskId: string)
  // inserisce task_time_log con startedAt=now(), stoppedAt=null
  // ritorna logId per poterlo fermare

export async function stopTimer(logId: string)
  // aggiorna stoppedAt=now(), calcola hours=(stoppedAt-startedAt)/3600
  // aggiorna tasks.actualHours += hours

export async function logHoursManual(taskId: string, hours: number, note?: string)
  // inserisce log completo (startedAt=now(), stoppedAt=now()+hours)
  // aggiorna tasks.actualHours

export async function getTimeLogs(taskId: string)
export async function deleteTimeLog(logId: string)
```

#### 2.3 · UI — Timer e Time Log nel TaskModal

**File:** `src/components/crm/task-modal.tsx`

Aggiunte:
- Sezione "Tempo" con:
  - Campi "Stimato (ore)" e "Effettivo (ore)"
  - Pulsante Start/Stop timer (stato salvato in `localStorage` per persistenza tra reload)
  - Badge colorato: verde se effettivo ≤ stimato, rosso se effettivo > stimato
  - Lista `task_time_logs` collassabile (data, utente, ore, nota)

**Nuovo file:** `src/components/crm/task-timer.tsx`
- Componente timer con stato locale (start/stop/elapsed)
- Persiste `timerStart` in `localStorage` con chiave `task_timer_{taskId}`
- Mostra elapsed time in formato `HH:MM:SS`

#### 2.4 · UI — Kanban subtask e progress

**File:** `src/app/(main)/dashboard/tasks/_components/tasks-client.tsx`

Aggiunte:
- Kanban cards mostrano progress bar se `progressPct > 0`
- Badge "Xh / Yh" (stimato/effettivo) sulla card se `estimatedHours` compilato
- Subtask counter badge sulla card (es. "3/5 subtask")

**Milestone F2:** il team monitora ore stimate vs effettive, le card Kanban mostrano avanzamento reale, il timer integrato logga automaticamente il tempo di lavoro.

---

### 🟡 FASE 3 — Dipendenze e Gantt (Settimane 9–14)

#### 3.1 · Schema DB — Dipendenze

**Nuova tabella `task_dependencies`** (`src/db/schema.ts`):

```ts
export const taskDependencies = pgTable("task_dependency", {
  id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  predecessorId: text("predecessor_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  successorId:   text("successor_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  type:          text("type").notNull(), // FS | SS | FF | SF
  lagDays:       integer("lag_days").default(0).notNull(),
});
```

#### 3.2 · Server Actions — Dipendenze

**File:** `src/actions/tasks.ts`

```ts
export async function addDependency(predecessorId: string, successorId: string, type: string, lagDays?: number)
  // valida: nessun ciclo (A→B→A), max 10 dipendenze per task
  // inserisce in task_dependency

export async function removeDependency(dependencyId: string)

export async function getDependencies(taskId: string)
  // ritorna predecessori + successori con tipo e dettagli task

export async function checkDependencyViolation(taskId: string)
  // per tipo FS: verifica che tutti i predecessori siano status=done
  // ritorna lista dipendenze bloccanti

export async function propagateDateShift(taskId: string, deltaDays: number)
  // sposta dueDate di taskId + deltaDays
  // recupera successori FS → chiama ricorsivamente propagateDateShift
  // ritorna lista task modificati (per mostrare preview all'utente)
```

**Modifica a `updateTaskStatus`:**
- Prima di segnare `done`, chiama `checkDependencyViolation`
- Se ci sono violazioni FS, ritorna errore con lista task bloccanti

**Modifica a `updateTask` (dueDate):**
- Se dueDate cambiata, chiama `propagateDateShift` per successori FS
- Ritorna `{ updated: Task[], conflicts: Task[] }` — conflicts = task spostati oltre data progetto

#### 3.3 · UI — Dipendenze nel TaskModal

**File:** `src/components/crm/task-modal.tsx`

Aggiunte:
- Sezione "Dipendenze" con:
  - Lista predecessori (con tipo badge FS/SS/FF)
  - Combobox per aggiungere predecessore (cerca per titolo task)
  - Dropdown tipo dipendenza
  - Campo lag (giorni)
- Badge "Bloccato da: Task X, Task Y" visibile quando dipendenze FS aperte
- Dialog conferma se tenti status→done con dipendenze FS aperte

**Modifica a `tasks-client.tsx`:**
- Card con dipendenze bloccanti mostra icona lucchetto 🔒
- Tooltip con lista task bloccanti

#### 3.4 · UI — Gantt Interattivo

**Libreria consigliata:** `react-gantt-task` (MIT license, leggero, Next.js compatible)

**Nuova route:** `src/app/(main)/dashboard/tasks/gantt/page.tsx`

**Nuovo file:** `src/app/(main)/dashboard/tasks/gantt/_components/task-gantt.tsx`
- Mappa tasks → `GanttTask[]` con startDate, dueDate, progress
- Frecce dipendenze tra barre
- Drag barra Gantt → chiama `updateTask` con nuove date
- Shift con propagazione: se task spostato con successori FS, mostra dialog "Vuoi spostare anche i task dipendenti?" → chiama `propagateDateShift`
- Filtri per assegnatario, priorità, stato

**Sidebar entry:** aggiungere "Gantt" come sub-voce sotto "Tasks" in `src/navigation/sidebar/sidebar-items.ts`

**Toggle toolbar** in `tasks-client.tsx`: List | Kanban | Gantt (tre icone)

**Milestone F3:** i project manager pianificano visualmente l'intero ciclo di vita, le dipendenze bloccano avanzamento scorretto, lo spostamento di un task propaga automaticamente i successori.

---

### 🟢 FASE 4 — Intelligenza, Workload e Conflitti (Settimane 15–20)

#### 4.1 · Server Actions — Workload

**Nuovo file:** `src/actions/workload.ts`

```ts
// Matrice: utente × giorno → ore assegnate
export async function getWorkloadMatrix(startDate: Date, endDate: Date)
  // per ogni task con dueDate nel range e assegnatari attivi
  // distribuisce estimatedHours su giorni lavorativi tra startDate e dueDate
  // raggruppa per userId → { [userId]: { [date]: hours } }
  // aggiunge capacità giornaliera (default 8h, configurabile)
  // ritorna matrix + overbooking flag per ogni cella

export async function getUserCapacity(userId: string)
  // legge eventuale override da user settings
  // default: 8h/giorno, 5 giorni/settimana

export async function getWorkloadConflicts(startDate: Date, endDate: Date)
  // ritorna solo celle con ore assegnate > capacità
  // con lista task che causano l'overbooking
```

#### 4.2 · UI — Dashboard Workload

**Nuova route:** `src/app/(main)/dashboard/tasks/workload/page.tsx`

**Nuovo file:** `src/app/(main)/dashboard/tasks/workload/_components/workload-grid.tsx`
- Griglia utenti (righe) × giorni (colonne), max 4 settimane
- Heatmap celle: verde (≤ 70% capacità) / giallo (70–100%) / rosso (> 100%)
- Tooltip per ogni cella: lista task e ore
- Click su cella rossa → apre pannello "Conflitti" laterale

**Nuovo file:** `src/app/(main)/dashboard/tasks/workload/_components/conflict-panel.tsx`
- Lista task in overbooking per utente selezionato
- Per ogni task conflitto, opzioni:
  - "Riassegna" → dropdown utenti liberi nella stessa finestra temporale
  - "Forza overbooking" → imposta flag `allowOverbook: true` su task
  - "Sposta task" → date picker per rimandare

**Sidebar entry:** aggiungere "Workload" come sub-voce sotto "Tasks"

#### 4.3 · Auto-Scheduling

**File:** `src/actions/tasks.ts`

```ts
export async function autoScheduleChain(rootTaskId: string)
  // a partire da rootTaskId, ricostruisce catena dipendenze
  // se task padre in ritardo (dueDate < today && status != done):
  //   delta = today - dueDate (giorni)
  //   chiama propagateDateShift(rootTaskId, delta) su tutti i successori
  // ritorna { rescheduled: Task[], conflicts: Task[] }
  // conflicts = task spostati oltre endDate progetto o oltre capacità risorsa
```

**Cron job:** `src/app/api/cron/task-overdue-check/route.ts`
- Gira ogni giorno alle 08:00
- Trova task scaduti (dueDate < today, status != done) con successori FS aperti
- Crea notifica in-app per owner: "Task X è in ritardo, i seguenti task dipendenti sono a rischio"
- Non sposta automaticamente — propone e notifica solo

#### 4.4 · Feature Toggle

**File:** `src/config/index.ts` (o `APP_CONFIG`)

```ts
export const TASK_FEATURES = {
  subtasks:        true,   // F1
  raci:            true,   // F1
  timeTracking:    true,   // F2
  dependencies:    false,  // F3 — attiva in rollout
  gantt:           false,  // F3 — attiva in rollout
  workload:        false,  // F4 — attiva in rollout
  autoScheduling:  false,  // F4 — attiva in rollout
} as const;
```

**Milestone F4:** i manager vedono la capacità del team a colpo d'occhio, il sistema segnala conflitti con opzioni di risoluzione, il cron notifica ritardi a rischio propagazione.

---

## File Coinvolti — Riepilogo

### Nuovi file da creare

| File | Fase | Scopo |
|---|---|---|
| `src/app/(main)/dashboard/tasks/_components/subtask-list.tsx` | F1 | Lista subtask annidati ricorsiva |
| `src/components/crm/multi-assignee-select.tsx` | F1 | Selezione multipla utenti + ruolo RACI |
| `src/components/crm/task-timer.tsx` | F2 | Componente timer start/stop |
| `src/app/(main)/dashboard/tasks/gantt/page.tsx` | F3 | Route Gantt |
| `src/app/(main)/dashboard/tasks/gantt/_components/task-gantt.tsx` | F3 | Componente Gantt interattivo |
| `src/app/(main)/dashboard/tasks/workload/page.tsx` | F4 | Route workload |
| `src/app/(main)/dashboard/tasks/workload/_components/workload-grid.tsx` | F4 | Griglia carico lavoro |
| `src/app/(main)/dashboard/tasks/workload/_components/conflict-panel.tsx` | F4 | Pannello risoluzione conflitti |
| `src/actions/workload.ts` | F4 | Logica workload server-side |
| `src/app/api/cron/task-overdue-check/route.ts` | F4 | Cron ritardi e notifiche |

### File esistenti da modificare

| File | Fase | Modifiche |
|---|---|---|
| `src/db/schema.ts` | F1/F2/F3 | Nuovi campi tasks + 3 nuove tabelle |
| `src/actions/tasks.ts` | F1/F2/F3/F4 | ~15 nuove funzioni |
| `src/components/crm/task-modal.tsx` | F1/F2/F3 | RACI, subtask, timer, dipendenze |
| `src/app/(main)/dashboard/tasks/_components/tasks-client.tsx` | F1/F2 | Progress bar, subtask counter, multi-assignee |
| `src/app/(main)/dashboard/tasks/_components/new-task-dialog.tsx` | F1 | Campi parentId, priority esteso |
| `src/navigation/sidebar/sidebar-items.ts` | F3/F4 | Sub-voci Gantt, Workload |

---

## Dipendenze Esterne da Aggiungere

| Libreria | Fase | Uso | Licenza |
|---|---|---|---|
| `react-gantt-task` | F3 | Gantt interattivo | MIT |
| (nessuna aggiunta per F1/F2) | — | usa `@hello-pangea/dnd` esistente | — |

---

## Stack & Vincoli Tecnici

- **Framework:** Next.js 16 App Router (Server Components + Server Actions)
- **DB:** Drizzle ORM + Neon Postgres — migrations via `npx drizzle-kit generate`
- **Auth / RBAC:** NextAuth v5 — `requireWriteAccess()` su tutte le mutazioni
- **UI:** shadcn/ui + Tailwind CSS v4
- **DnD:** `@hello-pangea/dnd` (già presente — riusa per Kanban subtask)
- **Forms:** react-hook-form + zod per validazione client
- **Linting:** Biome (non ESLint/Prettier)
- **Pattern mutations:** sempre in `src/actions/*.ts`, mai in route handlers
- **Colocation:** componenti specifici route in `_components/`, condivisi in `src/components/crm/`
- **Gerarchia max:** 3 livelli di profondità (depth 0/1/2/3) — validazione server-side

---

## Progresso

```
🔴 Alta priorità — FASE 1 (Gerarchia + RACI):
  [x] Schema DB: parentId, depth, progressPct, startDate, priority esteso su tasks
  [x] Schema DB: nuova tabella task_assignees (RACI)
  [x] Migration drizzle-kit generate + push (0014_stale_diamondback.sql)
  [x] Action: createSubtask(parentId, data)
  [x] Action: recalcParentProgress(taskId) — ricorsiva verso root
  [x] Action: getSubtasks(parentId)
  [x] Action: addTaskAssignee / removeTaskAssignee / getTaskAssignees
  [x] Action: updateTaskStatus → chiama recalcParentProgress se parentId
  [x] UI: SubtaskList component (collassabile, toggle, delete, add inline, max depth guard)
  [x] UI: TaskModal esteso (subtask section, progress bar, priority critico/blocker)
  [x] UI: tasks-client aggiornato (progress bar Kanban + lista, priority blocker/critical, tipo Task esteso)
  [x] UI: new-task-dialog aggiornato (priority enum esteso)
  [x] i18n: EN + IT — critical, blocker, subtask strings
  [ ] UI: MultiAssigneeSelect con ruoli RACI (UI separata, F1 opzionale)

🟡 Media priorità — FASE 2 (Time Tracking):
  [x] Schema DB: nuova tabella task_time_logs
  [x] Schema DB: campi estimatedHours, actualHours su tasks
  [x] Migration drizzle-kit generate + push (0015_misty_darkhawk.sql)
  [x] Action: startTimer / stopTimer / logHoursManual / getTimeLogs / deleteTimeLog
  [x] UI: TaskTimer component (start/stop, elapsed, localStorage persist)
  [x] UI: TaskModal sezione "Tempo" (stimato vs effettivo, lista log)
  [x] UI: Kanban cards — badge ore, progress bar

🟡 Media priorità — FASE 3 (Dipendenze + Gantt):
  [x] Schema DB: nuova tabella task_dependencies
  [x] Migration drizzle-kit generate + push (0016_lush_landau.sql)
  [x] Action: addDependency / removeDependency / getDependencies
  [x] Action: checkDependencyViolation (blocco FS) — integrato in updateTaskStatus
  [x] Action: propagateDateShift (ricorsiva su successori FS)
  [x] Action: getAllTasksForGantt
  [x] UI: sezione Dipendenze in TaskModal (predecessori, tipo badge, lag, add/remove)
  [x] UI: badge "Bloccato" + icona lucchetto in tasks-client (Kanban + Lista)
  [x] UI: installare gantt-task-react@0.3.9
  [x] UI: route /dashboard/tasks/gantt + TaskGantt component (drag dates, FS propagation)
  [ ] UI: toggle toolbar List | Kanban | Gantt (rimandato — Gantt ha route dedicata)
  [x] Sidebar: sub-voci Gantt sotto Tasks

🟢 Bassa priorità — FASE 4 (Workload + Intelligenza):
  [x] Action: getWorkloadMatrix / getWorkloadConflicts (src/actions/workload.ts)
  [x] Action: autoScheduleChain — BFS chain reschedule
  [x] UI: route /dashboard/tasks/workload + WorkloadClient (heatmap grid + conflict panel)
  [x] Cron: /api/cron/task-overdue-check (notifica owner per task scaduti con successori FS)
  [x] Config: TASK_FEATURES feature toggle (src/config/app-config.ts)
  [x] Sidebar: sub-voci Gantt + Workload sotto Tasks
```

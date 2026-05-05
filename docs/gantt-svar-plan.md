# Piano: Migrazione a @svar-ui/react-gantt (Core)

## Contesto

Il Gantt attuale usa `gantt-task-react` (libreria con limitazioni di rendering e API povera).
L'obiettivo è migrare a **@svar-ui/react-gantt Core** (open-source), aggiungendo tramite codice custom:

- Auto-scheduling dei successori (FS/SS/FF/SF + lagDays)
- Calendari lavorativi (skip sabato/domenica)
- Workload panel per rilevare sovraccarichi giornalieri

L'approccio è **ibrido**: SVAR gestisce solo la UI e gli eventi di drag & drop; la logica di scheduling è interamente custom e vive in uno store Zustand.

---

## Step 1 — Modello Dati e Store Zustand

### File da creare

**`src/stores/gantt-store.ts`**

### Tipi TypeScript (compatibili con @svar-ui/react-gantt)

```ts
// Tipo task richiesto da SVAR (subset obbligatorio + campi custom)
type SvarTask = {
  id: string;          // richiesto da SVAR
  text: string;        // label nella lista sinistra
  start_date: Date;    // richiesto da SVAR
  end_date: Date;      // richiesto da SVAR
  duration?: number;   // giorni lavorativi (calcolato, non persistito)
  progress: number;    // 0..1
  parent?: string;     // id task padre (per gerarchia)
  open?: boolean;      // espansione nodo
  // Campi CRM aggiuntivi (passati via data extra):
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
};

// Tipo link (dipendenza) richiesto da SVAR
type SvarLink = {
  id: string;
  source: string;     // predecessorId
  target: string;     // successorId
  type: "0" | "1" | "2" | "3"; // 0=FS, 1=SS, 2=FF, 3=SF (mappatura SVAR)
  // Campi custom:
  lagDays: number;
  depType: "FS" | "SS" | "FF" | "SF"; // valore originale dal DB
};
```

> **Nota mappatura tipo link**: SVAR Core usa numeri "0"/"1"/"2"/"3" — serve una costante
> `DEP_TYPE_MAP: Record<"FS"|"SS"|"FF"|"SF", "0"|"1"|"2"|"3">`.

### Store Zustand

Lo store espone:

| Stato | Tipo | Descrizione |
|---|---|---|
| `tasks` | `SvarTask[]` | Task nel formato SVAR |
| `links` | `SvarLink[]` | Dipendenze nel formato SVAR |
| `rawTasks` | `RawTask[]` | Dati originali dal DB (per tooltip, colori, workload) |

Azioni:

| Azione | Descrizione |
|---|---|
| `initStore(tasks, links)` | Popola lo store dai dati passati dalla page.tsx server component |
| `applyTaskDateChange(taskId, newStart, newEnd)` | Aggiorna le date di un task e **chiama il motore di scheduling** su tutti i successori FS |
| `commitToServer(taskId)` | Chiama `updateTask()` + `propagateSuccessors()` via Server Action |

> **Invariante critica**: `applyTaskDateChange` è l'unico punto dove le date vengono modificate nello store.
> Non aggiornare `tasks` direttamente altrove.

---

## Step 2 — Motore Custom di Auto-Scheduling

### File da creare

**`src/lib/gantt-scheduler.ts`**

### Funzione principale

```ts
function scheduleSuccessors(
  taskId: string,
  tasks: SvarTask[],
  links: SvarLink[],
  visited?: Set<string>
): SvarTask[]
```

Restituisce il nuovo array `tasks` con le date ricalcolate. Non muta il parametro originale (funzione pura).

### Logica interna

**1. Working days calendar** (usando `date-fns`):

```ts
function addWorkingDays(from: Date, days: number): Date
function isWorkingDay(date: Date): boolean  // skip sab/dom
function diffWorkingDays(start: Date, end: Date): number
```

Fonte: `date-fns/addDays` + check `getDay() === 0 || 6`.

**2. Calcolo nuova `start_date` per ogni tipo di dipendenza**:

| Tipo | Nuova start del successore |
|---|---|
| `FS` (Finish-to-Start) | `addWorkingDays(predecessor.end_date, lagDays)` |
| `SS` (Start-to-Start) | `addWorkingDays(predecessor.start_date, lagDays)` |
| `FF` (Finish-to-Finish) | `end_date_succ = addWorkingDays(predecessor.end_date, lagDays)` → `start_date = subWorkingDays(end_date_succ, duration)` |
| `SF` (Start-to-Finish) | `end_date_succ = addWorkingDays(predecessor.start_date, lagDays)` → `start_date = subWorkingDays(end_date_succ, duration)` |

**3. Traversal ricorsivo** con `visited: Set<string>` per evitare loop su dipendenze circolari.
Se un task è già in `visited`, saltarlo silenziosamente.

**4. `duration`** = `diffWorkingDays(start_date, end_date)` — ricalcolato dopo ogni spostamento date.

### Integrazione nello store

`applyTaskDateChange` nel store Zustand:

```ts
applyTaskDateChange(taskId, newStart, newEnd) {
  // 1. Aggiorna il task target
  // 2. Ricalcola duration
  // 3. Chiama scheduleSuccessors(taskId, tasks, links)
  // 4. Sostituisce tasks nell'store
  // 5. Schedula commitToServer (debounced 500ms)
}
```

---

## Step 3 — Integrazione Componente SVAR

### File da creare / modificare

- **`src/app/(main)/dashboard/tasks/gantt/_components/gantt-view.tsx`** — nuovo componente SVAR
- **`src/app/(main)/dashboard/tasks/gantt/_components/task-gantt.tsx`** — da sostituire con wrapper

### Installazione libreria

```bash
npm install @svar-ui/react-gantt
```

> Verificare che la libreria supporti Next.js 16 App Router (SSR off, dynamic import).

### Architettura `GanttView.tsx`

```tsx
"use client";

// Import dinamico per evitare SSR (SVAR usa DOM APIs)
const SvarGantt = dynamic(() => import("@svar-ui/react-gantt"), { ssr: false });
```

**Props del componente SVAR da utilizzare:**

| Prop SVAR | Sorgente |
|---|---|
| `tasks` | `useGanttStore(s => s.tasks)` |
| `links` | `useGanttStore(s => s.links)` |
| `scales` | Config viewMode (Day/Week/Month) |
| `onDataChange` (o equivalente callback drag) | Intercetta task move → chiama `applyTaskDateChange` |

**Intercettazione del drag & drop:**

SVAR Core espone un handler `onDataChange` (o `dataProcessor`) che riceve l'evento dopo ogni operazione utente (move, resize, link creation).

```ts
const handleDataChange = useCallback((data) => {
  if (data.action === "update-task") {
    const { id, start_date, end_date } = data.task;
    applyTaskDateChange(id, start_date, end_date);
  }
}, []);
```

> **Da verificare nelle API open-source SVAR**: il nome esatto del callback
> potrebbe essere `onChange`, `onAction`, o tramite il pattern `DataStore`.
> Consultare la documentazione ufficiale di `@svar-ui/react-gantt` Core
> prima dell'implementazione.

### Toolbar (riuso dall'attuale `task-gantt.tsx`)

Il pannello header (viewMode selector, navigazione date, legenda) viene estratto in
**`_components/gantt-toolbar.tsx`** e riusato sia dal nuovo che dal vecchio componente
durante la transizione.

### Eliminazione dipendenza `gantt-task-react`

Solo dopo che il nuovo `GanttView` è funzionante e testato:

```bash
npm uninstall gantt-task-react
```

Rimuovere l'import CSS `gantt-task-react/dist/index.css` da `task-gantt.tsx`.

---

## Step 4 — WorkloadPanel (Componente Custom)

### File da creare

**`src/app/(main)/dashboard/tasks/gantt/_components/workload-panel.tsx`**

> **Nota**: il workload completo (vista a matrice con rescheduling) è già implementato in
> `src/app/(main)/dashboard/tasks/workload/`. Il `WorkloadPanel` qui descritto è un
> pannello **inline leggero** affiancato al Gantt, non un sostituto della pagina workload.

### Logica del componente

```ts
// Legge i task raw dallo store (includono assigneeId, assigneeName, estimatedHours)
const rawTasks = useGanttStore(s => s.rawTasks);

// Raggruppa ore per (userId, dateString)
type DayLoad = { hours: number; taskCount: number; isOverloaded: boolean };
type UserLoad = { userId: string; name: string; days: Record<string, DayLoad> };

function computeWorkload(tasks: RawTask[]): UserLoad[]
```

**Algoritmo**:
1. Per ogni task con `assigneeId` e `startDate` e `dueDate`:
   - Distribuisce le ore stimate sui giorni lavorativi nel range `[startDate, dueDate]`
   - Formula: `hoursPerDay = estimatedHours / diffWorkingDays(startDate, dueDate)`
2. Accumula per `(assigneeId, dayString)`
3. Marca `isOverloaded = hours > 8`

### UI

- Lista verticale di utenti assegnati
- Per ogni utente: barra orizzontale con i giorni del periodo visibile nel Gantt
- Celle con `isOverloaded` evidenziate in rosso
- Badge con numero di conflitti in testa al pannello
- Il periodo visualizzato è sincronizzato con il `viewDate` del Gantt (stesso stato Zustand)

### Posizione nel layout

Il `WorkloadPanel` è un pannello collassabile a destra del Gantt, dentro
`task-gantt.tsx` (wrapper), con toggle button nella toolbar.

---

## Dipendenze aggiuntive da installare

| Package | Motivo |
|---|---|
| `@svar-ui/react-gantt` | Libreria Gantt principale |
| `zustand` | Già installato (verificare) |
| `date-fns` | Già installato (v3.6.0) |

---

## Sequenza di esecuzione (passo-passo, OK-gated)

```
Step 1  →  [OK utente]  →  Step 2  →  [OK utente]  →  Step 3  →  [OK utente]  →  Step 4
```

Ogni step è autonomo e non richiede che il precedente sia "live" in produzione —
si può sviluppare e testare in locale prima di sostituire il componente in `page.tsx`.

---

## File toccati/creati riepilogo

| Operazione | File |
|---|---|
| CREA | `src/stores/gantt-store.ts` |
| CREA | `src/lib/gantt-scheduler.ts` |
| CREA | `src/app/(main)/dashboard/tasks/gantt/_components/gantt-view.tsx` |
| CREA | `src/app/(main)/dashboard/tasks/gantt/_components/gantt-toolbar.tsx` |
| CREA | `src/app/(main)/dashboard/tasks/gantt/_components/workload-panel.tsx` |
| MODIFICA | `src/app/(main)/dashboard/tasks/gantt/_components/task-gantt.tsx` (diventa wrapper) |
| MODIFICA | `src/app/(main)/dashboard/tasks/gantt/page.tsx` (passa dati allo store via `initStore`) |
| ELIMINA (dopo verifica) | dipendenza `gantt-task-react` da `package.json` |

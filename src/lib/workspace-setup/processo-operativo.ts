/**
 * The "tappa 0" of docs/processo-operativo-2026-10.md, as data: what a photovoltaic installer's
 * workspace needs configured before its people start working in Flux.
 *
 * Run by `scripts/setup-processo-operativo.ts` against one workspace, previewing by default.
 *
 * ⚠️⚠️ **It never deletes and never overwrites a choice somebody made.** Every item is created
 * only when missing, matched by name. The one exception is configuration still exactly as a new
 * workspace is seeded (src/db/seed-workspace.ts) — the English stage and loss-reason names nobody
 * chose — which is renamed in place: a stage keeps its id, so the deals on it stay where they are.
 *
 * ⚠️ Automation rules are created **switched off**. Several write to customers or to colleagues;
 * they are meant to be read in the builder and switched on by a person.
 *
 * Imports the schema only: no `server-only`, no request context, so a plain script can run it.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  automationRules,
  customFieldDefinitions,
  dealLossReasons,
  emailSequenceSteps,
  emailSequences,
  emailTemplates,
  pipelineStages,
  pipelines,
  products,
  slas,
  ticketMacros,
  userGroups,
  users,
  workspaceSettings,
} from "@/db/schema";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface SetupOptions {
  /** Write. Without it nothing changes: the report says what would be done. */
  apply: boolean;
  /** Who leads are handed to in turn (emails of workspace members). Without them, no rotation rule. */
  rotation?: string[];
  /** Who hears of a won deal and plans the paperwork (email). */
  administration?: string;
  /** Who answers for support: urgent tickets and missed SLAs (email). */
  supportLead?: string;
  /** Switch on the satisfaction email on resolution. It writes to customers: off unless asked. */
  csat?: boolean;
}

export type SetupStatus = "create" | "update" | "exists" | "skip";

export interface SetupLine {
  area: string;
  item: string;
  status: SetupStatus;
  note?: string;
}

// ─── What the document asks for ────────────────────────────────────────────────

/** The seeded English stages, and what each becomes when nobody has touched it. */
const STAGE_RENAMES: Record<string, { name: string; probability: number; staleAfterDays: number | null }> = {
  Qualification: { name: "Appuntamento fissato", probability: 20, staleAfterDays: 7 },
  Discovery: { name: "Sopralluogo fatto", probability: 40, staleAfterDays: 10 },
  Proposal: { name: "Preventivo inviato", probability: 60, staleAfterDays: 10 },
  Negotiation: { name: "In negoziazione", probability: 75, staleAfterDays: 14 },
  Won: { name: "Vinta", probability: 100, staleAfterDays: null },
  Lost: { name: "Persa", probability: 0, staleAfterDays: null },
};
const SEEDED_PROBABILITY: Record<string, number> = {
  Qualification: 10,
  Discovery: 25,
  Proposal: 50,
  Negotiation: 75,
  Won: 100,
  Lost: 0,
};
const OPEN_STAGES = ["Appuntamento fissato", "Sopralluogo fatto", "Preventivo inviato", "In negoziazione"];

/** Seeded loss reasons: renamed when untouched, or retired when they do not apply here. */
const LOSS_RENAMES: Record<string, string | null> = {
  Price: "Prezzo troppo alto",
  "Lost to a competitor": "Ha scelto un concorrente",
  "No budget": "Nessun budget",
  "No decision made": "Non ha deciso",
  "Bad timing": "Rimandato",
  "No response": "Non risponde più",
  "Missing feature or capability": null,
  "Went with an in-house solution": null,
};
const LOSS_REASONS = [
  "Prezzo troppo alto",
  "Ha scelto un concorrente",
  "Finanziamento non concesso",
  "Tetto o impianto non idoneo",
  "Nessun budget",
  "Non ha deciso",
  "Rimandato",
  "Non risponde più",
];

const INTERVENTION_KINDS = ["Fotovoltaico", "Fotovoltaico con accumulo", "Solo accumulo", "Altro"];

/** Custom fields. The same slug and kind on lead and deal is what carries a value across conversion. */
const CUSTOM_FIELDS: { entityType: string; name: string; slug: string; fieldType: string; options?: string[] }[] = [
  {
    entityType: "lead",
    name: "Motivo di scarto",
    slug: "motivo_scarto",
    fieldType: "select",
    options: [
      "Non interessato",
      "Fuori zona",
      "Casa in affitto",
      "Tetto non idoneo",
      "Recapiti errati",
      "Doppione",
      "Altro",
    ],
  },
  { entityType: "lead", name: "Campagna", slug: "campagna", fieldType: "text" },
  {
    entityType: "lead",
    name: "Tipo di intervento",
    slug: "tipo_intervento",
    fieldType: "select",
    options: INTERVENTION_KINDS,
  },
  {
    entityType: "deal",
    name: "Tipo di intervento",
    slug: "tipo_intervento",
    fieldType: "select",
    options: INTERVENTION_KINDS,
  },
  { entityType: "deal", name: "Campagna", slug: "campagna", fieldType: "text" },
  { entityType: "deal", name: "Data di firma", slug: "data_firma", fieldType: "date" },
  {
    entityType: "deal",
    name: "Pagamento",
    slug: "pagamento",
    fieldType: "select",
    options: ["Bonifico", "Finanziamento", "Misto"],
  },
  { entityType: "company", name: "Indirizzo di installazione", slug: "indirizzo_installazione", fieldType: "text" },
  { entityType: "company", name: "Potenza impianto (kWp)", slug: "potenza_kwp", fieldType: "number" },
  { entityType: "company", name: "Numero di pannelli", slug: "numero_pannelli", fieldType: "number" },
];

const GROUPS = [
  { name: "Call center", description: "Operatori che fanno il primo contatto con i lead." },
  { name: "Assistenza", description: "Operatori e tecnici che seguono le richieste dei clienti." },
];

const P = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join("");

/** Shared starting texts for one-to-one emails (Settings → Email templates). Signed by the sender. */
const TEMPLATES = [
  {
    name: "Benvenuto",
    subject: "Benvenuto, {{nome}}",
    body: P(
      "Gentile {{nome}},",
      "grazie per averci scelto. Da oggi segue la sua pratica il nostro ufficio installazioni, che la contatterà per i documenti necessari e per fissare le prossime date.",
      "Per qualsiasi domanda può rispondere a questa email.",
    ),
  },
  {
    name: "Conferma dell'appuntamento",
    subject: "Il nostro appuntamento",
    body: P(
      "Gentile {{nome}},",
      "le confermo l'appuntamento del [data] alle [ora] presso [indirizzo]. Riceverà a parte l'invito per il calendario.",
      "Se le servisse spostarlo, risponda pure a questa email.",
    ),
  },
  {
    name: "Invio del preventivo",
    subject: "Il preventivo per il suo impianto",
    body: P(
      "Gentile {{nome}},",
      "come concordato le invio il preventivo per l'impianto. Dal link può consultarlo e, se è tutto chiaro, accettarlo online.",
      "Resto a disposizione per qualsiasi chiarimento.",
    ),
  },
  {
    name: "Sollecito del preventivo",
    subject: "Ha avuto modo di vedere il preventivo?",
    body: P(
      "Gentile {{nome}},",
      "le scrivo per sapere se ha avuto modo di vedere il preventivo che le ho inviato e se posso esserle utile con qualche chiarimento.",
    ),
  },
  {
    name: "Proposta di manutenzione",
    subject: "La manutenzione del suo impianto",
    body: P(
      "Gentile {{nome}},",
      "ora che l'impianto è in funzione, per mantenerne il rendimento le proponiamo la manutenzione annuale con la pulizia dei pannelli, una o due volte l'anno.",
      "Trova i dettagli nel preventivo allegato, che può accettare online.",
    ),
  },
];

/** Canned replies for support (Assistenza → Macro). */
const MACROS = [
  {
    name: "Richiesta di foto e dati dell'inverter",
    body: P(
      "Gentile cliente,",
      "per capire il problema ci servono alcune foto: il display dell'inverter con l'eventuale codice di errore, il quadro elettrico e, se possibile, la produzione degli ultimi giorni dall'app di monitoraggio.",
      "Può rispondere a questa email allegandole.",
    ),
  },
  {
    name: "Conferma della visita del tecnico",
    body: P(
      "Gentile cliente,",
      "il nostro tecnico passerà il [data] tra le [ora] e le [ora]. Le chiediamo di garantire l'accesso all'impianto e al quadro elettrico.",
    ),
  },
  {
    name: "Chiusura della richiesta",
    body: P(
      "Gentile cliente,",
      "l'intervento è concluso e l'impianto funziona correttamente. Se dovesse notare altro, risponda pure a questa email: la richiesta si riaprirà.",
    ),
  },
];

/** Catalogue lines with no price yet: created inactive, so nobody quotes them at zero. */
const PRODUCTS = [
  { name: "Manutenzione annuale – 1 pulizia", unit: "anno", category: "Manutenzione" },
  { name: "Manutenzione annuale – 2 pulizie", unit: "anno", category: "Manutenzione" },
  { name: "Diritto di chiamata", unit: "intervento", category: "Assistenza" },
  { name: "Ora di lavoro del tecnico", unit: "ora", category: "Assistenza" },
  { name: "Trasferta", unit: "intervento", category: "Assistenza" },
];

const SEQUENCE_NAME = "Primo contatto";
const SEQUENCE_STEPS = [
  { delayDays: 0, kind: "task", taskType: "call", subject: "Primo contatto: chiamare", body: "" },
  { delayDays: 1, kind: "task", taskType: "call", subject: "Secondo tentativo di chiamata", body: "" },
  {
    delayDays: 1,
    kind: "email",
    taskType: null,
    subject: "Abbiamo provato a chiamarla",
    body: P(
      "Gentile {{nome}},",
      "abbiamo ricevuto la sua richiesta di informazioni e abbiamo provato a chiamarla senza trovarla.",
      "Può rispondere a questa email indicandoci quando è più comodo sentirci, oppure richiamarci.",
    ),
  },
  { delayDays: 2, kind: "task", taskType: "call", subject: "Terzo tentativo di chiamata", body: "" },
  { delayDays: 3, kind: "task", taskType: "call", subject: "Ultimo tentativo di chiamata", body: "" },
];

// ─── The run ───────────────────────────────────────────────────────────────────

export async function setupProcessoOperativo(db: AnyDb, options: SetupOptions): Promise<SetupLine[]> {
  const out: SetupLine[] = [];
  const line = (area: string, item: string, status: SetupStatus, note?: string) =>
    out.push({ area, item, status, ...(note ? { note } : {}) });
  const write = options.apply;

  // People named on the command line, found among the workspace's users by email.
  const emails = [...(options.rotation ?? []), options.administration, options.supportLead].filter(
    (e): e is string => !!e,
  );
  const people: { id: string; email: string | null }[] = emails.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          inArray(
            sql`lower(${users.email})`,
            emails.map((e) => e.toLowerCase()),
          ),
        )
    : [];
  const who = (email: string | undefined) =>
    email ? people.find((p) => p.email?.toLowerCase() === email.toLowerCase())?.id : undefined;
  for (const e of emails) if (!who(e)) line("Persone", e, "skip", "non è un utente di questo workspace");

  // ── Pipeline Vendite ──
  const [pipeline] = await db.select().from(pipelines).orderBy(pipelines.order, pipelines.name).limit(1);
  const pipelineId: string = pipeline?.id ?? "default";
  if (pipeline && pipeline.name === "Pipeline") {
    line("Pipeline", "«Pipeline» → «Vendite»", "update");
    if (write) await db.update(pipelines).set({ name: "Vendite" }).where(eq(pipelines.id, pipeline.id));
  } else {
    line("Pipeline", pipeline?.name ?? "Vendite", "exists");
  }
  const stages: {
    id: string;
    name: string;
    order: number;
    defaultProbability: number | null;
    isWon: boolean;
    isLost: boolean;
  }[] = await db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipelineId));
  for (const st of stages) {
    const target = STAGE_RENAMES[st.name];
    if (!target) continue;
    if (st.defaultProbability !== SEEDED_PROBABILITY[st.name]) {
      line("Fasi", st.name, "skip", "modificata a mano: lasciata com'è");
      continue;
    }
    line("Fasi", `«${st.name}» → «${target.name}» (${target.probability}%)`, "update");
    if (write)
      await db
        .update(pipelineStages)
        .set({ name: target.name, defaultProbability: target.probability, staleAfterDays: target.staleAfterDays })
        .where(eq(pipelineStages.id, st.id));
    st.name = target.name;
  }
  const names = new Set(stages.map((s) => s.name.toLowerCase()));
  const lastOpen = Math.max(0, ...stages.filter((s) => !s.isWon && !s.isLost).map((s) => s.order));
  const newStages = OPEN_STAGES.flatMap((name, i) => {
    if (names.has(name.toLowerCase())) {
      line("Fasi", name, "exists");
      return [];
    }
    line("Fasi", name, "create", "aggiunta dopo le fasi aperte: riordinala in Impostazioni → Fasi pipeline");
    const meta = Object.values(STAGE_RENAMES).find((r) => r.name === name);
    return [
      {
        name,
        order: lastOpen + i + 1,
        defaultProbability: meta?.probability ?? 0,
        staleAfterDays: meta?.staleAfterDays ?? null,
        pipelineId,
      },
    ];
  });
  if (write && newStages.length) await db.insert(pipelineStages).values(newStages);
  for (const st of stages.filter((s) => !s.isWon && !s.isLost && !OPEN_STAGES.includes(s.name))) {
    line("Fasi", st.name, "skip", "non prevista dal processo: toglila o rinominala a mano se non serve");
  }

  // ── Motivi di perdita ──
  const reasons: { id: string; name: string; isActive: boolean }[] = await db.select().from(dealLossReasons);
  for (const r of reasons) {
    if (!(r.name in LOSS_RENAMES)) continue;
    const to = LOSS_RENAMES[r.name];
    if (to === null) {
      if (!r.isActive) continue;
      line("Motivi di perdita", r.name, "update", "non pertinente: disattivato");
      if (write) await db.update(dealLossReasons).set({ isActive: false }).where(eq(dealLossReasons.id, r.id));
    } else {
      line("Motivi di perdita", `«${r.name}» → «${to}»`, "update");
      if (write) await db.update(dealLossReasons).set({ name: to }).where(eq(dealLossReasons.id, r.id));
      r.name = to;
    }
  }
  const reasonNames = new Set(reasons.map((r) => r.name.toLowerCase()));
  const newReasons = LOSS_REASONS.filter((n) => !reasonNames.has(n.toLowerCase()));
  for (const n of LOSS_REASONS) line("Motivi di perdita", n, reasonNames.has(n.toLowerCase()) ? "exists" : "create");
  if (write && newReasons.length) {
    await db.insert(dealLossReasons).values(newReasons.map((name, i) => ({ name, order: reasons.length + i + 1 })));
  }

  // ── Campi personalizzati ──
  const fields: { entityType: string; slug: string }[] = await db
    .select({ entityType: customFieldDefinitions.entityType, slug: customFieldDefinitions.slug })
    .from(customFieldDefinitions);
  for (const [i, f] of CUSTOM_FIELDS.entries()) {
    const label = `${f.entityType}: ${f.name}`;
    if (fields.some((x) => x.entityType === f.entityType && x.slug === f.slug)) {
      line("Campi personalizzati", label, "exists");
      continue;
    }
    line("Campi personalizzati", label, "create");
    if (write)
      await db.insert(customFieldDefinitions).values({
        name: f.name,
        slug: f.slug,
        entityType: f.entityType,
        fieldType: f.fieldType,
        options: f.options ? JSON.stringify(f.options) : null,
        order: 100 + i,
      });
  }

  // ── Gruppi ──
  const groups: { id: string; name: string }[] = await db
    .select({ id: userGroups.id, name: userGroups.name })
    .from(userGroups);
  const groupId = async (name: string): Promise<string | null> => {
    const found = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    return found?.id ?? null;
  };
  for (const g of GROUPS) {
    if (await groupId(g.name)) {
      line("Gruppi", g.name, "exists");
      continue;
    }
    line("Gruppi", g.name, "create", "i membri si aggiungono in Amministrazione → Utenti");
    if (write) {
      const id = crypto.randomUUID();
      await db.insert(userGroups).values({ id, ...g });
      groups.push({ id, name: g.name });
    }
  }

  // ── SLA: only the escalation group; the times are decision 17 ──
  const supportGroup = await groupId("Assistenza");
  const [urgent] = await db
    .select()
    .from(slas)
    .where(and(eq(slas.priority, "urgent"), eq(slas.isActive, true)))
    .limit(1);
  if (!urgent) {
    line("SLA", "urgente", "skip", "nessuna politica urgente: creala in Assistenza → Gestione SLA");
  } else if (urgent.escalationGroupId) {
    line("SLA", "urgente: gruppo di escalation", "exists");
  } else {
    line("SLA", "urgente: escalation al gruppo Assistenza", "update", "i tempi restano quelli di oggi (decisione 17)");
    if (write && supportGroup)
      await db.update(slas).set({ escalationGroupId: supportGroup }).where(eq(slas.id, urgent.id));
  }

  // ── Valutazione del cliente ──
  if (options.csat) {
    line("Assistenza", "valutazione del cliente alla chiusura", "update", "attivata");
    if (write) {
      const value = { enabled: true };
      await db
        .insert(workspaceSettings)
        .values({ key: "support.csat", value })
        .onConflictDoUpdate({ target: workspaceSettings.key, set: { value, updatedAt: new Date() } });
    }
  } else {
    line(
      "Assistenza",
      "valutazione del cliente alla chiusura",
      "skip",
      "scrive ai clienti: si attiva con --valutazione",
    );
  }

  // ── Modelli email ──
  const templates: { name: string; kind: string }[] = await db
    .select({ name: emailTemplates.name, kind: emailTemplates.kind })
    .from(emailTemplates);
  for (const t of TEMPLATES) {
    if (templates.some((x) => x.kind === "personal" && x.name.toLowerCase() === t.name.toLowerCase())) {
      line("Modelli email", t.name, "exists");
      continue;
    }
    line("Modelli email", t.name, "create", "condiviso con il team");
    if (write)
      await db
        .insert(emailTemplates)
        .values({ ...t, kind: "personal", isPublic: true, isHtml: true, category: "general" });
  }

  // ── Macro dell'assistenza ──
  const macros: { name: string }[] = await db.select({ name: ticketMacros.name }).from(ticketMacros);
  for (const m of MACROS) {
    if (macros.some((x) => x.name.toLowerCase() === m.name.toLowerCase())) {
      line("Macro", m.name, "exists");
      continue;
    }
    line("Macro", m.name, "create");
    if (write) await db.insert(ticketMacros).values({ ...m, isPublic: true });
  }

  // ── Prodotti senza prezzo, spenti ──
  const catalogue: { name: string }[] = await db.select({ name: products.name }).from(products);
  for (const p of PRODUCTS) {
    if (catalogue.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) {
      line("Prodotti", p.name, "exists");
      continue;
    }
    line("Prodotti", p.name, "create", "disattivato e a prezzo zero: imposta il prezzo e attivalo");
    if (write) await db.insert(products).values({ ...p, price: "0", taxPercent: "22", isActive: false });
  }

  // ── Sequenza «Primo contatto» ──
  const [existingSequence] = await db
    .select({ id: emailSequences.id })
    .from(emailSequences)
    .where(sql`lower(${emailSequences.name}) = ${SEQUENCE_NAME.toLowerCase()}`)
    .limit(1);
  let sequenceId: string | null = existingSequence?.id ?? null;
  if (sequenceId) {
    line("Sequenze", SEQUENCE_NAME, "exists");
  } else {
    line(
      "Sequenze",
      SEQUENCE_NAME,
      "create",
      "chiamate il giorno 0, 1, 4 e 7, email il giorno 2, nei giorni lavorativi",
    );
    sequenceId = crypto.randomUUID();
    if (write) {
      await db.insert(emailSequences).values({
        id: sequenceId,
        name: SEQUENCE_NAME,
        description: "Tentativi di contatto per un lead appena arrivato. Si ferma se il lead risponde.",
        entityType: "lead",
        businessDays: true,
        sendFrom: "09:00",
        sendUntil: "18:00",
      });
      await db.insert(emailSequenceSteps).values(SEQUENCE_STEPS.map((s, position) => ({ ...s, sequenceId, position })));
    }
  }

  // ── Regole automatiche, tutte spente ──
  const rules: { name: string }[] = await db.select({ name: automationRules.name }).from(automationRules);
  const rule = async (
    name: string,
    def: { targetEntity: string; triggerOn: string[]; conditions: unknown[]; actions: unknown[]; description: string },
  ) => {
    if (rules.some((r) => r.name.toLowerCase() === name.toLowerCase())) return void line("Automazioni", name, "exists");
    line("Automazioni", name, "create", "creata spenta: controllala e attivala");
    if (write)
      await db.insert(automationRules).values({
        name,
        description: def.description,
        isActive: false,
        targetEntity: def.targetEntity,
        triggerOn: def.triggerOn,
        conditionLogic: "AND",
        conditions: JSON.stringify(def.conditions),
        actions: JSON.stringify(def.actions),
      });
  };
  const cond = (field: string, operator: string, value?: string | number, logic: "AND" | "OR" = "AND") => ({
    field,
    operator,
    ...(value !== undefined ? { value } : {}),
    logic,
  });

  const rotation = (options.rotation ?? []).map((e) => who(e)).filter((x): x is string => !!x);
  if (rotation.length) {
    await rule("Assegna i lead senza titolare a rotazione", {
      description: "Un lead che arriva senza titolare va al prossimo della rotazione, che riceve una notifica.",
      targetEntity: "lead",
      triggerOn: ["onCreate"],
      conditions: [cond("ownerId", "is_empty")],
      actions: [
        { type: "assign_owner", params: { strategy: "round_robin", userIds: rotation, routes: [], overwrite: false } },
      ],
    });
  } else {
    line(
      "Automazioni",
      "Assegna i lead senza titolare a rotazione",
      "skip",
      "servono le persone: --rotazione=email,email",
    );
  }

  await rule("Lead da ADS o dal sito: sequenza «Primo contatto»", {
    description: "Iscrive alla sequenza di primo contatto i lead che arrivano dalle campagne o dal modulo del sito.",
    targetEntity: "lead",
    triggerOn: ["onCreate"],
    conditions: [
      cond("source", "equals", "ads_meta"),
      cond("source", "equals", "ads_google", "OR"),
      cond("source", "equals", "web_form", "OR"),
    ],
    actions: sequenceId ? [{ type: "enroll_in_sequence", params: { sequenceId } }] : [],
  });

  await rule("Ogni mattina: lead nuovo non ancora contattato", {
    description: "Avvisa il titolare di un lead ancora «Nuovo» dopo più di un giorno.",
    targetEntity: "lead",
    triggerOn: ["onSchedule"],
    conditions: [cond("status", "equals", "new"), cond("createdAt", "older_than_days", 1)],
    actions: [
      {
        type: "send_notification",
        params: {
          userId: "entity_owner",
          title: "Lead da contattare",
          message: "Questo lead è nuovo da più di un giorno.",
        },
      },
    ],
  });

  await rule("Ogni mattina: trattativa ferma da 10 giorni", {
    description: "Avvisa l'agente di una trattativa aperta senza attività da più di dieci giorni.",
    targetEntity: "deal",
    triggerOn: ["onSchedule"],
    conditions: [cond("status", "equals", "open"), cond("idleDays", "greater_than", 10)],
    actions: [
      {
        type: "send_notification",
        params: {
          userId: "entity_owner",
          title: "Trattativa ferma",
          message: "Nessuna attività da più di dieci giorni.",
        },
      },
    ],
  });

  const admin = who(options.administration);
  await rule("Trattativa vinta: avvia la pratica", {
    description:
      "Alla vittoria: attività per l'amministrazione (o per il titolare) per avviare pratica e primo acconto.",
    targetEntity: "deal",
    triggerOn: ["onUpdate"],
    conditions: [cond("status", "changed_to", "won")],
    actions: [
      {
        type: "create_task",
        params: {
          title: "Avvia la pratica: documenti del cliente e fattura d'acconto",
          priority: "high",
          dueDateDays: 1,
          assigneeId: admin ?? "entity_owner",
        },
      },
    ],
  });

  await rule("Ordine completato: proponi la manutenzione", {
    description: "A lavori finiti, attività per il titolare: proporre il contratto di manutenzione.",
    targetEntity: "order",
    triggerOn: ["onUpdate"],
    conditions: [cond("status", "changed_to", "completed")],
    actions: [
      {
        type: "create_task",
        params: {
          title: "Proponi la manutenzione annuale (pulizia dei pannelli)",
          priority: "normal",
          dueDateDays: 3,
          assigneeId: "entity_owner",
        },
      },
    ],
  });

  const support = who(options.supportLead);
  if (support) {
    await rule("Ticket urgente: richiama il cliente", {
      description: "Un ticket urgente (impianto fermo) avvisa il responsabile e crea la chiamata al cliente per oggi.",
      targetEntity: "ticket",
      triggerOn: ["onCreate"],
      conditions: [cond("priority", "equals", "urgent")],
      actions: [
        {
          type: "send_notification",
          params: { userId: support, title: "Ticket urgente", message: "Impianto fermo: richiamare il cliente." },
        },
        {
          type: "create_task",
          params: { title: "Richiama il cliente", priority: "high", dueDateDays: 0, assigneeId: support },
        },
      ],
    });
    await rule("Ticket oltre lo SLA: avvisa il responsabile", {
      description: "Quando un ticket supera il tempo promesso.",
      targetEntity: "ticket",
      triggerOn: ["onSLABreach"],
      conditions: [cond("status", "not_equals", "closed")],
      actions: [
        {
          type: "send_notification",
          params: { userId: support, title: "SLA superato", message: "Un ticket ha superato il tempo promesso." },
        },
      ],
    });
  } else {
    line(
      "Automazioni",
      "Regole dei ticket urgenti e oltre lo SLA",
      "skip",
      "serve il responsabile: --assistenza=email",
    );
  }

  return out;
}

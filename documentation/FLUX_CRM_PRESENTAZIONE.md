# Flux CRM — Documento di Presentazione del Progetto

**Versione:** 1.0 — Maggio 2026
**Stack Tecnologico:** Next.js 16 App Router · TypeScript · Tailwind CSS v4 · shadcn/ui · Drizzle ORM · PostgreSQL (Neon) · NextAuth v5

---

## Indice

1. [Panoramica del Progetto](#1-panoramica-del-progetto)
2. [Architettura Tecnica](#2-architettura-tecnica)
3. [Autenticazione e Sicurezza](#3-autenticazione-e-sicurezza)
4. [Gestione Utenti e Ruoli](#4-gestione-utenti-e-ruoli)
5. [CRM Dashboard](#5-crm-dashboard)
6. [Leads](#6-leads)
7. [Contatti](#7-contatti)
8. [Aziende](#8-aziende)
9. [Pipeline Vendite](#9-pipeline-vendite)
10. [Finance](#10-finance)
11. [Catalogo Prodotti](#11-catalogo-prodotti)
12. [Preventivi (Quotes)](#12-preventivi-quotes)
13. [Ordini](#13-ordini)
14. [Sales Targets e Funnel](#14-sales-targets-e-funnel)
15. [Marketing](#15-marketing)
16. [Gestione Task](#16-gestione-task)
17. [Calendario e Appuntamenti](#17-calendario-e-appuntamenti)
18. [Chat Interno](#18-chat-interno)
19. [Support Tickets](#19-support-tickets)
20. [Automation Engine](#20-automation-engine)
21. [Report e Analytics](#21-report-e-analytics)
22. [Impostazioni di Sistema](#22-impostazioni-di-sistema)
23. [Notifiche](#23-notifiche)
24. [Webhooks](#24-webhooks)
25. [Architettura Multi-Tenant](#25-architettura-multi-tenant)

---

## 1. Panoramica del Progetto

**Flux CRM** è una piattaforma CRM completa e modulare, progettata per centralizzare la gestione commerciale, operativa e comunicativa di un'organizzazione. Il sistema copre l'intero ciclo di vita del cliente: dall'acquisizione del lead iniziale, alla gestione del contatto e dell'azienda, fino alla chiusura della vendita tramite deal, preventivi e ordini.

A differenza dei template generici, Flux CRM è una piattaforma pronta alla produzione con funzionalità avanzate quali automazioni condizionali, marketing via email con tracking, sistema di ticket omnicanale, report builder personalizzabile e architettura multi-tenant con isolamento completo dei dati per tenant.

### Caratteristiche chiave del sistema

- **Architettura full-stack integrata:** tutto avviene tramite Next.js Server Actions, eliminando la necessità di API REST separate per la maggior parte delle operazioni.
- **Modello di sicurezza RBAC a quattro livelli:** `owner`, `admin`, `editor`, `viewer`, applicato sia lato middleware che lato Server Action.
- **Multi-tenant nativo:** ogni tenant opera su un database PostgreSQL fisicamente separato, garantendo isolamento completo dei dati.
- **Internazionalizzazione (i18n):** interfaccia disponibile in italiano e inglese, con rilevamento automatico della lingua tramite cookie.
- **Design system coerente:** tutti i componenti UI sono basati su shadcn/ui con Tailwind CSS v4, garantendo un'esperienza visiva uniforme.

---

## 2. Architettura Tecnica

### Stack e scelte tecnologiche

| Layer | Tecnologia | Ruolo |
|---|---|---|
| Frontend | Next.js 16 App Router + React 19 | Rendering ibrido SSR/RSC |
| UI Library | shadcn/ui + Tailwind CSS v4 | Componenti e stile |
| Linguaggio | TypeScript | Type safety end-to-end |
| ORM | Drizzle ORM | Query type-safe verso PostgreSQL |
| Database | Neon Postgres (serverless) | Storage principale |
| Auth | NextAuth v5 + Drizzle Adapter | Sessioni e OAuth |
| Email | Resend / SMTP configurabile | Invio email transazionali e campagne |
| Linting | Biome | Lint + format unificati |
| Pre-commit | Husky + lint-staged | Qualità del codice automatizzata |

### Flusso dati standard

Ogni operazione di scrittura nel sistema segue uno schema fisso e consistente:

1. Il Server Action verifica i permessi tramite `requireWriteAccess()` o `requireAdminAccess()`.
2. Viene eseguita la query sul database tramite Drizzle ORM.
3. Il cache Next.js viene invalidato con `revalidatePath(...)` per aggiornare le viste.
4. I webhook configurati vengono notificati in modo asincrono tramite `dispatchWebhook(...)`.
5. Le regole di automazione vengono eseguite tramite `after(() => runAutomations(...))`, ovvero dopo la risposta al client, senza impatto sulla latenza percepita.

### Struttura delle directory

```
src/
  actions/          # Server Actions, un file per dominio (pipeline.ts, crm.ts, quotes.ts…)
  app/
    (main)/dashboard/   # Tutte le rotte CRM con componenti collocati
    (external)/         # Pagine auth (login, register, reset password)
    api/                # Route handlers REST (export CSV, tracking, search globale)
  components/
    crm/            # Componenti condivisi CRM + automation engine
    ui/             # Primitivi shadcn/ui
    dashboard/      # Chrome condiviso (sidebar, header, notifiche)
  db/               # Schema Drizzle, migrazioni, client DB
  lib/              # Utilità (auth-guard, lead-score, email, tenant-context)
  stores/           # Zustand stores (stato UI client-side)
  navigation/       # Definizioni sidebar come NavGroup[]
```

---

## 3. Autenticazione e Sicurezza

### Ruolo nel sistema

Il modulo di autenticazione gestisce l'identità di ogni utente che accede alla piattaforma. È il punto di ingresso obbligato per qualsiasi interazione con il sistema ed è costruito su NextAuth v5 con adattatore Drizzle per la persistenza delle sessioni su PostgreSQL.

### Come funziona

L'autenticazione supporta due provider in parallelo:

- **Credenziali email + password:** la password viene salvata con hashing bcrypt. Al login, le credenziali vengono verificate lato server senza esporre hash al client.
- **Google OAuth:** flusso standard OAuth 2.0 tramite provider Google, con redirect automatico dopo il consenso.

Le sessioni vengono mantenute tramite cookie firmati (`AUTH_SECRET`). Il middleware Next.js intercetta ogni richiesta alle rotte `/dashboard/*` e verifica la validità della sessione prima di consentire il rendering.

### Funzionalità implementate

**Registrazione e login:**
- Pagina di login con form validato lato client e lato server.
- Pagina di registrazione con validazione email univoca e requisiti password.
- Due varianti visive del layout login disponibili (v1, v2).

**Reset password:**
- Flusso in tre step: richiesta reset su `/auth/v1/forgot-password` → email con token temporaneo → inserimento nuova password su `/auth/v1/reset-password`.
- Token salvato nella tabella `password_reset_token` con scadenza configurabile.
- Email inviata tramite il servizio Resend (o SMTP, se configurato).

**Invito utenti:**
- Un admin genera un link di invito con token univoco verso una email specifica.
- L'invitato accede a `/auth/v1/accept-invitation` e completa la registrazione.
- Il token di invito è salvato nella tabella `user_invitation` con data di scadenza e ruolo predefinito.

**Protezione rate limiting:**
- Il middleware edge limita i tentativi di login a 10 richieste per minuto per IP, bloccando attacchi brute-force senza dipendenze esterne.

---

## 4. Gestione Utenti e Ruoli

### Ruolo nel sistema

Questo modulo consente agli amministratori di gestire chi può accedere al sistema e con quali permessi, applicando un modello RBAC (Role-Based Access Control) a quattro livelli gerarchici.

### Gerarchia dei ruoli

```
owner  >  admin  >  editor  >  viewer
```

- **owner:** accesso completo, inclusa la gestione tenant e la cancellazione dell'organizzazione.
- **admin:** gestione utenti, ruoli, impostazioni di sistema e webhooks.
- **editor:** creazione e modifica di tutti i record CRM (leads, contatti, deal, ecc.).
- **viewer:** sola lettura su tutti i moduli; bloccato su qualsiasi azione di scrittura a livello di Server Action.

### Funzionalità implementate

**Pagina Users Management (`/dashboard/users`):**
- Lista completa di tutti gli utenti del sistema con nome, email, ruolo e avatar.
- Creazione di nuovi utenti tramite invito via email.
- Modifica del ruolo di un utente esistente tramite dropdown inline.
- Rimozione di un utente dall'organizzazione.

**Pagina Roles Management (`/dashboard/roles`) — solo admin/owner:**
- Matrice visiva dei permessi per ogni ruolo: quali azioni sono consentite o negate.
- Sezione "Utenti per ruolo": elenco degli utenti raggruppati per il loro livello di accesso.
- Dropdown inline per riassegnare il ruolo a un utente direttamente dalla matrice.

**Gruppi utente (`user_group`):**
- I gruppi permettono di raggruppare utenti in team (es. "Sales Team Nord", "Support L2").
- Leads, contatti, aziende e deal possono essere assegnati a un gruppo oltre che a un singolo utente.
- La tabella `user_group_member` gestisce l'appartenenza con chiave primaria composta.

**Protezione lato middleware:**
- Le rotte `/dashboard/users`, `/dashboard/roles` e `/dashboard/settings` sono bloccate per `editor` e `viewer` a livello di routing, prima ancora di caricare qualsiasi componente.

---

## 5. CRM Dashboard

### Ruolo nel sistema

La CRM Dashboard (`/dashboard/crm`) è la pagina di atterraggio dopo il login. Fornisce una visione sintetica e operativa dello stato corrente dell'attività commerciale, aggregando i dati più rilevanti da tutti i moduli in un'unica schermata.

### Funzionalità implementate

**Schede KPI principali:**
- Totale lead attivi, nuovi lead del mese, tasso di conversione.
- Deal aperti, valore totale pipeline, deal chiuse nel mese.
- Task in scadenza oggi, attività recenti registrate.

**Cards insight:**
- Carte con trend comparativo rispetto al periodo precedente (crescita/decrescita percentuale).
- Indicatori visivi a colore per segnalare situazioni critiche vs. positive.

**Target mensile (`month-target-card`):**
- Confronto tra l'obiettivo di vendita del mese corrente e il consuntivo attuale.
- Indicatore progress bar con percentuale di raggiungimento.

**Tabella lead recenti:**
- Ultimi lead acquisiti con nome, stato, fonte, lead score e data creazione.
- Link diretto al profilo completo del lead.

**Agenda widget:**
- Appuntamenti e task in scadenza nelle prossime 24-48 ore, direttamente nella dashboard.

---

## 6. Leads

### Ruolo nel sistema

Il modulo Leads gestisce i potenziali clienti nelle fasi iniziali dell'acquisizione, prima che diventino contatti qualificati. Ogni lead rappresenta un'opportunità commerciale non ancora confermata.

### Come funziona

I lead vengono acquisiti manualmente (form di creazione), via import CSV o potenzialmente da integrazioni esterne tramite webhook. Ogni lead percorre un ciclo di vita definito da stati progressivi e può essere convertito in contatto, azienda e deal con un'operazione atomica.

### Funzionalità implementate

**Ciclo di vita e stati:**
- Stati disponibili: `new`, `contacting`, `engaged`, `qualified`, `unqualified`.
- Tracking del campo `convertedAt`, `convertedToContactId`, `convertedToCompanyId`, `convertedToDealId` per tracciare la conversione.

**Lead Scoring automatico:**
- Il sistema calcola automaticamente un punteggio (`lead_score`) tramite la funzione `computeLeadScore()` in `src/lib/lead-score.ts`.
- Il punteggio determina la classe di qualità: **Cold** (0-25), **Warm** (26-50), **Hot** (51-75), **Very Hot** (76-100).
- Il badge di qualità viene visualizzato in lista e nel profilo del lead.

**Conversione Lead (`/dashboard/leads/[id]`):**
- Pulsante "Converti Lead" sulla pagina di dettaglio.
- Il flusso crea in modo atomico: un nuovo `contact`, una nuova `company` (se non esistente), e una nuova `deal` collegata.
- I campi `convertedToContactId`, `convertedToCompanyId`, `convertedToDealId` vengono aggiornati e il flag `isConverted` viene impostato a `true`.

**Import/Export CSV:**
- Export: endpoint `GET /api/leads/export` restituisce un file CSV con tutti i campi del lead.
- Import: deduplica automatica per email — se un lead con la stessa email esiste già, il record viene aggiornato anziché duplicato.

**Bulk Actions:**
- Selezione multipla di lead dalla lista con checkbox.
- Azioni disponibili in batch: cancellazione, cambio stato, riassegnazione owner.

**Filtri avanzati e filtri salvati:**
- Filtri combinabili per stato, fonte, punteggio, owner, gruppo, tag e data creazione.
- I filtri possono essere salvati come preset personali o condivisi con il team (`isPublic`).
- I filtri possono essere marcati come "pinnati" per accesso rapido.

**Campi personalizzati:**
- I lead supportano campi custom definiti dall'amministratore tramite il sistema Custom Fields (tipo text, number, date, select, multiselect, boolean, url).

---

## 7. Contatti

### Ruolo nel sistema

I Contatti rappresentano persone fisiche con cui l'organizzazione ha già stabilito o intende stabilire una relazione commerciale diretta. A differenza dei lead, i contatti sono entità qualificate, tipicamente associate a un'azienda e collegate a deal attive.

### Funzionalità implementate

**Profilo completo:**
- Anagrafica: nome, cognome, job title, dipartimento, email, telefono, mobile, LinkedIn.
- Dati geografici: via, città (con autocomplete da tabella `geo_city`), CAP, paese (da tabella `geo_country`).
- Stato, fonte di acquisizione, note libere, tag.

**Relazioni:**
- Collegamento a un'azienda (`companyId`).
- Collegamento al lead di origine (`sourceLeadId`), tracciando la provenienza da una conversione.
- Proprietario (`ownerId`) e gruppo di lavoro (`groupId`).

**Consenso marketing:**
- Campi `marketingConsent` (boolean) e `consentDate` (timestamp) per la conformità GDPR.
- I contatti senza consenso non vengono inclusi nelle campagne email.

**Import/Export CSV:**
- Export: `GET /api/contacts/export` — scarica tutti i contatti in formato CSV.
- Import: `POST /api/contacts/import` — caricamento file CSV con deduplica per email.

**Attività e task collegati:**
- Ogni contatto ha una timeline di attività (note, chiamate, meeting, email) e task associati.
- Le attività vengono visualizzate in ordine cronologico nella pagina di dettaglio.

**Bulk Actions e filtri salvati** — identici al modulo Lead.

---

## 8. Aziende

### Ruolo nel sistema

Le Aziende (Companies) rappresentano le organizzazioni con cui si intrattengono rapporti commerciali. Sono il nodo aggregatore che collega contatti, deal, attività e ticket relativi allo stesso cliente aziendale.

### Funzionalità implementate

**Profilo azienda:**
- Nome, settore, sito web, descrizione, tipologia (`prospect`, `customer`, `partner`, `vendor`).
- Dati dimensionali: numero dipendenti, fatturato annuo stimato.
- Dati fiscali italiani: Partita IVA (`vat_number`), Codice SDI (`sdi_code`).
- Contatti principali: telefono, email, LinkedIn aziendale.
- Dati geografici con selezione geografica strutturata.

**Relazioni:**
- Lista dei contatti associati all'azienda.
- Deal attive e storiche dell'azienda.
- Attività e task collegati.
- Ticket di supporto aperti.

**Tipologie azienda:**
- Il campo `type` categorizza le aziende in: `prospect` (potenziale cliente), `customer` (cliente attivo), `partner`, `vendor` (fornitore).

---

## 9. Pipeline Vendite

### Ruolo nel sistema

La Pipeline gestisce il processo commerciale dalle opportunità aperte fino alla chiusura (vinta o persa). Offre una visione kanban delle deal suddivise per fase del ciclo di vendita, con supporto al drag-and-drop per spostare le deal tra gli stage.

### Come funziona

Le deal sono l'entità commerciale centrale della pipeline. Ogni deal si trova in uno stage configurabile (es. "Prospecting", "Qualifica", "Proposta", "Negoziazione", "Chiuso Vinto"). Le stage sono ordinate e configurabili dall'admin tramite la pagina `/dashboard/settings/pipeline`.

### Funzionalità implementate

**Kanban Board (`/dashboard/pipeline`):**
- Vista a colonne, una per ogni stage della pipeline.
- Drag-and-drop delle card tra le colonne per spostare le deal di stage.
- Ogni card mostra: nome deal, importo, azienda, contatto, probabilità di chiusura, data chiusura attesa.
- Health score della deal visualizzato con indicatore colorato.

**Stage configurabili:**
- CRUD degli stage da `/dashboard/settings/pipeline`.
- Ogni stage ha: nome, ordine, colore, probabilità di default.
- Il vincolo `onDelete: "restrict"` impedisce l'eliminazione di uno stage con deal attive.

**Dettaglio deal (`/dashboard/pipeline/[id]`):**
- Tutti i campi della deal (importo, valuta, probabilità, data chiusura attesa).
- Thread commenti: discussione strutturata con supporto a risposte annidate (commenti e sotto-commenti).
- Timeline attività collegate alla deal.
- Task associati alla deal.
- Preventivi (quotes) collegati alla deal.

**Thread commenti sulle deal:**
- Ogni deal ha un thread di commenti collaborativo.
- Supporto a risposte annidate (max un livello di profondità tramite `parentId`).
- I commenti mostrano avatar, nome utente e timestamp di creazione/modifica.

**Pipeline Report (`/dashboard/pipeline/report`):**
- Grafici di analisi: distribuzione deal per stage, trend temporale delle chiusure, deal per owner.
- Tabelle riassuntive con valori aggregati per periodo.

**Weighted Forecast:**
- Il sistema calcola automaticamente il valore ponderato della pipeline (`amount × probability / 100`) per stimare il fatturato atteso.

---

## 10. Finance

### Ruolo nel sistema

Il modulo Finance (`/dashboard/finance`) aggrega i dati economici reali dell'organizzazione in una dashboard direzionale, integrando dati da deal vinte, ordini completati e preventivi accettati.

### Funzionalità implementate

**Revenue Dashboard:**
- Totale ricavi realizzati (somma deal won + ordini completati + preventivi accettati).
- Trend mensile a 12 mesi con grafico a linea.
- Pipeline weighted value (valore ponderato per probabilità) come indicatore previsionale.

**Cash Flow Overview:**
- Visualizzazione del flusso di cassa previsto e realizzato su base mensile.
- Componente `cash-flow-overview.tsx` con confronto entrate/uscite.

**Income Reliability:**
- Analisi della affidabilità del forecast: confronto tra valore previsto e consuntivo per i periodi storici.
- Componente `income-reliability.tsx` con indicatore di accuratezza previsionale.

**Spending Breakdown:**
- Distribuzione delle entrate per categoria (per stage deal, per tipologia ordine).
- Grafici a torta o a barre per drill-down.

**Multi-valuta:**
- Il sistema supporta valute multiple per deal e preventivi.
- Tabella `exchange_rates_cache` con tassi di cambio aggiornati periodicamente (base EUR).

---

## 11. Catalogo Prodotti

### Ruolo nel sistema

Il Catalogo Prodotti (`/dashboard/products`) è il registro centralizzato di tutti i beni e servizi vendibili dall'organizzazione. I prodotti vengono utilizzati come voci nei preventivi e negli ordini, garantendo coerenza di prezzo e descrizione.

### Funzionalità implementate

**Anagrafica prodotto:**
- Nome, descrizione, SKU (codice prodotto univoco).
- Prezzo unitario, percentuale IVA, unità di misura, categoria.
- Flag `isActive` per disattivare prodotti senza eliminarli (evitando di rompere preventivi storici).

**Integrazione con preventivi e ordini:**
- Al momento della creazione di una riga in un preventivo o ordine, il commerciale può selezionare un prodotto dal catalogo: prezzo e IVA vengono pre-compilati automaticamente.
- Le righe mantengono il prezzo al momento della creazione (`unitPrice` nella riga), indipendente dalle modifiche successive al catalogo.

---

## 12. Preventivi (Quotes)

### Ruolo nel sistema

Il modulo Preventivi (`/dashboard/quotes`) gestisce l'intero processo di offerta commerciale: dalla redazione interna, all'approvazione, all'invio al cliente, fino all'accettazione o al declino. Ogni preventivo è collegato a una deal e a un'azienda.

### Come funziona

Il preventivo percorre un workflow di stati ben definito. Lo stato determina quali azioni sono disponibili e quali campi vengono registrati.

### Workflow degli stati

```
draft → pending_approval → sent → viewed → accepted / declined / expired
                                  ↓
                              converted (→ ordine)
```

**Stati disponibili:**
- `draft`: preventivo in redazione, non ancora inviato.
- `pending_approval`: in attesa di approvazione interna (admin/owner).
- `sent`: inviato al cliente via email.
- `viewed`: il cliente ha aperto il link di visualizzazione pubblica.
- `accepted`: il cliente ha accettato formalmente.
- `declined`: il cliente ha rifiutato, con possibilità di registrare il motivo.
- `expired`: la data di scadenza è passata senza risposta.
- `converted`: il preventivo è stato convertito in ordine.

### Funzionalità implementate

**Redazione preventivo:**
- Numero preventivo autogenerato e univoco (`quoteNumber`).
- Selezione azienda, contatto, deal di riferimento e owner.
- Righe preventivo (`quoteItems`): selezione prodotto dal catalogo o inserimento libero, quantità, prezzo unitario, sconto percentuale o fisso, IVA per riga.
- Calcolo automatico di subtotale, sconto totale, IVA totale e importo finale.
- Campo note libere e data di scadenza.

**Workflow approvazione:**
- Il commerciale sottomette il preventivo per approvazione (`pending_approval`).
- L'admin/owner approva o rifiuta con nota motivazionale (`approvalNote`).
- Solo i preventivi approvati possono essere inviati al cliente.

**Invio via email:**
- Pulsante "Invia al Cliente" genera un'email con link univoco al preventivo.
- Al click su "Invia", il campo `sentAt` viene registrato e lo stato passa a `sent`.

**Visualizzazione pubblica del cliente (`/q/[token]`):**
- Ogni preventivo ha un token univoco (`publicToken`) che permette la visualizzazione senza login.
- Il cliente vede il preventivo formattato con tutti i dettagli commerciali.
- Al primo accesso, lo stato passa automaticamente a `viewed` e il campo `viewedAt` viene registrato.
- Il cliente può accettare o rifiutare il preventivo direttamente dalla pagina pubblica.

**Esportazione PDF:**
- Il preventivo può essere esportato in PDF per l'invio tramite canali alternativi.

**Versioning:**
- Il campo `version` traccia le revisioni del preventivo (incrementato ad ogni modifica dopo l'invio).

**Audit trail (`quoteActivities`):**
- Ogni evento rilevante viene registrato: creazione, invio, visualizzazione, accettazione, declino, modifica.
- Per gli eventi del cliente vengono registrati anche IP address e user agent.

**Validazione con Zod (`src/actions/quotes-validation.ts`):**
- Tutte le operazioni di creazione e modifica passano per schemi Zod con messaggi di errore localizzati.

---

## 13. Ordini

### Ruolo nel sistema

Il modulo Ordini (`/dashboard/orders`) gestisce le transazioni commerciali confermate. Un ordine rappresenta un acquisto formalizzato, tipicamente generato dalla conversione di un preventivo accettato.

### Funzionalità implementate

**Gestione ordini:**
- Numero ordine autogenerato e univoco (`orderNumber`).
- Collegamento a azienda, contatto, deal e preventivo di origine.
- Stati: `draft`, `processing`, `completed`, `cancelled`.
- Data ordine e tracking temporale.

**Righe ordine (`orderItems`):**
- Prodotto, quantità, prezzo unitario al momento dell'ordine, totale riga.
- Vincolo `onDelete: "restrict"` sul prodotto per preservare la tracciabilità.

**Dashboard ordini:**
- Lista ordini con filtri per stato, data, importo.
- KPI riepilogativi: numero ordini del mese, valore totale, ordini in processing.
- Vista di dettaglio con tutte le righe e il totale.

---

## 14. Sales Targets e Funnel

### Ruolo nel sistema

Questi due moduli forniscono strumenti di pianificazione e analisi delle performance commerciali, consentendo di fissare obiettivi individuali e di misurare l'efficacia del funnel di vendita.

### Sales Targets (`/dashboard/settings/targets`)

**Come funziona:**
- Gli obiettivi di vendita vengono definiti per utente (commerciale) e per periodo.
- I periodi supportati sono: mensile (`month`), trimestrale (`quarter`), annuale (`year`).
- Ogni target specifica l'importo obiettivo (`targetAmount`) e, opzionalmente, il numero di deal da chiudere (`targetDeals`).
- Il vincolo di unicità `(userId, period)` garantisce un solo target per utente per periodo.

**Funzionalità:**
- Dashboard di confronto tra target fissato e consuntivo realizzato.
- Progress bar con percentuale di raggiungimento per ogni commerciale.
- Vista aggregata per team e per periodo.

### Sales Funnel (`/dashboard/analytics/funnel`)

**Come funziona:**
- Il funnel analizza quanti lead/deal transitano attraverso ogni stage del processo di vendita.
- Mostra i tassi di conversione tra uno stage e il successivo.

**Funzionalità:**
- Grafico funnel con volumi per stage.
- Tasso di conversione stage-by-stage (es. "Prospecting → Qualifica: 68%").
- Filtri per periodo e per owner.

---

## 15. Marketing

### Ruolo nel sistema

Il modulo Marketing gestisce le comunicazioni di massa verso lead e contatti tramite campagne email. Il sistema supporta la personalizzazione dei messaggi, la schedulazione delle campagne e il tracking completo delle interazioni del destinatario.

### Template Email (`/dashboard/marketing/templates`)

**Come funziona:**
I template sono modelli riutilizzabili per le campagne email. Supportano contenuto HTML completo con variabili di personalizzazione.

**Funzionalità:**
- Editor dedicato per la creazione del template con anteprima.
- Variabili di personalizzazione dinamiche: `{{nome}}`, `{{cognome}}`, `{{azienda}}` e altre.
- Categorie: `general`, `welcome`, `followup`, `promotional`, `transactional`.
- Campo `previewText` per il testo di anteprima visualizzato dai client email.
- Flag `isPublic` per condividere template con tutto il team.
- Tag per organizzare e filtrare i template.
- Supporto HTML e testo semplice (`isHtml`).

### Campagne Email (`/dashboard/marketing/campaigns`)

**Come funziona:**
Una campagna associa un template a una lista di destinatari (contatti o lead con consenso marketing attivo) e gestisce l'invio massivo con tracking.

**Funzionalità:**
- Creazione campagna con nome, descrizione, selezione template e destinatari (leads o contacts).
- Schedulazione invio: la campagna può essere schedulata per una data/ora futura (`scheduledAt`).
- Stati campagna: `draft`, `scheduled`, `active`, `completed`.
- Invio massivo con gestione della coda email (`email_job`): ogni email viene accodata separatamente con retry automatico fino a 3 tentativi in caso di errore.
- Personalizzazione automatica: le variabili nel template vengono sostituite con i dati reali del destinatario prima dell'invio.

**Tracking:**
- **Tracking aperture:** ogni email include un pixel 1×1 invisibile che registra l'apertura tramite `GET /api/track/open`. Il campo `openedAt` nel `campaign_log` viene aggiornato al primo accesso.
- **Tracking click:** i link nell'email vengono reindirizzati attraverso `GET /api/track/click`, che registra il click (`clickedAt`) e poi effettua il redirect verso la destinazione originale.

**Report campagna:**
- Per ogni campagna: numero email inviate, aperte, cliccate, con errore, con bounce, disiscrizioni.
- Tasso di apertura (open rate) e tasso di click (click-through rate) calcolati automaticamente.
- Lista dettagliata dei destinatari con il loro stato individuale.

**Gestione soppressioni:**
- La tabella `email_suppression` raccoglie email di destinatari che si sono disiscritti, hanno generato bounce hard, bounce soft o reclami.
- Le email nella lista soppressioni vengono automaticamente escluse dagli invii futuri.

---

## 16. Gestione Task

### Ruolo nel sistema

Il modulo Task fornisce un sistema completo di project management integrato nel CRM. I task possono essere indipendenti o collegati a qualsiasi entità del sistema (lead, contatto, azienda, deal, ticket).

### Task List (`/dashboard/tasks`)

**Funzionalità:**
- Creazione task con titolo, descrizione, data scadenza, data inizio, priorità, stato.
- Priorità disponibili: `low`, `normal`, `high`, `critical`, `blocker`.
- Stati: `todo`, `in_progress`, `done`.
- Assegnazione a un responsabile (`assigneeId`) e a un owner (`ownerId`).
- Collegamento a entità CRM: lead, contatto, azienda, deal, ticket.

**Subtask e gerarchia:**
- I task supportano una struttura ad albero con profondità massima di 3 livelli (root → subtask → sub-subtask → foglia).
- Il campo `depth` traccia il livello nella gerarchia.
- Il campo `progressPct` (0-100%) viene calcolato automaticamente in base al completamento dei figli.

**Multi-assignee con ruoli RACI:**
- Un task può avere più assegnatari tramite la tabella `task_assignee`.
- Ogni assegnatario ha un ruolo: `responsible`, `accountable`, `consulted`, `informed`.

**Time tracking:**
- La tabella `task_time_log` registra sessioni di lavoro con `startedAt`, `stoppedAt` e ore totali.
- I campi `estimatedHours` e `actualHours` permettono il confronto previsionale vs. consuntivo.

**Dipendenze tra task:**
- La tabella `task_dependency` supporta quattro tipi di relazione logica: `FS` (Finish-to-Start), `SS` (Start-to-Start), `FF` (Finish-to-Finish), `SF` (Start-to-Finish).
- Il campo `lagDays` consente di specificare un ritardo tra la fine/inizio del predecessore e l'inizio/fine del successore.

### Gantt Chart (`/dashboard/tasks/gantt`)

**Come funziona:**
Il Gantt visualizza i task su una linea temporale orizzontale con barre proporzionali alla durata. Supporta la visualizzazione della struttura gerarchica e delle dipendenze.

**Funzionalità:**
- Visualizzazione timeline con zoom (giornaliero, settimanale, mensile).
- Barre di progresso colorate in base alla percentuale di completamento.
- Drag per spostare le date di un task.
- Pannello workload integrato nella vista Gantt.
- Toolbar con filtri rapidi per owner, stato e periodo.

### Workload View (`/dashboard/tasks/workload`)

**Come funziona:**
La vista Workload mostra la distribuzione del carico di lavoro per utente nel tempo, permettendo di identificare squilibri nel team.

**Funzionalità:**
- Griglia utente × periodo con volume di ore assegnate per cella.
- Indicatori di sovraccarico (rosso) e sottocarico (grigio) per ogni utente.
- Filtri per periodo e per gruppo.

---

## 17. Calendario e Appuntamenti

### Ruolo nel sistema

Il Calendario (`/dashboard/calendar`) centralizza la gestione degli appuntamenti interni ed esterni, integrandosi con le entità CRM e supportando l'invio di inviti iCalendar standard.

### Funzionalità implementate

**Vista calendario:**
- Vista mensile, settimanale e giornaliera.
- Visualizzazione sovrapposta di appuntamenti e task con scadenza.

**Appuntamenti:**
- Titolo, descrizione, data/ora inizio e fine, timezone, luogo fisico, URL luogo.
- Tipo conferenza: `jitsi`, `zoom`, `teams`, `custom` con link diretto.
- Stati: `scheduled`, `cancelled`, `completed`.
- Sequenza (`sequence`) per la gestione delle versioni dell'invito iCalendar.
- Collegamento a contatto, deal, azienda o lead.

**Partecipanti (`appointment_attendee`):**
- Ogni appuntamento può avere più partecipanti (utenti interni o contatti esterni).
- Ruolo per partecipante: `organizer`, `required`, `optional`.
- Stato risposta: `pending`, `accepted`, `declined`, `tentative`.
- Token univoco per risposta anonima (`responseToken`) senza login.

**Reminder:**
- Campo `reminderMinutes` per configurare il preavviso (in minuti) prima dell'appuntamento.

---

## 18. Chat Interno

### Ruolo nel sistema

Il modulo Chat (`/dashboard/chat`) fornisce una messaggistica interna al team, eliminando la necessità di strumenti esterni per la comunicazione tra i membri dell'organizzazione.

### Funzionalità implementate

**Conversazioni dirette (DM):**
- Chat 1:1 tra due utenti del sistema.
- Ogni conversazione è rappresentata da un record `dm_conversation` di tipo `direct`.

**Conversazioni di gruppo:**
- Chat multi-utente con nome personalizzato (`name`).
- Tipo `group` per distinguere dalle conversazioni dirette.

**Messaggi:**
- La tabella `dm_message` registra ogni messaggio con mittente e timestamp.
- Tracciamento lettura: campo `lastReadAt` per utente per conversazione (via `dm_conversation_member`).
- Muting: ogni partecipante può silenziare una conversazione fino a una certa data (`mutedUntil`).

---

## 19. Support Tickets

### Ruolo nel sistema

Il modulo Support Tickets (`/dashboard/support/tickets`) gestisce le richieste di assistenza dei clienti in un sistema omnicanale strutturato. I ticket aggregano comunicazioni provenienti da email, chat, telefono e social, fornendo un punto unico di gestione per il team di supporto.

### Funzionalità implementate

**Creazione e gestione ticket:**
- Numero ticket autogenerato e univoco (`ticketNumber`).
- Soggetto, descrizione, canale di provenienza (`email`, `chat`, `phone`, `social`).
- Priorità: `low`, `normal`, `high`, `urgent`.
- Severità: `low`, `normal`, `high`, `critical`.
- Tipo: `support`, `bug`, `complaint`, `info_request`, `internal_task`.
- Componente software affetto (campo libero).
- Collegamento a contatto, azienda e lead.
- Assegnazione a un agente (`assigneeId`) e a un owner (`ownerId`).
- Assegnazione a un gruppo di lavoro (`groupId`).
- Ticket padre (`parentTicketId`) per sub-ticket.

**Ciclo di vita:**
- Stati: `new`, `open`, `in_progress`, `waiting`, `on_hold`, `resolved`, `closed`.
- Tracking delle date chiave: `firstResponseAt`, `resolvedAt`, `closedAt`.

**Vista Kanban (`/dashboard/support/tickets`):**
- Visualizzazione a colonne per stato del ticket con drag-and-drop.
- Alternabile con vista lista.

**Thread messaggi (`ticket_message`):**
- Ogni ticket ha un thread di messaggi pubblici e interni.
- I messaggi pubblici (`isPublic: true`) sono visibili al cliente; quelli interni solo al team.
- Supporto allegati tramite riferimento a `document_id`.
- Campi `emailMessageId` e `emailInReplyTo` per la correlazione con email effettive.

**Macro (`ticket_macro`):**
- Risposte predefinite (macro) per velocizzare le risposte frequenti.
- Macro pubbliche condivisibili con tutto il team o private per singolo agente.
- Gestione da `/dashboard/settings/macros`.

**Audit log (`ticket_audit_log`):**
- Ogni modifica rilevante al ticket viene registrata: cambio stato, cambio priorità, assegnazione, aggiunta messaggio.
- I log riportano l'attore, il campo modificato, il valore precedente e il nuovo valore.

### SLA Management (`/dashboard/settings/sla`)

**Come funziona:**
Le SLA (Service Level Agreement) definiscono i tempi massimi di risposta e risoluzione per ogni livello di priorità.

**Funzionalità:**
- Creazione profili SLA con nome, priorità target, tempo massimo prima risposta (minuti), tempo massimo risoluzione (minuti).
- Assegnazione di un profilo SLA a un ticket.
- Tracking: `slaDeadlineAt` è il timestamp calcolato automaticamente al momento della creazione del ticket.
- Rilevamento breach: se il ticket non viene risolto entro `slaDeadlineAt`, il campo `slaBreachedAt` viene registrato.
- Pausa SLA: quando un ticket passa in stato `waiting` (in attesa del cliente), il timer SLA viene sospeso tramite `slaPausedAt` e `slaPauseMinutes`.

---

## 20. Automation Engine

### Ruolo nel sistema

L'Automation Engine (`/dashboard/automation`) consente di definire regole if-then che vengono eseguite automaticamente al verificarsi di eventi sulle entità CRM, eliminando attività manuali ripetitive.

### Come funziona

Le regole di automazione vengono valutate in modo asincrono tramite `after(() => runAutomations(...))` nei Server Actions, ovvero dopo che la risposta è già stata restituita al client. Questo garantisce che l'automazione non impatti la latenza percepita dall'utente.

Il motore legge tutte le regole attive per l'entità e l'evento corrente, valuta le condizioni e, se soddisfatte, esegue le azioni configurate.

### Funzionalità implementate

**Entità target supportate:**
- `deal`, `lead`, `contact`, `company`.

**Trigger disponibili:**
- `onCreate`: la regola si attiva quando viene creata una nuova entità.
- `onUpdate`: la regola si attiva quando un'entità esistente viene modificata.

**Logica condizionale:**
- Condizioni semplici combinate con `AND` o `OR`.
- Logica avanzata con espressioni parentesizzate tramite il campo `conditionExpression` (es. `"(C0 OR C1) AND C2"`).

**Azioni disponibili:**
- Inviare una email a un destinatario specificato.
- Creare un task collegato all'entità.
- Aggiornare un campo dell'entità.
- Inviare una notifica interna a un utente.

**Protezioni anti-loop:**
- Il campo `loopDetected` e `loopInfo` nel log tracciano i casi in cui una regola verrebbe attivata ricorsivamente da se stessa.
- Il sistema limita la profondità di innesco (chain depth) per prevenire loop infiniti.

**Retry con backoff esponenziale:**
- In caso di errore nell'esecuzione delle azioni, il sistema ritenta automaticamente con backoff esponenziale.
- I campi `retryCount` e `retryInfo` nel log tracciano lo stato dei tentativi.

**Log di esecuzione:**
- Ogni esecuzione di una regola genera un record in `automation_log` con: entità coinvolta, evento, successo/errore, azioni eseguite, eventuale errore.
- La dashboard di automazione mostra un riepilogo delle esecuzioni recenti con stato.

**Log email di automazione:**
- Le email inviate tramite automazione (non campagne) vengono tracciate nella tabella `campaign_log` con `campaignId` NULL, permettendo di distinguerle facilmente dalle campagne marketing.

---

## 21. Report e Analytics

### Ruolo nel sistema

Il modulo Report (`/dashboard/reports`) fornisce agli amministratori una visione analitica delle performance operative dell'intera organizzazione, aggregando dati da tutti i moduli del sistema.

### Report Standard (`/dashboard/reports`)

**KPI Overview:**
- Totale azioni registrate nel periodo (login, creazioni, completamenti).
- Task completati nel periodo, filtrabili per utente.
- Deal create e chiuse nel periodo.
- Ticket aperti e risolti.

**Filtri disponibili:**
- Per periodo (data inizio / data fine).
- Per singolo utente (commerciale o agente).

### Report Builder (`/dashboard/reports/builder`)

**Come funziona:**
Il Report Builder è uno strumento no-code che permette agli amministratori di costruire report personalizzati scegliendo entità, metriche, filtri e tipo di visualizzazione, senza scrivere SQL.

**Funzionalità:**
- Selezione dell'entità da analizzare: deal, contatti, lead, ticket, campagne, ordini, ecc.
- Scelta delle metriche da visualizzare (conteggi, somme, medie, ecc.).
- Filtri personalizzabili per ogni campo dell'entità selezionata.
- Tipi di grafico: barre, linea, torta, tabella.
- Salvataggio del report configurato come `saved_report` con nome e visibilità (privato o condiviso con il team).

### Pipeline Analytics (`/dashboard/analytics`)

- Analisi avanzate della pipeline: azioni di gestione, rischi, previsioni.
- Componenti specializzati: `analytics-actions-manager-queue`, `analytics-actions-risk-ledger`, `analytics-drivers-forecast-target`.

---

## 22. Impostazioni di Sistema

### Ruolo nel sistema

La sezione Impostazioni (`/dashboard/settings`) raccoglie tutte le configurazioni globali della piattaforma, accessibili esclusivamente ad admin e owner.

### Custom Fields (`/dashboard/settings/custom-fields`)

**Come funziona:**
Gli amministratori possono estendere le entità standard del CRM con campi aggiuntivi personalizzati, senza modificare il codice.

**Tipi di campo supportati:**
- `text`: testo libero.
- `number`: valore numerico.
- `date`: selettore data.
- `select`: selezione singola da lista opzioni predefinite.
- `multiselect`: selezione multipla.
- `boolean`: toggle vero/falso.
- `url`: URL con validazione formato.

**Entità supportate:** `contact`, `lead`, `company`, `deal`.

**Funzionalità:**
- Creazione, modifica e cancellazione di definizioni campo (`custom_field_definition`).
- Ordine dei campi configurabile.
- Flag `isRequired` per rendere un campo obbligatorio nella compilazione.
- I valori dei campi custom vengono salvati nella tabella `custom_field_value` come testo, con cast al tipo corretto in fase di lettura.

### Configurazione Email (`/dashboard/settings/email`)

- Selezione del provider: **Resend** (cloud, configurazione semplice) o **SMTP** (server mail proprietario).
- Configurazione Resend: API key.
- Configurazione SMTP: host, porta, utente, password, flag TLS.
- Nome e indirizzo email mittente (`fromName`, `fromEmail`).

### Stage Pipeline (`/dashboard/settings/pipeline`)

- CRUD completo degli stage della pipeline di vendita.
- Riordinamento tramite drag-and-drop.
- Colore e probabilità di default per ogni stage.

### Macro Ticket (`/dashboard/settings/macros`)

- CRUD delle risposte rapide predefinite per il supporto.
- Flag visibilità: pubbliche (condivise con il team) o private.

### Webhooks (`/dashboard/settings/webhooks`)

- Configurazione (vedere sezione 24).

---

## 23. Notifiche

### Ruolo nel sistema

Il sistema di notifiche in-app informa gli utenti in tempo reale degli eventi rilevanti che li riguardano, senza richiedere il ricorso a email o strumenti esterni.

### Come funziona

Le notifiche vengono create programmaticamente all'interno dei Server Actions quando si verificano eventi significativi. Il componente `NotificationCenter` viene caricato nel layout header della dashboard e mostra un badge con il conteggio delle notifiche non lette.

### Funzionalità implementate

**Tipi di notifica:**
- `task_due`: un task assegnato all'utente sta per scadere.
- `deal_won`: una deal è stata chiusa come vinta.
- `lead_assigned`: un lead è stato assegnato all'utente.
- `email_sent`: una campagna email è stata inviata.
- `system`: notifiche di sistema generiche.

**NotificationCenter:**
- Icona campanella nell'header con badge numerico per le notifiche non lette.
- Dropdown con lista delle notifiche più recenti.
- Click su una notifica segue il link associato (`/dashboard/tasks/123`) e marca la notifica come letta.
- Funzionalità "Segna tutte come lette".

---

## 24. Webhooks

### Ruolo nel sistema

Il modulo Webhooks (`/dashboard/settings/webhooks`) permette di integrare Flux CRM con sistemi esterni inviando notifiche HTTP in tempo reale ogni volta che si verificano eventi specifici nel sistema.

### Come funziona

Ogni volta che un'azione rilevante avviene (es. creazione di un contatto), il Server Action invoca `dispatchWebhook(...)` in modo asincrono. Il sistema recupera tutti i webhook attivi configurati per quell'evento e invia una richiesta HTTP POST all'URL configurato, firmata con HMAC-SHA256.

### Funzionalità implementate

**Configurazione webhook:**
- Nome descrittivo, URL endpoint esterno.
- Selezione degli eventi da monitorare (multi-selezione).
- Secret per la firma HMAC-SHA256 della richiesta (verifica autenticità lato ricevente).
- Toggle attivo/inattivo senza eliminare la configurazione.

**Eventi disponibili:**
- `contact.created`
- `lead.created`, `lead.converted`
- `deal.won`, `deal.lost`, `deal.stage_changed`
- `task.completed`

**Sicurezza:**
- Ogni richiesta include un header `X-Signature` con firma HMAC-SHA256 del payload.
- Il ricevente può verificare la firma usando il secret condiviso per garantire l'autenticità della richiesta.

**Webhook Log:**
- La tabella `webhook_log` registra ogni richiesta inviata con: evento, payload JSON, HTTP status code, risposta ricevuta, timestamp e flag di successo.
- La lista dei log è visibile nell'interfaccia di gestione per diagnosticare problemi di integrazione.

---

## 25. Architettura Multi-Tenant

### Ruolo nel sistema

L'architettura multi-tenant consente a Flux CRM di servire più organizzazioni indipendenti (tenant) sulla stessa installazione, con **completo isolamento dei dati** a livello di database. Ogni tenant opera su un database PostgreSQL separato, identificato dal proprio sottodominio.

### Come funziona

Il routing multi-tenant avviene a livello di middleware Next.js (`src/proxy.ts`). Ogni richiesta in ingresso viene esaminata per estrarre il sottodominio dall'header `Host`. Se il sottodominio corrisponde a un tenant registrato, la richiesta viene instradata verso il database corretto tramite la funzione `getDb()`, che usa `React.cache()` per mantenere il client DB per tutta la durata della richiesta.

### Architettura database

```
Platform DB (DATABASE_URL)
├── tenants         — registry di tutti i tenant
├── tenant_members  — utenti e ruoli per ogni tenant
├── users           — auth centralizzata (NextAuth)
└── ...             — tabelle platform-level

Tenant DB (per ogni tenant, URL cifrato in `tenants.db_url`)
├── contact
├── lead
├── company
├── deal
├── task
├── ticket
└── ...             — tutti i dati del CRM isolati
```

### Componenti chiave

| File | Ruolo |
|---|---|
| `src/proxy.ts` | Middleware: estrae subdomain, rewrite URL, auth guard, rate limit |
| `src/lib/subdomain.ts` | `extractSubdomainFromHost()` — funziona su localhost, Vercel preview e produzione |
| `src/lib/tenant-context.ts` | `getDb()` — restituisce il client DB corretto per la richiesta corrente |
| `src/lib/get-tenant.ts` | `getTenantBySubdomain()` — cache in-memory 5 minuti TTL |
| `src/lib/tenant-db.ts` | `encryptDbUrl()` / `decryptDbUrl()` — AES-256-GCM |
| `src/db/index.ts` | `platformDb` + `createTenantDb()` — pool per tenantId |

### Sicurezza multi-tenant

- **URL database cifrato:** la stringa di connessione al database di ogni tenant è cifrata con AES-256-GCM prima di essere salvata nel platform DB.
- **Verifica membership:** il dashboard layout verifica che l'utente autenticato sia membro del tenant che sta tentando di accedere. Se non è membro, viene reindirizzato a `/unauthorized`.
- **Protezione admin:** le rotte `/admin` su un sottodominio tenant vengono reindirizzate al dominio principale dal middleware.
- **Last owner protection:** non è possibile rimuovere o degradare il ruolo dell'ultimo owner di un tenant.
- **Auto-assegnazione:** alla creazione di un nuovo tenant, il creatore viene automaticamente aggiunto come owner.

### Flusso operativo completo

1. L'admin della piattaforma accede a `/admin/tenants` sul dominio principale.
2. Crea un nuovo tenant specificando nome, sottodominio e URL del database PostgreSQL.
3. Clicca "Migrate DB" → il sistema esegue `pushSchema()` tramite `drizzle-kit/api` per creare tutte le tabelle nel database del tenant.
4. Aggiunge i membri al tenant da `/admin/tenants/[subdomain]`, assegnando il ruolo appropriato.
5. Gli utenti accedono a `tenant1.dominio.com` → visualizzano la landing page del tenant.
6. Al login (autenticazione centralizzata sul platform DB), vengono reindirizzati alla dashboard del tenant.
7. Il dashboard layout verifica la membership e, se valida, tutte le query successive vengono eseguite esclusivamente sul database del tenant.

### Admin UI

- **`/admin/tenants`** — Lista di tutti i tenant: Migrate DB, Copy URL, Delete, link ai Members.
- **`/admin/tenants/[subdomain]`** — Gestione membri: aggiunta per email, cambio ruolo, rimozione.

---

*Documento generato automaticamente dall'analisi del codice sorgente — Flux CRM v1.0, Maggio 2026.*

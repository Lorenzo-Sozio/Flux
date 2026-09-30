# Valutazione di prodotto Flux CRM — settembre 2026

*Flux CRM · analisi di prodotto e roadmap · 26 settembre 2026*

Versione analizzata: **2.2.0** · ramo `main`
Perimetro: 89 pagine, 58 file di azioni server, 63 rotte API, 89 tabelle, 30 migrazioni tenant.

## Stato di avanzamento

*Aggiornato a ogni punto chiuso. Un punto è chiuso quando la suite è verde, `tsc` è pulito,
Biome non segnala nulla sui file toccati e, dove un errore costa, una mutazione dimostra che il
test se ne accorgerebbe.*

| ID | Esito | Verifiche |
|---|---|---|
| F-01 | Registrare un'attività non scrive più al cliente. Tolto l'invio da `createActivity` e la funzione `sendCallInviteEmail`, rimasta senza chiamanti. Invitare un cliente resta l'appuntamento, che lo dice a schermo e porta l'invito iCalendar | `src/actions/activities.test.ts` (3 test), `scripts/mutations/activities.json` 1/1 |
| F-02 | Ogni link a una trattativa o a un contatto apre il record. Oltre ai sette punti del rilievo, altri tre portavano alla board generica: i «Top deal» della home, il record collegato di un task e la notifica di trattativa vinta. Nuova guardia strutturale: ogni link `/dashboard/…?nome=${…}` deve puntare a una rotta che legge `nome` | `src/lib/record-links.test.ts` (3 test), `scripts/mutations/record-links.json` 2/2 |
| F-03 | Le regole delle scritture via API girano nel workspace del chiamante, tramite `runRulesAfterApiWrite` (`runWithTenant` più log dell'errore). Le quattro rotte che le chiamavano fuori dal workspace sono corrette; lead, contatti, aziende e stadio del lead ora le fanno scattare, con lo stato di prima sugli aggiornamenti. **Decisione:** le rotte bulk non le fanno scattare, perché un'importazione è una migrazione e non un evento; lo dicono la specifica OpenAPI e la documentazione API. **Trovato lungo la strada e chiuso:** la rotta singola delle aziende cercava il duplicato con `ilike(nome)` e aggiornava con la stessa condizione, quindi un'azienda chiamata «%» con `onDuplicate: "update"` sovrascriveva tutte le aziende del workspace. Ora il confronto è esatto senza distinzione di maiuscole, come nella rotta bulk, e l'aggiornamento è per id | `src/lib/api-automations.test.ts` (3), `src/app/api/crm/companies/route.test.ts` (4, Postgres reale), 4 test nuovi sulle rotte, 3 di guardia in `public-entry-points.test.ts`; `scripts/mutations/api-automations.json` 6/6 |
| F-04 · F-16 | Le email delle automazioni hanno link che si aprono e segnaposto che si risolvono. Le due copie di `wrapLinksForTracking` (campagne, firmata; automazioni, senza firma) diventano una sola, `trackLinks` in `src/lib/tracking-token.ts`. Un unico costruttore dei dati di merge (`merge-data.ts`), letto da email e webhook: il record piatto e sotto il suo tipo, contatto e azienda collegati, nome completo delle persone; un campo vuoto è testo vuoto, non «null». **Trovato lungo la strada e chiuso:** il titolare era caricato come riga utente intera, quindi `{{owner.password}}` e `{{owner.externalCalendarUrl}}` si risolvevano; ora sono tre colonne. Resta per V2.7: l'email delle automazioni usa ancora la chiave Resend globale invece della configurazione del workspace | `email-service.test.ts` (7, Postgres reale); `scripts/mutations/automation-email.json` 5/5 |
| F-05 | Le richieste di approvazione dei preventivi arrivano a chi può approvare: `membersWith(tenantId, capacità)` legge i membri dal registro di piattaforma e li filtra con `can()`. Nuova capacità `record:manageAny` (admin) al posto di undici confronti `tenantRole !== "admin"`, quattro dei quali escludevano l'owner. **Trovato lungo la strada e chiuso:** la campanella dei nuovi ordini cercava i destinatari con la stessa query. **Correzione al rilievo:** la colonna letta non è la scala di piattaforma, come avevo scritto, ma una copia del ruolo di workspace che il layout aggiorna a ogni visita e che nessuno rimuove; le richieste quindi non andavano «a nessuno», ma a una lista non aggiornata, con ex membri inclusi e promossi esclusi. La correzione resta quella giusta. Tolto il codice morto `roles-client.tsx`. Nuova guardia: nessun confronto di ruolo con admin, editor o viewer, e nessuna ricerca di persone su `users.role` fuori dal pannello di piattaforma | `workspace-members.test.ts` (3), `role-comparisons.test.ts` (3), 1 test in `permissions.test.ts`, test ordini aggiornato; `scripts/mutations/workspace-roles.json` 3/3 |
| F-07 · F-08 | L'import CSV di contatti, aziende e **lead** (la rotta non esisteva) passa da un unico gestore: chiede `record:import`, rifiuta per intero un file che supererebbe il limite di record del piano, usa il limitatore di frequenza della piattaforma per tutti e tre (quello delle aziende stava in memoria, nullo sui Worker). Il pulsante Importa compare solo a chi può importare. **Trovato lungo la strada e chiuso:** l'import scriveva riga per riga, da 2 a 4 istruzioni per riga fino a 5.000 righe contro un budget di 1.000 sottorichieste, quindi sui Worker un file di qualche centinaio di righe si fermava a metà; ora sono tre passaggi con gli stessi validatori dell'API, circa 40 istruzioni per 5.000 righe. Intestazioni camelCase, snake_case o in italiano, `;` o `,`; duplicati senza distinzione di maiuscole anche dentro il file; l'azienda di un contatto riusata o creata una volta sola; righe rifiutate riportate col numero di riga. Documentazione API e Centro assistenza corretti (dicevano che i duplicati venivano aggiornati). Conteggio dei record per il piano in un solo modulo, `record-count.ts`. La procedura guidata con mappatura e anteprima resta V1.5 | `csv-import.test.ts` (9, Postgres reale), `csv-import-route.test.ts` (5); `scripts/mutations/csv-import.json` 7/7 |
| F-06 | Una trattativa in valuta estera conserva il suo valore. `amount` resta in EUR, perché tutte le somme lo leggono così; la nuova colonna `amount_original` (migrazione `0031_the_figure_as_typed`, additiva, applicata da sola al primo uso di ogni workspace) conserva la cifra digitata. Il modulo modifica quella, e il salvataggio la converte una volta sola; la scheda sulla board la mostra nella sua valuta. Le trattative precedenti, senza cifra originale, si modificano in EUR, l'unico valore noto per certo. `createDeal` usa il conteggio unico del piano. **Correzione al rilievo:** i totali di colonna della board sommano `amount`, cioè EUR, e sono corretti. `migration-0030-upgrade.test.ts` presupponeva che la 0030 fosse l'ultima migrazione; ora simula correttamente un workspace fermo alla 0029 | `deal-amount.test.ts` (7), `pipeline-amount.test.ts` (3, Postgres reale); `scripts/mutations/deal-amount.json` 5/5 |
| F-09 | Registrarsi non porta più a un vicolo cieco. L'account nasce come prima, ma è trattato come una **richiesta di workspace**: il personale Flux riceve un'email (una per persona) con il link al pannello, sia per la registrazione via email sia per il primo accesso con Google (evento `createUser`). La pagina di chi non ha ancora un workspace, prima in inglese e senza tema scuro, ora è tradotta e spiega i due casi reali, cioè l'invito da aprire o la richiesta già arrivata a Flux, e ha il pulsante Esci. Tradotta anche la scelta del workspace, con il ruolo per nome. La verifica delle traduzioni ora legge anche `select-tenant`. La prova autonoma vera resta la decisione D-C | `platform-staff.test.ts` (3), `auth-register.test.ts` (2); `scripts/mutations/signup.json` 2/2 |
| F-10 | Le regole programmate non vengono più offerte finché nessuno le esegue. Eliminato lo scheduler node-cron (`scheduler.ts`), che leggeva le regole all'avvio fuori da ogni workspace e dove scattava inviava `onCreate` fino a mille record; `instrumentation.ts` non lo avvia più. Il costruttore non offre più l'orario, e per una regola che ne ha già uno mostra un avviso con il pulsante per toglierlo al posto della scritta verde «Pianificata ogni giorno alle…». L'elenco dice «Pianificazione non attiva». Aggiornato il `CLAUDE.md`. Le regole a orario tornano in V2.7 | `scheduled-rules.test.ts` (3, strutturale) |
| F-11 | La scheda Attività dei report, il dato principale e l'esportazione CSV leggono le attività registrate (chiamate, riunioni, email, note) per persona, tipo e giorno, datate dal giorno dell'attività. Leggevano `user_activity_log`, che nessuno scrive. La scheda Registro audit è stata tolta: non esiste un registro da mostrare, e lo storico delle modifiche è V1.7. Eliminato `activity-logger.ts`, senza chiamanti. Etichette e documentazione API aggiornate | `reports-activity.test.ts` (4, Postgres reale); `scripts/mutations/reports-activity.json` 3/3 |
| F-12 | L'email inviata dalla scheda si registra sul record giusto. Il modale deduceva il tipo dal nome d'azienda; ora ha una prop esplicita `entityType` (flux-b7 la passerà dalle pagine che sta ridisegnando) e, se manca, riconosce il lead da `isConverted` (`src/lib/email-log-target.ts`). Se la registrazione fallisce dopo un invio riuscito, l'azione non dice più che l'invio è fallito, che era la spinta a rimandarla | `email-log-target.test.ts` (3), `email.test.ts` (1) |
| F-13 | Il sollecito di un preventivo già aperto parte e si registra come «sollecitato», senza errore. `decideQuoteSend` decide prima dell'invio: primo invio, sollecito (se inviato o aperto, lo stato resta) o rifiuto (stati che non possono diventare «inviato», o bozza oltre la soglia di approvazione). **Trovato lungo la strada e chiuso:** l'esito di `sendEmail` non veniva controllato, quindi un preventivo la cui email non era partita risultava inviato; e una bozza da approvare partiva prima di essere rifiutata | `quote-send.test.ts` (5), `quotes-send.test.ts` (3); `scripts/mutations/send-from-record.json` 5/5, con F-12 |
| F-14 | L'eliminazione in blocco chiede conferma, dicendo quanti record verranno eliminati e che attività, task e note li seguono. Il cestino di 30 giorni resta in §13 | `bulk-action-bar.test.ts` (2, strutturale) |
| F-15 | Il webhook di una regola raggiunge solo indirizzi che un webhook delle impostazioni potrebbe raggiungere: l'URL è validato **dopo** la sostituzione dei segnaposto e non si seguono i reindirizzamenti, né qui né nei webhook delle impostazioni. Creare, modificare, attivare, eliminare e installare regole richiede `automation:manage` (admin); leggerle resta aperto. **Trovato lungo la strada e chiuso:** il validatore condiviso accettava `localhost` anche in produzione | `webhook-validator.test.ts` (3), `webhook-service.test.ts` (3), `automation-guards.test.ts` (6); `scripts/mutations/rule-webhooks.json` 4/4 |
| F-17 · §3.5 · §3.7 | **Notifiche.** Completare un task avvisa titolare e assegnatario, mai chi l'ha completato, con un tipo proprio (`task_completed`, push spento di default) e il link al task. Le notifiche che il prodotto scrive da sé non sono più frasi inglesi nel codice: la riga conserva chiave e valori (migrazione `0032_in_the_readers_language`), la campanella le compone nella lingua di chi legge, e il testo salvato resta come riserva per il push e per le righe vecchie. Venti punti di scrittura convertiti; la nota di completamento nel timeline è neutra rispetto alla lingua. **Correzione al rilievo:** i promemoria delle attività partivano, ma la finestra di due minuti, pensata per un job ogni minuto, ne perdeva circa quattro su cinque da quando il job gira ogni dieci; ora la finestra copre lo schedule reale ed è verificata contro `custom-worker.ts`. **Trovato lungo la strada e chiuso:** le due funzioni che il job usa per trovare le attività erano azioni server esportate senza alcun controllo; ora vivono in `src/lib/activity-reminders.ts`. Il test sui segnaposto delle traduzioni ora usa il parser ICU: la regex prendeva le parole dei rami `select` per argomenti. Resta per dopo: le email di sistema (promemoria dei task, inviti) sono ancora in inglese | `notification-text.test.ts` (5), `tasks-complete.test.ts` (3, Postgres reale), `activity-reminders.test.ts` (3, Postgres reale); `scripts/mutations/notifications.json` 4/4, `activity-reminders.json` 2/2 |
| V0.13 | **Funzioni facoltative per workspace (decisione D-F, applicata con la raccomandazione).** «Progetti» (Gantt e carico di lavoro) e «Chat interna» si accendono e spengono in Impostazioni → Funzioni (solo admin). Spente, spariscono dal menu, le pagine rimandano indietro e il widget della chat non viene montato, quindi smette di interrogare il server. Un workspace esistente le tiene accese finché nessuno le spegne; uno nuovo nasce con entrambe spente. I valori stanno in una nuova tabella del workspace, `workspace_setting` (migrazione `0033_what_this_workspace_uses`), e non in `tenants.settings`, che il pannello di piattaforma riscrive per intero. Tolto il codice morto: `crm.config.ts`, `account-switcher.tsx`, `leads/actions.ts` (azioni duplicate senza guardie), `card-overview.tsx`, la pagina `coming-soon`. I campi da gestione progetti nel modulo dei task restano per V1.2, che lo ridisegna | `workspace-features.test.ts` (8, Postgres reale); `scripts/mutations/workspace-features.json` 4/4 |
| **V1.1** | **Un numero per ogni domanda** (§2). Un modulo, `src/lib/metrics.ts`, usato da Report, Finanza, home e previsione:<br>• vincite e perdite datate da `closedAt`, mai da `updatedAt`;<br>• tasso di vincita come vinte sulle chiuse dello stesso periodo, «—» se non se n'è chiusa nessuna;<br>• valore vinto senza sommarci gli ordini (la stessa vendita due volte), e il grafico di Finanza non impila più trattative e ordini;<br>• preventivi convertiti in EUR al loro cambio, ordini esteri al cambio del preventivo d'origine; quelli senza cambio noto vengono contati a parte e dichiarati, mai sommati come euro;<br>• un solo elenco di stati per i ticket aperti (`src/lib/ticket-states.ts`), `new` compreso;<br>• pipeline ponderata con la probabilità della fase ovunque;<br>• «oggi» e «questo mese» sul fuso del workspace (`src/lib/workspace-day.ts`) nella home, nei report, in Finanza e nei job dei promemoria, e il raggruppamento mensile in SQL sul mese del workspace.<br><br>La previsione confronta l'obiettivo del mese con quanto già vinto più il confermato del mese (prima divideva sei mesi di impegni per un mese di obiettivo) e mostra, come lavoro da fare, le trattative senza data o con la data passata. La panoramica del supporto legge l'SLA dai timestamp di violazione del motore, conta anche i ticket chiusi fra i risolti e mostra il nome del contatto. Tolti il grafico «ricavo per fase (vinte)» e le «fonti di ricavo»; la home mostra gli importi nella valuta dell'utente. Restano per V2.9: scheda per commerciale, approfondimento dai grafici, costruttore di report | `metrics.test.ts` (8, Postgres reale), `workspace-day.test.ts` (5); `scripts/mutations/metrics.json` 8/8 |
| **V3.8** | **Più pipeline** (Fase 3).<br>• In **Impostazioni → Pipeline** le pipeline sono schede sopra le loro fasi: nuova (parte con le fasi consuete, Vinta e Persa comprese), rinomina, elimina — non la prima, e non una con trattative dentro. Migrazione `0044_more_than_one_way_to_sell`: tutte le fasi esistenti finiscono nella pipeline predefinita, quindi per chi ne ha una sola non cambia nulla e il selettore non compare.<br>• Una trattativa non ha una colonna «pipeline»: sta nella pipeline della sua fase. Spostarla in un'altra pipeline è sceglierne una fase; nel modulo e nel costruttore delle regole le fasi si leggono «Pipeline · Fase» quando le pipeline sono più d'una.<br>• **Le colonne Vinta e Persa sono di ogni pipeline**: la board, «segna persa», la conversione del preventivo in ordine e `/api/crm/close` chiudono nella colonna della pipeline della trattativa, non nella prima del workspace. Anche la regola «una Vinta e una Persa» vale per pipeline.<br>• **Board, previsione, vinte/perse e report** si leggono per pipeline (`pipeline=` nell'indirizzo, che segue le schede); la board accetta anche «tutte», con le colonne di ogni pipeline affiancate ed etichettate, ed è lì che portano i numeri che contano tutto il workspace (scheda per commerciale, home).<br>• Resta: obiettivi e territori per pipeline, pipeline predefinita diversa per persona | `pipeline-close.test.ts` (+5, Postgres reale); `scripts/mutations/pipelines.json` 8/8 |
| **V3.9** | **Sequenze: attività, giorni lavorativi, un'unica conversazione** (Fase 3).<br>• Un passo è un'email **o un'attività** per il titolare dell'iscrizione — una chiamata, un messaggio su LinkedIn — creata sulla scheda con scadenza quel giorno, con tipo, titolo e nota (i segnaposto valgono anche lì).<br>• La sequenza può contare **solo i giorni lavorativi** e inviare **solo in una fascia oraria**, sull'orario dello spazio di lavoro: un passo che cade fuori attende l'apertura successiva, e le 10 restano le 10 anche al cambio dell'ora. Migrazione `0045_one_conversation`.<br>• **Risposta nello stesso thread**: la prima email porta un `Message-ID` scelto da noi, registrato insieme alla presa in carico del passo; un passo successivo marcato come risposta parte come «Re: <primo oggetto>» con `In-Reply-To`/`References`, e non ha bisogno di un oggetto proprio. Una risposta senza thread registrato (iscrizioni precedenti) prende l'oggetto della prima email invece di partire senza.<br>• L'orario lo legge il runner dal database che riceve, non da `getDb()`, che in un job pianificato non ha una richiesta da cui ricavarlo.<br>• Trovato strada facendo: il controllo delle specifiche di mutazione, girando dentro la suite, **faceva risultare catturata ogni mutazione** (un file mutato non contiene più il suo `find`). Ora si fa da parte durante una corsa (`FLUX_MUTATION_RUN=1`) e tutte le specifiche sono state riverificate con una mutazione di controllo che deve sopravvivere: su una copia isolata dell'albero, 869 mutazioni prese, nessuna sopravvissuta, nessuna inapplicabile (27 settembre 2026); le specifiche scritte dopo (firma, provvigioni, casella, crediti: 74 mutazioni) sono state verificate una per una, tutte prese.<br>• Da verificare in produzione: che Resend conservi il `Message-ID` fornito (Gmail raggruppa comunque per oggetto) | `sequence-plan.test.ts` (+11), `sequence-runner.test.ts` (+6), `sequence-hooks.test.ts` (+2); `scripts/mutations/sequence-conversation.json` 18/18 |
| **V3.10** | **Assistenza: il lato del cliente e il reparto per persona** (Fase 3).<br>• **Prima i dati**, perché ogni numero nuovo sarebbe stato falso: i ticket nati per email, dal modulo web o da una risposta a un ticket chiuso **non avevano SLA** (il calcolo leggeva il workspace dalla richiesta, che lì non c'è); il trascinamento sulla board era una copia dell'aggiornamento che **saltava il controllo del titolare**, le regole e ora la richiesta di giudizio; una prima risposta in ritardo non veniva mai segnata; un ticket riaperto restava «risolto». Ora c'è una sola regola di stato, e l'email del cliente riapre un ticket risolto.<br>• **Pagina di stato** `/t/<workspace>/<token>`, nella lingua del cliente: stato, conversazione pubblica ripulita (mai le note interne), e il link in fondo a ogni risposta dell'agente, che ora porta un Message-ID nostro.<br>• **Soddisfazione**: attivabile nella pagina SLA (spenta di default: scrive ai clienti). Alla risoluzione il cliente riceve un'email con due pulsanti; la risposta si registra dal browser, non dal link, perché i filtri antispam aprono ogni link. Chiesta una volta per ticket anche con due risoluzioni simultanee; un giudizio negativo arriva a chi ha gestito il ticket. Migrazione `0046_how_did_we_do`.<br>• **Assistenza per agente** (`/dashboard/support/agents`): ricevuti, risolti, aperti ora, mediane di prima risposta e risoluzione, promesse mantenute (al netto delle pause), mancate per priorità, soddisfazione, e il carico settimana per settimana. La panoramica ha di nuovo la soddisfazione — misurata, vuota finché nessuno risponde — e il canale web.<br>• Il selettore di periodo è diventato un componente condiviso con la scheda commerciali.<br>• Resta: entità ticket nel costruttore di report; conferma di ricezione con link di stato per i ticket da modulo web; fusione dei ticket | `ticket-public.test.ts` (13, Postgres reale), `support-metrics.test.ts` (8), `ticket-state-machine.test.ts` (5), `ticket-public-page.test.ts` (4), `ticket-lifecycle.test.ts` (7), `ticket-public-text.test.ts` (2), `api/tickets/public/route.test.ts` (3), `web-forms.test.ts` (+1); `scripts/mutations/ticket-customer.json` 27/27 |
| **L9** | **Chiavi API con permessi, e API di lettura** (dal piano di chiusura, decisione D7).<br>• In **Impostazioni → API** si crea una chiave per ogni integrazione, con un nome e con ciò che può fare, entità per entità: leggere e scrivere contatti, lead, aziende, trattative, ordini; scrivere attività e note, campi personalizzati, opt-out e cancellazioni. **Scrivere non comprende leggere.** Accanto a ogni chiave: chi l'ha creata, quando è stata usata l'ultima volta, le ultime quattro cifre; si revoca con effetto immediato.<br>• Le chiavi stanno nel database del workspace (migrazione `0047_what_a_key_may_do`), non nel registro di piattaforma: quello si migra a mano, e una tabella mancante lì avrebbe rifiutato ogni integrazione. La chiave porta in chiaro il proprio workspace; si conserva solo l'impronta SHA-256.<br>• **Ogni rotta `/api/crm` passa da un unico cancello con il proprio permesso**: 401 per chi non è nessuno, 403 con il nome del permesso che manca. La chiave di prima dei permessi e quella di piattaforma mantengono esattamente ciò che avevano: scrivere tutto, non leggere niente — la lettura non ha regalato il database a ogni vecchia chiave.<br>• **Lettura** (`GET`) di contatti, lead, aziende, trattative (con il nome della fase) e ordini: una pagina alla volta per data di modifica, con `cursor` e `updatedSince` per riconciliare; campi elencati uno per uno, mai la riga intera. Con la sessione vale il ruolo: chi è in sola lettura legge anche dall'API, e continua a non scrivere.<br>• Centro assistenza e documentazione aggiornati; la vecchia frase «scrivere, non leggere» non è più vera | `api-import-auth.test.ts` (+8), `api-keys.test.ts` (7, Postgres reale), `api-read.test.ts` (7, Postgres reale), `tenant-api-key.test.ts` (3), `api-scopes.inventory.test.ts` (25); `scripts/mutations/api-scopes.json` 11/11, `api-import-auth.json` 6/6 |
| **V3.11** | **Integrazioni: documentazione pubblica da una fonte, catalogo degli eventi, agganci per Zapier e Make** (Fase 3).<br>• **Una fonte sola per l'API pubblica** (`src/lib/api-docs/public-api.ts`): la pagina interna `/admin/api-docs`, la nuova pagina pubblica **`/developers`** — chi riceve una chiave finalmente può leggere cosa fa — e **`/api/openapi.json`** leggono le stesse voci. La specifica inglese che descriveva una seconda volta 17 rotte su 23, e diceva ancora che ogni workspace ha un sottodominio, genera ora la sua metà `/api/crm` da lì. La guardia controlla rotta, metodo **e permesso** di ogni voce.<br>• **Catalogo degli eventi** (`src/lib/webhook-events.ts`), letto dal codice e dalla schermata Webhook: la schermata offriva 10 eventi mentre il codice ne mandava 15, e ticket e fatture non ne mandavano. Ora 26: aggiunti aziende, lead modificato, attività, preventivi, ordini per stato, `invoice.issued`, `ticket.created`/`resolved`/`rated`. `dispatchWebhook` accetta solo nomi del catalogo — il compilatore rifiuta il resto — e un test verifica che ogni evento offerto parta davvero da qualche parte.<br>• **Trovato strada facendo e chiuso — sicurezza:** `dispatchWebhook` stava in un file di Server Actions, quindi era un endpoint chiamabile da qualunque browser autenticato: anche un utente in sola lettura poteva inviare a ogni integrazione un evento qualsiasi, **firmato con il segreto del workspace** (un `invoice.issued` al gestionale, un `deal.won` alle provvigioni). Spostato in `src/lib/webhook-dispatch.ts`, con un test che impedisce di riportarlo in un file `"use server"`. Anche il proprietario di un webhook creato da schermata ora è chi lo salva, non un campo del modulo.<br>• **Zapier e Make**: iscrizione e disiscrizione agli eventi (`POST`/`DELETE /api/crm/webhooks`, permesso `webhooks:write`, al massimo 50), consegne firmate come le altre; una chiave rimuove solo ciò che una chiave ha creato. Con le letture di L9 e le rotte di scrittura c'è tutto ciò che un'app Zapier o Make chiama.<br>• Resta, e non si fa da qui: **pubblicare** l'app su Zapier e su Make richiede un account presso di loro e la loro revisione | `to-openapi.test.ts` (4), `webhook-events.test.ts` (4), `api/crm/webhooks/route.test.ts` (5, Postgres reale), `docs-alignment.test.ts` (+2), `ticket-public-page.test.ts` (+2 verifiche); `scripts/mutations/integrations.json` 6/6, `webhooks.json` 8/8 |
| **V3.1** | **Flux per l'assistente** (Fase 3, decisione D-A: nessun modello in Flux; l'intelligenza è VoipAI).<br>• **F1 · Chi ha scritto**: ogni evento porta `origin.key` (id e nome della chiave). VoipAI scartava ogni evento `via: "api"`, quindi anche quelli di qualunque altra integrazione; ora può scartare solo i propri.<br>• **F2 · Opt-out nei due sensi**: nuovo evento `consent.withdrawn`, dal link di disiscrizione, da `/api/crm/opt-out` e dalla scheda, con il recapito in cima. Dal link e dall'API parte anche se qui il consenso era già negato: prima una disiscrizione fatta in Flux non fermava VoipAI.<br>• **F3 · «Seguito dall'assistente»**: `POST /api/crm/assistant` segna ogni record di una persona (migrazione `0048_the_assistant_has_them`); la scheda lo mostra con il nome della chiave, le sequenze non la iscrivono e si fermano, le campagne la saltano. Prima la stessa persona poteva ricevere i solleciti di entrambi.<br>• **F4 · Lavorare come l'azienda**: `GET /api/crm/pipelines` (fasi con il loro tipo) e `GET /api/crm/products?companyId=` (prezzo del cliente, stessa regola del modulo del commerciale; il caricamento del listino è ora una libreria sola per dashboard e API).<br>• **F5 · Bozza di preventivo** `POST /api/crm/quotes`: «il modello dice le voci, il codice dice i prezzi». Ogni riga nomina un prodotto, Flux calcola prezzo e IVA; una riga senza prodotto è rifiutata. Resta bozza del titolare della trattativa, che riceve una notifica; nella cronologia «proposto come bozza dall'assistente».<br>• **Trovato strada facendo e chiuso — sicurezza:** i poteri delle chiavi precedenti ai permessi erano calcolati da tutte le entità, quindi avevano ricevuto in silenzio `webhooks:write` (introdotto in V3.11): con un'iscrizione a tutti gli eventi una chiave che non poteva leggere riceveva ogni contatto creato. Ora sono scritti per esteso e fissati da un test.<br>• **Lato VoipAI** (fuori da questo repository): chiave `flx2.` dedicata con i soli permessi che usa; iscrizione agli eventi con `POST /api/crm/webhooks`; filtro su `origin.key.id` invece che su `via`; ascoltare `consent.withdrawn` e `lead.created` (i lead dei moduli `/f/`); chiamare `/api/crm/assistant` all'apertura e alla chiusura di una pratica; fasi dalla lettura delle pipeline invece di `qualified` scritto nel codice; `Idempotency-Key` su `/leads`, `/notes`, `/orders`, `/quotes`.<br>• Resta: l'abbinamento dei numeri confronta le cifre con il prefisso (`+39 333…` e `333…` sono persone diverse per opt-out, erasure e segno dell'assistente) | `consent-events.test.ts` (5), `api/crm/assistant/route.test.ts` (4), `api-read-route.test.ts` (4), `api/crm/quotes/route.test.ts` (4), `sequence-*` (+2), `api-import-auth.test.ts` (+2), `api-keys.test.ts` (+1), `opt-out/route.test.ts` (+2), `leads/route.test.ts` (origine con la chiave); `scripts/mutations/assistant.json` 20/20, `webhooks.json` 10/10, `api-scopes.json` 11/11, `price-list.json` 15/15 |
| **V3.7** | **Storia delle fasi, velocità, soglie di ristagno** (§6.5).<br>• La storia delle fasi è la cronologia dei campi (V1.7): ogni spostamento di una trattativa la scrive già, quindi nessuna tabella nuova. La prima permanenza parte dalla creazione.<br>• **Report della pipeline**: «giorni nella fase» è ora il tempo passato nella fase dalle trattative che ne sono uscite — prima era l'**età** della trattativa, così una trattativa di un anno spostata ieri in «Proposta» contava un anno di proposta. Nuove colonne **Avanzano** (quante, uscite dalla fase, sono passate a una fase successiva o sono state vinte) e **Ferme**; nuova carta **Velocità di vendita** (aperte × valore medio vinto × tasso di vincita ÷ giorni medi per vincere, al giorno), con «—» quando non si può calcolare.<br>• **Soglia di ristagno per fase** nelle impostazioni della pipeline (solo fasi aperte, migrazione `0043_how_long_is_too_long`): oltre la soglia la carta sulla board dice «Ferma: N giorni in questa fase» in ambra, e il report la conta.<br>• **Trovato lungo la strada e chiuso:** `/api/crm/close` segnava la trattativa persa lasciandola nella colonna aperta (persa nel report, lavoro aperto sulla board) e non scriveva la storia; ora la sposta nella fase Persa, ricorda in che fase è stata persa e registra il cambio.<br>• Resta: conversione tra fasi nel tempo (andamento), soglie diverse per titolare | `stage-history.test.ts` (8), `pipeline-close.test.ts` (+3, Postgres reale), `api/crm/close/route.test.ts` aggiornato; `scripts/mutations/stage-history.json` 10/10, `close-deal.json` 8/8 |
| **V3.6** | **Moduli web per lead e per ticket** (Fase 3).<br>• In **Impostazioni → Moduli**, per gli admin: un modulo di contatto e uno di assistenza, da aprire o chiudere e assegnare a una persona; per ognuno la pagina ospitata `/f/<workspace>/<codice>`, il codice per incorporarla nel proprio sito e l'indirizzo per un modulo proprio (JSON o normale modulo HTML, con `redirect` facoltativo).<br>• **Contatto**: crea un lead della persona indicata (origine «web_form»), con il messaggio sulla sua cronologia e la notifica al titolare. **Chi è già un contatto o un lead aperto non diventa un doppione**: il messaggio va sulla sua scheda. Il consenso marketing è solo quello spuntato, registrato con fonte «modulo web» e data.<br>• **Assistenza**: apre un ticket numerato sul canale «web» (nuovo filtro nella lista), trovando o creando il contatto; il testo del visitatore è reso sicuro prima di diventare un messaggio. Entrambi attivano le regole di automazione come ogni altro record.<br>• **Protezione**: Cloudflare Turnstile se configurato (`TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`), un campo nascosto per i robot, cinque invii al minuto per indirizzo; `redirect` solo verso http(s) e solo a invio riuscito. Le pagine `/b/` e `/f/` possono essere incorporate in un sito esterno; tutte le altre restano non incorniciabili.<br>• Lungo la strada: la numerazione dei ticket e la risoluzione del workspace da sottodominio sono diventate moduli condivisi, e la documentazione API include i due nuovi endpoint pubblici.<br>• Resta: campi personalizzati nel modulo, pagina di stato del ticket per il cliente (V3.10) | `web-forms.test.ts` (8, Postgres reale), `api/forms/route.test.ts` (5); `scripts/mutations/web-forms.json` 10/10 |
| **V3.5** | **Link di prenotazione pubblico** (Fase 3).<br>• Nel **Profilo**, per chi può scrivere, una pagina di prenotazione personale da aprire o chiudere: nome dell'incontro, durata (15–60 minuti), con quanto anticipo (7–60 giorni), orari, giorni della settimana, margine tra un incontro e l'altro; link da copiare. Indirizzo `/b/<workspace>/<codice>`, non indicizzato.<br>• La pagina offre solo gli orari **liberi nel calendario della persona** — la stessa lettura del selettore di disponibilità, ricorrenze e inviti non rifiutati compresi — sul fuso del workspace, dichiarato accanto agli orari, e mai con meno di due ore di preavviso.<br>• Prenotando, l'appuntamento entra nel calendario, chi prenota riceve l'invito con il file di calendario e viene archiviato come il contatto o il lead che è, oppure come nuovo lead della persona, senza consenso marketing. La persona riceve una notifica, anche push (nuovo tipo acceso di default).<br>• **Un orario mai offerto è rifiutato**, e **due visitatori sullo stesso orario** ottengono un solo appuntamento: decide un indice unico, non una lettura prima della scrittura (migrazione `0041_book_a_time`). La richiesta è limitata a cinque al minuto per indirizzo e un campo nascosto ferma i robot senza dirglielo.<br>• Per riusarli senza copie, la lettura degli impegni è passata in `src/lib/availability.ts` e l'invio degli inviti in `src/lib/appointment-invites.ts`: esportato dal file delle azioni sarebbe diventato un endpoint pubblico.<br>• Resta: annullare o spostare dal link dell'invito, più tipi di incontro per persona, pagina di squadra | `booking.test.ts` (10, Postgres reale), `api/booking/route.test.ts` (4); `scripts/mutations/booking.json` 10/10 |
| **V2.12** | **Menu per ruolo, palette che naviga, ricerca senza accenti** (§4.1, §4.3, §4.4).<br>• **Menu per ruolo**: chi non gestisce il workspace vede il lavoro del giorno; catalogo e listini, contratti, fatture, campagne, automazioni, contributo dell'assistente e le sei viste d'analisi della pipeline (che restano schede in cima alla sezione Pipeline) passano dietro «Mostra tutte le sezioni», ricordato nel browser, nella barra laterale e nel menu del telefono. Non è un permesso: la palette le trova sempre. Chi gestisce il workspace vede tutto come prima.<br>• **Trovato lungo la strada e chiuso:** la voce Finanza non aveva guardia, quindi ogni editor la vedeva e al clic veniva rimandato indietro; ora richiede `settings:manage` come la pagina.<br>• **La palette naviga**: «vai a …» per ogni sezione che il menu filtrato concede, generato dal menu stesso e non da un secondo elenco; le sezioni bloccate dal piano non ci sono, quelle secondarie sì. «calendario», «previsione», «oggi» portano dove ci si aspetta.<br>• **Ricerca senza accenti**: «Nicolo» trova «Nicolò», «elise» trova «ÉLISE», nella ricerca globale, nelle caselle di ricerca delle liste, nel controllo duplicati sui nomi e negli operatori testuali del filtro; i contatti si trovano anche con il nome della loro azienda. Con `translate()` e non con l'estensione `unaccent`, che un Postgres gestito può rifiutare di creare.<br>• Resta: tolleranza agli errori di battitura (`pg_trgm`), riallineamento degli URL (§4.2) quando si tocca ciascuna sezione | `find-anything.test.ts` (7, Postgres reale), `filter-nav.test.ts` (+3); `scripts/mutations/find-anything.json` 8/8 |
| **V2.11** | **GDPR dalla scheda: esporta e cancella, e il consenso con la sua fonte** (§13.8).<br>• Sulla scheda di contatti e lead, per gli admin (`privacy:manage`), una scheda **Privacy**: «Esporta i suoi dati» scarica un unico JSON con tutto ciò che il workspace tiene della persona raggiungibile a quell'indirizzo o numero (schede, attività, task, ticket e messaggi, presenze agli appuntamenti, email inviate, visualizzazioni dei preventivi, storia dei campi, consenso, lista di esclusione; trattative e preventivi solo come collegamento). «Cancella questa persona» usa il motore dell'API, mostra prima quanti lead e contatti raggiunge, chiede di scrivere l'indirizzo per confermare e dice cosa resta e perché.<br>• **Trovato lungo la strada e chiuso:** la cancellazione lasciava la storia dei campi (V1.7), senza chiave esterna verso la scheda, con i vecchi indirizzi in chiaro; ora la elimina.<br>• **Consenso con fonte e storia**: la data è quella dell'ultima decisione, concessione o revoca, e accanto c'è la fonte (modulo, importazione, API, disiscrizione, conversione; migrazione `0040_why_they_said_yes`). Il cambio di consenso entra nella storia della scheda, anche quando lo fa la persona con il link di disiscrizione. Prima la revoca lasciava in vista la data della concessione. La scheda mostra «dal 12 set 2026 · da un'importazione» o «revocato il …».<br>• **Trovato lungo la strada e chiuso:** quindici mutazioni in `scripts/mutations/` non trovavano più la riga da rompere (codice riscritto o riformattato), quindi non provavano nulla; riallineate, verificate una per una, e un test nel `npm test` ora lo segnala appena succede. Tra queste c'era la guardia che impedisce a un editor di accendere o spegnere funzioni per tutto il workspace, che il test controllava in un file ormai con sette guardie uguali.<br>• Resta: finalità del consenso oltre al marketing, politica di conservazione | `privacy.test.ts` (9, Postgres reale), `mutation-specs.test.ts` (2); `scripts/mutations/privacy.json` 11/11, dieci spec riparate tutte verdi |
| **V2.10** | **Primo avvio guidato con dati d'esempio** (§13.2).<br>• In home, per chi gestisce il workspace, **cinque passi spuntati dai dati** e non a mano: dati dell'azienda (ragione sociale o partita IVA del profilo di fatturazione, oppure un logo), squadra (un altro membro o un invito in sospeso), contatti (un contatto o un'azienda che non sia d'esempio), fasi (modificate dopo la creazione, oppure «vanno bene così»), posta (un account di invio configurato, non l'indirizzo segnaposto, oppure un'email già archiviata in Ccn). Ogni passo porta alla pagina dove si fa. Si nasconde quando è tutto fatto o se qualcuno la chiude.<br>• **Carica / rimuovi dati d'esempio**: tre aziende, cinque contatti, tre lead, sei trattative (una vinta nel mese e una persa), attività e task (uno oggi, uno in ritardo), nella lingua di chi li carica. Solo in un workspace senza trattative né contatti suoi; indirizzi `example.com`, nessun consenso marketing, inseriti senza passare dalle azioni, così nessuna automazione, sequenza o campagna parte per dati che nessuno ha scritto. Riconosciuti solo dal prefisso dell'id: la rimozione non tocca nient'altro, e la conferma dice quante note o task aggiunti ai record d'esempio se ne andranno con loro. Finché ci sono, la scheda resta visibile.<br>• Resta: «richiedi un workspace» per la registrazione autonoma (§13.1) | `onboarding.test.ts` (11, Postgres reale); `scripts/mutations/onboarding.json` 10/10 |
| **V2.9** | **Scheda per commerciale, numeri che si aprono, report puliti** (§11.1–11.3).<br>• **Report → Per commerciale**: per mese, trimestre o anno, una riga per persona con vinto contro obiettivo, copertura (aperto ÷ obiettivo residuo), tasso di vincita, valore medio, ciclo, aperte, chiamate / incontri / email. Anche chi nel periodo non ha numeri; chi ha lasciato il workspace solo se ne ha. Stessi numeri delle pagine Pipeline (`closedAt`, euro, vinte sulle decise). Cinque istruzioni raggruppate.<br>• Obiettivi: quello scritto per il periodo vince, altrimenti la somma delle parti (il trimestre dai mesi, l'anno dai trimestri); la squadra si misura solo su chi un obiettivo ce l'ha.<br>• **Ogni importo apre le trattative che conta**: la board accetta `closed=2026-09` (o `2026-Q3`, `2026`) sul fuso del workspace, mostrato come filtro rimovibile. In home «Vinto questo mese» apre le proprie vinte del mese, «Valore pipeline» le aperte di tutti (prima la board apriva sulle proprie), i preventivi il nuovo filtro «In attesa del cliente», che ora è anche ciò che il numero conta.<br>• **Pulizia**: tolta la scheda Campagne dei report (duplicava il marketing e caricava tutti i log); la scheda Vendite rispetta la persona scelta; le prestazioni dei task passano da tre query per persona a tre in tutto, e «in ritardo» vale per ogni task non completato. La distribuzione in home conta solo le aperte, senza colonne Vinta e Persa. In Finanza tolti tasso di vincita e pipeline per fase (sono della sezione Pipeline), al loro posto gli ordini completati del mese.<br>• **Carico di lavoro**: una regola sola per pagina e pannello del Gantt, che davano risposte diverse; **trovato lungo la strada e chiuso**: la pagina spostava ogni cella di un giorno a Roma (mezzanotte locale letta come data UTC).<br>• Restano: Finanza sulle fatture dopo gli incassi (I9), filtro per squadra, confronto con il periodo precedente, costruttore di report (§11.4), invio programmato (§11.5) | `rep-scorecard.test.ts` (9, Postgres reale), `workload-allocation.test.ts` (7), `pipeline-close.test.ts` (+1), `metrics.test.ts` (+2), `reports-activity.test.ts` (+1); `scripts/mutations/rep-scorecard.json` 18/18 |
| **V2.8** | **Indirizzo in copia nascosta per la posta scritta fuori da Flux** (§9 passo 2).<br>• Ognuno ha il suo indirizzo, `crm+<workspace>.<codice>@<dominio>`, nel **Profilo**, con il pulsante per copiarlo: lo si mette in Ccn scrivendo da Gmail o Outlook e l'email viene archiviata su **ogni contatto e lead aperto** tra mittente, destinatari e copie. Contatto prima del lead con lo stesso indirizzo, come altrove; con l'azienda del contatto.<br>• Non apre ticket, non crea task e non crea contatti provvisori. Se nessun indirizzo corrisponde, chi l'ha inviata riceve una notifica invece di credere che sia stata archiviata.<br>• Un'email del cliente risulta scritta dal cliente, una inviata risulta di chi l'ha archiviata.<br>• **Una volta sola** per email e scheda, anche se il webhook la consegna due volte o la mettono in copia due colleghi: `activity.message_id` con indice unico (migrazione `0039_kept_in_copy`).<br>• **Il codice è la credenziale**: «Nuovo indirizzo» ritira subito il vecchio, e l'archivio funziona solo finché la persona può scrivere nel workspace (un viewer non ne ha uno).<br>• Le due rotte in entrata passano i **destinatari di consegna** (envelope, `Delivered-To`), l'unico posto in cui un indirizzo in Ccn compare.<br>• Serve `INBOUND_BCC_DOMAIN`, un dominio con MX verso il webhook in entrata; senza, il Profilo dice che l'archivio non è disponibile.<br>• Resta: gli allegati dell'email archiviata non vengono salvati | `mail-archive.test.ts` (13, Postgres reale); `scripts/mutations/mail-archive.json` 15/15 |
| **V2.7** | **Automazioni per le vendite** (§8.1–8.3).<br>• Nel costruttore, per le trattative: **fase** e **titolare** per nome (dalle fasi e dalle persone del workspace), **data di chiusura prevista**, **giorni senza attività**; nuovi operatori relativi a oggi: «è nel passato», «entro i prossimi N giorni», «più di N giorni fa».<br>• Nuovo evento **«Ogni mattina, quando valgono le condizioni»**: gira nel job delle 06:00 su tutti i workspace, senza un nuovo trigger cron; una regola scatta al massimo una volta a settimana per record (lo ricorda il suo registro) e al massimo 50 volte per workspace a giro.<br>• **Prova su un record**: condizione per condizione vero o falso, con il valore visto, senza eseguire niente.<br>• **Quota mensile esaurita**: una riga nel registro per regola saltata (una al giorno) e una notifica al giorno a chi gestisce le automazioni, invece di un `console.warn`.<br>• **Email delle automazioni dalla coda del workspace**: `email_job` con la configurazione di Impostazioni → Email, lista di esclusione, link di disiscrizione e copie (migrazione `0038_copied_in`).<br>• Resta: eventi di automazione per preventivi, contratti e fatture | `scheduled-rules.test.ts` (6), `quota-exhausted.test.ts` (4), `email-service.test.ts` (+3); `scripts/mutations/sales-automations.json` 9/9 |
| **V2.6** | **Il ciclo del preventivo** (§7.1–7.5).<br>• Quando il cliente **apre, accetta o rifiuta** dalla pagina del preventivo, il titolare riceve la notifica, anche push (tre nuovi tipi, accesi di default), con il motivo del rifiuto se c'è. Gli eventi erano già nella cronologia (V1.7).<br>• **Esiti presi al telefono**: «Segna accettato / rifiutato» anche da «inviato», non solo da «visto»; il rifiuto chiede il motivo.<br>• **Nuova revisione**: copia preventivo e righe in una bozza alla versione successiva (numero «…-R2», nuovo link pubblico), segna il precedente come **superato** — non più accettabile né inviabile — e apre la bozza da modificare.<br>• **Un solo modulo**: dalla trattativa «Nuovo preventivo» porta al modulo completo con trattativa, azienda e contatto già scelti; il modale che ignorava listini, aliquote e valuta è eliminato.<br>• **Approvazione**: contano anche gli sconti di riga; la soglia (sconto e totale) si imposta in Impostazioni → Generale, nel workspace, e quella del pannello di piattaforma vale finché nessuno la cambia.<br>• Resta a V2.7: eventi di automazione per i documenti | `quote-cycle.test.ts` (9, Postgres reale), `quotes-send.test.ts` aggiornato; `scripts/mutations/quote-cycle.json` 8/8 |
| **V2.5** | **Viste condivise e fissabili, i filtri che mancavano, l'ordinamento dalle colonne** (§4.5), su contatti, aziende e lead.<br>• Nuovi campi di filtro: **titolare** (per nome), **etichette**, **ultima attività** (recente, o ferma da prima di una data) e, sui contatti, **l'azienda del contatto**.<br>• Nelle viste salvate: **condividi con la squadra** e **fissa sopra la lista** per le proprie; quelle condivise dai colleghi compaiono con «Squadra» e si possono applicare, mai modificare. Le viste fissate sono chip sopra la lista, un tocco ciascuna, che vanno a capo sul telefono. Una vista appena salvata ha il suo vero id (prima non si poteva eliminare né condividere fino al ricaricamento).<br>• Le intestazioni di colonna ordinano la lista (prima un clic crescente, poi decrescente), tornando alla prima pagina.<br>• Resta: lo stesso filtro su preventivi, ordini, fatture, ticket e task | `filter-fields.test.ts` (6, Postgres reale); `scripts/mutations/filter-fields.json` 5/5 |
| **V2.4** | **Coda di lavoro** (§3.3).<br>• `/dashboard/queue`, dal pulsante «Lavorali in fila» sulla lista «Ti aspetta»: le stesse righe, nello stesso ordine, una alla volta, con avanzamento «3 di 12».<br>• Per ogni riga, **chi chiamare e come**: il contatto della trattativa (cellulare prima del fisso) o, se manca, il centralino dell'azienda; il lead; la persona dietro una risposta da dare o un ticket. Pulsanti grandi per chiamare (`tel:`) e scrivere (`mailto:`), e «Apri la scheda».<br>• Sotto, **com'è andata**: tipo, esito, nota e prossimo passo con le date rapide; «Salva e avanti» registra il contatto sulla scheda giusta (o completa la risposta da dare) e passa al successivo. «Salta» e «Fra 3 giorni» per andare avanti senza registrare | `work-queue.test.ts` (7, Postgres reale); `scripts/mutations/work-queue.json` 5/5 |
| **V2.3** | **Home «cosa faccio adesso» e riepilogo mattutino** (§3.4, §3.5).<br>• La home si apre su **«Io»**: tre numeri propri in cima — vinto nel mese contro l'obiettivo, trattative senza passo successivo, cose in agenda oggi — poi la lista «Ti aspetta» e l'agenda. I KPI del workspace, i grafici, le trattative migliori, le attività e i lead recenti stanno sotto **«Squadra»**.<br>• Ticket, preventivi, contratti e MRR compaiono solo se il piano ha il modulo.<br>• Il conteggio dei task in sospeso include quelli «in corso», non solo «da fare».<br>• **Riepilogo mattutino**: niente più un'email per ogni task in scadenza; ogni mattina un'unica email con cosa scade oggi, cosa è in ritardo, trattative senza niente in programma, clienti che aspettano risposta, preventivi accettati da trasformare. Solo ai membri, solo a chi ha qualcosa, disattivabile in «Le mie notifiche», nella lingua con cui la persona usa il prodotto, una sola volta al giorno anche se il job gira due volte. Migrazione `0037_good_morning`.<br>• Restano fuori da §3.5: promemoria «N minuti prima» sul task con orario e task ricorrenti | `morning-digest.test.ts` (10, Postgres reale), `repeating-jobs.test.ts` aggiornato; `scripts/mutations/morning-digest.json` 7/7 |
| **V2.2** | **Una lavagna da usare ogni giorno** (§6.4).<br>• Si apre sulle **mie** trattative: senza `owners` nell'indirizzo lo scrive con chi guarda, così la barra dei filtri mostra ciò che è applicato; «tutti» resta `owners=all`.<br>• Senza stato scelto carica **le aperte e le chiuse negli ultimi 30 giorni**, non ogni trattativa mai vinta o persa; scegliendo «vinte» o «perse» le mostra tutte.<br>• La scheda mostra **azienda**, **prossimo passo con la data** o «nessun passo successivo» in rosso, e **giorni nella fase**, contati dall'ultimo cambio di fase nella storia (V1.7) e non dalla creazione.<br>• **Azioni rapide** sempre visibili, anche sul telefono: registra attività, pianifica il prossimo passo, segna vinta, segna persa (che chiede il motivo).<br>• In testa alla colonna, accanto al totale, il **valore ponderato** sulle probabilità | `pipeline-close.test.ts` (+5); `scripts/mutations/board.json` 3/3 |
| **V2.1** | **Passo successivo obbligato e lista che si lavora dove si trova** (§6.3, §3.2).<br>• Nuove regole nella lista «Ti aspetta»: **trattativa aperta senza niente in programma** (una sola riga per trattativa: se è già in ritardo o ferma lo dice quella), **risposta da dare** (il task che V1.4 crea quando un cliente scrive al titolare), **preventivo accettato da trasformare in ordine**; il **punteggio del lead** pesa sull'urgenza del primo contatto.<br>• Ogni riga ha le sue azioni, sempre visibili anche sul telefono: **Pianifica il seguito** (tipo, cosa, domani / 3 giorni / una settimana, ora facoltativa) sul record o sulla trattativa del preventivo; **Risposto**, che apre «Com'è andata?»; **Non oggi / Fra 3 giorni / Fra una settimana**, un rinvio personale (tabella `next_action_snooze`, migrazione `0036_not_today`) che scade da solo.<br>• Sulla lavagna, spostare in un'altra fase aperta una trattativa senza passo successivo chiede subito qual è; non per una trattativa appena vinta o persa.<br>• Di passaggio: un task creato senza titolare ora appartiene a chi lo crea — senza, non compariva nell'agenda di nessuno | `next-actions.test.ts` (11, Postgres reale); `scripts/mutations/next-actions.json` 9/9 |
| **V1.8** | **Profilo e password per tutti** (§13.7).<br>• `/dashboard/profile`, per ogni ruolo, con «Profilo» nel menu account: il proprio nome (sull'account **e** nella copia dei membri di ogni workspace di cui si fa parte, che è quella mostrata accanto a ogni record; un workspace irraggiungibile non blocca gli altri), l'email in sola lettura, il cambio della propria password (prima raggiungibile solo da Utenti, pagina da admin), il collegamento a «Le mie notifiche». Chi accede con Google lo vede spiegato invece di un modulo che fallirebbe.<br>• Il nome nel menu si aggiorna subito: la sessione lo rilegge dall'account su richiesta, e non lo prende mai dal browser.<br>• La verifica in due passaggi resta fuori (taglia M, §13.7) | `profile.test.ts` (5); `scripts/mutations/profile.json` 5/5 |
| **V1.7** | **Un timeline unico e la storia dei campi** (§5.1, §13.6; §5.2 chiuso da flux-b7).<br>• Il timeline di azienda, contatto, trattativa e lead mostra le attività del record **e dei record sotto di lui** (l'azienda vede quelle dei suoi contatti e delle sue trattative, il contatto quelle delle sue trattative), con «su Rinnovo» che rimanda al record d'origine; le **modifiche dei campi**; gli **eventi dei preventivi** (creato, inviato, aperto, accettato…). Ordinato per quando è successo, non per quando è stato scritto; a pagine con «Carica i precedenti», che non tagliano mai a metà le modifiche di un salvataggio; filtri Tutto / Attività / Modifiche / Preventivi che vanno a capo sul telefono.<br>• **Storia dei campi**: tabella `field_change` (migrazione `0035_who_changed_what`), scritta da ogni salvataggio di trattativa (modifica, cambio fase, persa, vinta dalla conversione del preventivo), contatto, azienda e lead: chi, quale campo, da, a. Solo i campi che contano; gli importi confrontati come numeri; fase, titolare, azienda, contatto e listino mostrati per nome. Non fa mai fallire il salvataggio.<br>• Il conteggio della scheda e «ultimo contatto» nell'intestazione vengono dalla stessa fonte del timeline e contano solo ciò che è già successo.<br>• Restano fuori: invii di campagna e sequenza, aperture delle email e appuntamenti nel timeline; «ultimo contatto» come colonna delle liste; data passata, durata ed esito nel modulo rapido | `record-timeline.test.ts` (12, Postgres reale), `field-history.inventory.test.ts` (7), `pipeline-close.test.ts` (+1); `scripts/mutations/record-timeline.json` 10/10 |
| **V1.6** | **Impostazioni → Generale, un indice per tutti, «Elenchi»** (§13.3, §13.9, §7.7).<br>• **Generale** (admin): il **fuso orario del workspace**, che governa calendario, promemoria e date dei report, non sta più dietro Supporto → SLA e il modulo supporto (stessa riga di prima, quindi il fuso già impostato resta; la scheda degli orari lo mostra e rimanda qui, e salvare gli orari non lo tocca più). **Preventivi**: validità in giorni e condizioni standard, copiate in ogni nuovo preventivo (precompilate nel modulo, applicate dal server quando restano vuote) e mai rilette dopo, così cambiarle non riscrive i preventivi inviati. **Logo** PNG o JPEG fino a 512 KB, riconosciuto dai primi byte, salvato nell'archivio documenti e stampato in cima al PDF del preventivo; un'immagine illeggibile viene saltata, non fa fallire il PDF.<br>• **Indice**: aperto a tutti con le schede filtrate per capacità **e per modulo del piano** (fatturazione elettronica e territori con le vendite, macro e SLA con il supporto); aggiunte Generale, Elenchi e «SLA e orari». Nel menu, «Le mie notifiche» per chiunque, accanto all'aiuto: prima ci si arrivava solo dalla campanella.<br>• **Elenchi**: categorie e tipi d'azienda si rinominano, si uniscono (le aziende passano alla voce scelta, in una transazione) e si eliminano; il modulo dell'azienda riusa una voce esistente con altre maiuscole invece di crearne un doppione. I motivi di perdita sono collegati da qui (restano accanto alle fasi, V1.3).<br>• «Fatturazione e Abbonamento» diventa **Abbonamento**, per non stare accanto a «Fatturazione elettronica».<br>• Di passaggio: `getAllUsers` in `crm.ts` non chiedeva nessuna capacità | `workspace-general.test.ts` (16, Postgres reale), `pdf.test.ts` (+3); `scripts/mutations/workspace-general.json` 12/12 |
| **V1.5** | **Importazione guidata** per contatti, aziende e lead (§13.4).<br>• Quattro passi: file (separatore rilevato, `;` dell'Excel italiano compreso) → mappatura colonna per colonna con suggerimenti dai nomi in italiano e inglese e un esempio di valore → cosa fare dei doppioni → anteprima.<br>• L'anteprima è il piano del server eseguito senza scrivere (`dryRun`): quanti record verranno creati, aggiornati, saltati, e le righe con errori con il numero di riga del foglio. Un file oltre il limite del piano lo dice prima.<br>• Doppioni (email per contatti e lead, nome per le aziende, ignorando le maiuscole, anche dentro lo stesso file): **salta** (come prima), **aggiorna** con le sole celle compilate (celle vuote, titolare e fonte non si toccano; l'ultima riga vince) o **crea comunque**.<br>• L'aggiornamento è una sola istruzione per blocco (`jsonb_populate_record`): 5.000 record aggiornati restano sotto le 50 istruzioni, dentro il budget dei Worker.<br>• Per i lead basta uno fra nome, cognome, email e telefono, come vuole il validatore; la procedura lo verifica prima dell'anteprima. Dopo l'importazione la lista si aggiorna da sola.<br>• I campi personalizzati e i predefiniti per HubSpot e Pipedrive restano fuori: vanno con V2 | `csv-import-wizard.test.ts` (12, Postgres reale), `csv-import-route.test.ts` (+4); `scripts/mutations/import-wizard.json` 10/10 |
| **V1.4** | **Le risposte arrivano al titolare, non al supporto** (§9 passo 1).<br>• Una email in entrata senza riferimento a un ticket, da un contatto con titolare (o, senza, dal titolare della sua azienda) o da un lead non convertito con titolare, va sulla cronologia del record e diventa per il titolare un task email «↩ nome: oggetto» in scadenza oggi, con una notifica (`email_reply`, push acceso di default). Niente ticket e niente contatto provvisorio accanto al lead che ha scritto. Il confronto dell'indirizzo ignora le maiuscole.<br>• Restano al supporto: le risposte a un ticket (anche da clienti con titolare), i mittenti senza titolare, gli sconosciuti.<br>• Se la risposta ha già fermato una sequenza, il titolare non riceve un secondo avviso.<br>• Le email mandate dalla scheda portano Reply-To al commerciale **solo** se la posta in entrata non è configurata: con la posta in entrata, la risposta deve tornare all'indirizzo del workspace per essere archiviata e instradata.<br>• La scheda dell'email in cronologia mostra il mittente per quelle ricevute | `inbound-sales-reply.test.ts` (11, Postgres reale, attraverso `processInboundEmail`), `email.test.ts` (+2); `scripts/mutations/inbound-sales-reply.json` 10/10 |
| **V1.2** | **Un gesto per registrare e pianificare** (§3.1, §15; decisione D-E applicata con la raccomandazione).<br>• Il task ha un tipo: chiamata, email, incontro, da fare (quattro pulsanti in cima al modulo, nuovo e modifica); l'orario c'era già.<br>• Completare un task apre **«Com'è andata?»**: esito (raggiunto, non risponde, segreteria; svolto, non si è presentato; inviata), nota e prossimo passo con «domani / tra 3 giorni / tra una settimana» e ora facoltativa. Dopo «non risponde» propone da sé di richiamare. Il salvataggio registra l'attività del tipo giusto con esito e nota, legata al task e intestata a chi l'ha fatta, e crea il task successivo sullo stesso record.<br>• Lo stesso pannello ovunque si completa un task: schede di azienda, contatto, lead e trattativa, lista dei task, agenda della home, calendario e i due elenchi degli scaduti. Il completamento in blocco resta una spunta semplice.<br>• La cronologia mostra l'esito accanto al tipo.<br>• Corretto di passaggio: la lista dei task non si riallineava mai al server, quindi un task creato compariva solo ricaricando la pagina.<br>• Migrazione `0034_how_did_it_go` (`task.type`, `activity.outcome`, `activity.task_id`). Il commento come discussione di squadra e la convergenza di note e campo `notes` restano a V1.7, che ridisegna la cronologia | `tasks-outcome.test.ts` (10, Postgres reale); `scripts/mutations/task-outcome.json` 11/11 |
| **V1.3** | **Una sola chiusura della trattativa** (§6.1, §6.2, §6.7).<br>• Fase e stato si muovono insieme da qualunque porta: una fase vinta o persa chiude, una aperta riapre, «vinta»/«persa» sposta nella colonna, riaprire una persa la riporta dove si era fermata (`reconcileStageAndStatus` in `updateDeal`). Il modulo non ha più il campo stato e propone solo fasi aperte; chiudere è l'azione Vinta/Persa, che chiede il motivo.<br>• Convertire un preventivo in ordine porta la trattativa anche nella colonna vinta.<br>• Impostazioni → Pipeline: ogni fase ha un tipo (aperta, vinta, persa); una sola vinta e una sola persa, e il tipo non cambia se nella fase ci sono trattative (`src/lib/stage-kind.ts`). Eliminare una fase chiede conferma con una finestra vera, non con `confirm()`.<br>• I motivi di perdita hanno finalmente una schermata: aggiungere, rinominare, smettere di proporli (mai cancellarli: le trattative chiuse li conservano).<br>• Il semaforo salvato è sostituito da due segnali calcolati alla lettura, «ferma da N giorni» e «nessun passo successivo», sulla lavagna e nella scheda (`src/lib/deal-signals.ts`). L'elenco delle prossime azioni usa la stessa definizione di «ultimo contatto»: un'attività già avvenuta, non un salvataggio né un incontro futuro. La colonna `health_score` resta perché le migrazioni sono additive, ma niente la scrive o la legge più, e il costruttore di report non la offre | `pipeline-close.test.ts` (18, Postgres reale); `scripts/mutations/deal-close.json` 14/14 |
| §5.2 (parte) | **Chiuso da flux-b7**, l'altra sessione che sta ridisegnando le pagine di dettaglio: la scheda azienda ora elenca le sue persone | — |
| C0 (parte) | **Il livello del modello** (R7). `src/lib/ai/`: un'interfaccia `AiProvider` e un file per fornitore (Gemini per primo, contro il contratto REST pubblicato); modello e fornitore per compito da variabili d'ambiente, con tre stati: spento, configurato male (che lo dice), acceso; `fetch` semplice e nessun SDK; errori nelle parole di Flux e mai con la richiesta dentro; il ragionamento del modello tolto dal testo; risposte JSON sempre verificate; streaming con un lettore SSE che regge gli eventi spezzati tra pacchetti. **Nessuna chiave reale è ancora passata da qui**, e nessuna schermata lo usa: il resto di C0 (piano, interruttore, context builder, `ai_suggestion`) viene dopo | `gemini.test.ts` (12), `client.test.ts` (10); `scripts/mutations/ai-provider.json` 10/10 |
| C0 (parte) | **Il copilota nel piano e nel workspace.** Nel form dei piani (/admin/plans) un flag «AI copilot» (scheda Features) e un limite «AI copilot requests / month» (scheda Limits): il flag è il modulo `ai` in `enabled_modules`, quindi nessuna colonna nuova nel database di piattaforma, che si migra a mano, e i controlli dei moduli valgono anche per lui. Un piano salvato prima di oggi ha 0 richieste, non infinite; il vuoto scelto nel form è illimitato. Interruttore `ai` in Impostazioni → Funzionalità, mostrato solo se il piano lo include. `src/lib/ai/access.ts` controlla fornitore, piano, workspace e richieste del mese (contate prima della chiamata); `runAiTask` / `runAiJsonTask` sono l'unica porta, chiedono `record:write` e registrano ogni chiamata in `ai_suggestion` (migrazione 0069: modello, token, proposta mostrata, mai il prompt), con l'esito deciso una volta da chi l'ha chiesta. L'erasure cancella le proposte sul lead o sul contatto della persona. **Trovato lungo la strada e chiuso:** la prima versione leggeva il limite con `?? 0`, che trasformava «illimitato» in zero richieste; l'ha trovato il test | `access.test.ts` (7), `suggestions.test.ts` (4, PGlite), 1 test in `erasure.test.ts`, test delle funzionalità aggiornati; `scripts/mutations/ai-access.json` 9/9 |
| C0 · C1 · C2 · C3 | **Il contesto del record e le prime tre funzioni del copilota.** `src/lib/ai/context.ts` trasforma deal, contatto, azienda, lead e ticket in un testo per il modello, dalla stessa timeline e dagli stessi campi che la persona vede: stato, fase, valore, persone, task aperti, storia datata sul fuso del workspace. Le email dicono se le ha scritte il cliente o noi; nel ticket i messaggi del cliente, dell'agente e le note interne sono distinti. Tutto dentro `<record>`, dichiarato materiale e non istruzioni. **C2:** card «Riassunto IA» su deal, contatto, azienda, lead (scheda Attività) e ticket (Conversazione), che chiama il modello solo quando si preme il pulsante. **C3:** «Briefing IA» nel pannello dell'appuntamento collegato a un record. **C1:** «Scrivi con l'IA» nella finestra di invio email di contatti, lead e trattative (sulla trattativa la finestra sostituisce il link `mailto:`, scrive al suo contatto, prepara la bozza dall'intera trattativa e registra l'email su entrambi): bozza nuova, o riscrittura del testo già nell'editor; nella lingua del cliente; risposta all'ultima email se l'ha scritta il cliente; al posto di una cifra che il record non ha, «[da completare]»; le cifre della bozza che il record non contiene sono elencate da controllare. Ogni risposta ha «Utile / Non utile»; la bozza registra da sola se è stata inviata così com'era, modificata o scartata. Nulla viene inviato o salvato dal copilota. **Non ancora provato con una chiave reale** | `context.test.ts` (10, PGlite), `tasks.test.ts` (11); `scripts/mutations/ai-copilot.json` 8/8 |
| Finestra email · accesso all'IA | **La finestra «Invia email» rifatta**, per contatti, lead e trattative: destinatario come chip, Cc e Ccn (validati nel browser e sul server con la stessa regola, `email-addresses.ts`), oggetto; una barra con «Scrivi con l'IA» e i modelli; editor di testo vero (variante `email`, campi in un menu) al posto del riquadro modificabile con la scheda HTML; modelli grafici modificati nell'anteprima o in HTML; bozza salvata mentre si scrive e ripristinata alla riapertura; Ctrl+Invio per inviare; errori di invio restituiti e tradotti invece che lanciati (in produzione un errore lanciato non arriva allo schermo). Il pannello IA ha azioni rapide: follow-up, proponi un incontro, ringrazia, rispondi all'ultima email; su un testo già scritto: più breve, più formale, più cordiale, correggi errori. **Il pulsante IA spariva per un motivo che nessuno poteva vedere**: senza `GEMINI_API_KEY` il copilota è spento. Ora un piano senza il flag mostra i controlli disattivati con il motivo; lo staff di Flux li vede anche senza chiave, con l'indicazione di cosa impostare; un cliente di un'installazione senza fornitore non li vede | `email.test.ts` (6), `email-addresses.test.ts` (3), `access.test.ts` (+4); `ai-access.json` 11/11, `send-from-record.json` 7/7 |
| Modelli email commerciali | **I modelli da cui parte un'email a un cliente**, che mancavano: esistevano solo i modelli di campagna in Marketing, creabili solo con il modulo Marketing. Ora «Modelli email» (menu Clienti e Impostazioni) per chiunque scriva ai clienti: nome, categoria (follow-up, offerta, appuntamento, ringraziamento, presentazione, altro), oggetto, testo con i campi del destinatario; privati finché non condivisi con il team; modifica al proprietario, e agli amministratori per quelli condivisi; «Crea i modelli di base» sulla pagina vuota (quattro modelli nella lingua di chi li crea). Nella finestra email un menu con ricerca (i miei, del team, marketing), conferma prima di sostituire un testo già scritto, «Salva come modello», conteggio degli utilizzi che ordina il menu. Stessa tabella dei modelli di campagna con un tipo (`kind`, migrazione 0070); campagne, sequenze e automazioni vedono solo quelli di campagna; la ricerca globale solo quelli di campagna, perché non sa chi cerca | `email-templates.test.ts` (8, PGlite); `scripts/mutations/email-templates.json` 6/6 |
| Modelli di base per tutto il CRM · campi del mittente e della trattativa | **I modelli di base passano da 4 a 25** e coprono tutto ciò che il CRM gestisce: primo contatto, follow-up, nessuna risposta, richiesta/conferma/riepilogo di un incontro, invio/sollecito/scadenza/accettazione di un preventivo, trattativa vinta e persa, conferma e spedizione di un ordine, invio e rinnovo di un contratto, invio fattura, promemoria, sollecito e conferma di pagamento, presa in carico e risoluzione di una richiesta di assistenza, richiesta di recensione, riattivazione, ringraziamento; nuove categorie Trattativa, Ordine, Contratto, Fatture e pagamenti, Assistenza. «Aggiungi modelli di base» aggiunge solo quelli che mancano. **Nuovi campi**: del mittente (`{{mittente}}`, `{{mittente_email}}`, `{{azienda_mittente}}` dalla ragione sociale di fatturazione), compilati dal server all'invio, così ogni modello si firma da solo; della trattativa (`{{trattativa}}`, `{{valore}}`) quando si scrive dalla sua pagina. Le parti che solo la persona conosce sono tra parentesi quadre, e la finestra chiede prima di inviare un'email che ne contiene ancora | `email-template-starters.test.ts` (60: ogni modello nelle due lingue), `email.test.ts` (+1); `email-templates.json` 9/9 |
| Una sola finestra email in tutto il CRM | **Ogni invio di email passa dalla stessa finestra**, con modelli, IA, Cc/Ccn e bozza: oltre a contatti, lead e trattative, ora aziende, preventivi (invio e follow-up), copia di cortesia della fattura, sollecito di pagamento, e ogni indirizzo mostrato in una pagina (coda di lavoro, ordini, richiedente di un ticket), che prima apriva il programma di posta del computer (`mailto:`) e lasciava l'email fuori dalla cronologia. Un solo percorso di invio (`src/lib/email-deliver.ts`) per tutti. Per un documento la finestra si apre sul testo che Flux prepara nella lingua del cliente, l'indirizzo si può cambiare, e le parti del documento (riepilogo e link del preventivo, PDF della fattura) le aggiunge il server sotto il testo: nessuna versione del testo può partire senza. Il server decide ancora: una fattura pagata non si sollecita, qualunque cosa dica il testo. Le fatture partono dal mittente dell'azienda con il PDF; l'email finisce sulla cronologia dell'azienda. L'IA scrive anche a un'azienda. Restano `mailto:` solo per chi non può scrivere e per i partecipanti di un appuntamento, che non hanno un record | `payment-reminder.test.ts` (+4), `email-log-target.test.ts` (+2), `quotes-send.test.ts`; `send-from-record.json` +4 mutazioni (**da eseguire**: il runner non è stato lanciato con il dev server attivo) |

## Com'è stata fatta e cosa non ripete

L'[audit di ottobre](audit-prodotto-2026-10.md) guardava la correttezza: tenant, ruoli, denaro, job
che non partivano. I suoi 66 rilievi sono chiusi, e il [piano di chiusura](piano-di-chiusura.md) ha
aggiunto fatturazione elettronica, contratti, sequenze, listini e territori. Questo documento non li
ripete. Guarda il prodotto dal punto di vista di chi lo usa ogni giorno: il commerciale, il
responsabile vendite, l'amministratore di una PMI.

Sei aree lette in parallelo sul codice:

- anagrafiche;
- pipeline e documenti;
- lavoro quotidiano e mobile;
- automazioni e IA;
- report e supporto;
- amministrazione e coerenza.

Poi le affermazioni più gravi sono state **ricontrollate a mano**. Nella tabella dei difetti,
«verificato» significa che la riga di codice citata è stata letta e dice quello che la tabella
afferma. Gli altri rilievi vengono dalla lettura del codice con il percorso indicato, e vanno
confermati al momento della correzione come si è sempre fatto.

---

## Sintesi

Flux è **largo e solido nelle fondamenta**. L'isolamento tra clienti, la fatturazione elettronica
validata contro lo schema, le sequenze che si fermano alla risposta, il calendario con le ricorrenze
e i test per mutazione sono lavoro che molti CRM commerciali non hanno. Il problema non è la
mancanza di moduli. Sono quattro cose diverse.

**1. Una quindicina di percorsi sembrano funzionare e non funzionano.**
- Registrare una telefonata manda al cliente il testo della nota.
- Un clic su una trattativa dalla lista di lavoro porta a una board generica.
- Le automazioni lanciate dall'API d'importazione si perdono.
- I link nelle email delle automazioni rispondono 400.
- Le richieste di approvazione dei preventivi vanno a una lista di amministratori non aggiornata (vedi F-05).

È la stessa famiglia di guasti dell'audit di ottobre: nessun errore a schermo, solo una cosa che non
succede. Vanno chiusi prima di tutto il resto.

**2. I numeri non sono d'accordo tra loro.**
- Il fatturato vinto è calcolato in sette modi.
- Il tasso di vincita in tre.
- I ticket aperti in tre, e nessuno conta quelli appena arrivati.

Home, Finanza, Report e Pipeline mostrano cifre diverse per la stessa domanda. Importi in valute
diverse vengono sommati, e una trattativa in dollari perde valore ogni volta che la si salva. Un
responsabile vendite che trova due cifre diverse smette di fidarsi di entrambe.

**3. Il prodotto registra più di quanto guidi.**
- Una telefonata con il suo seguito sono tre oggetti: Attività, Task, Commento (è l'esempio della
  [guida commerciale](flux-crm-guida-commerciali.md), §13). Un quarto, l'Appuntamento, serve se c'è
  un orario.
- La lista «prossime azioni» è il pezzo migliore del prodotto, ma ogni riga è solo un link.
- Nessuna trattativa è obbligata ad avere un passo successivo.
- Il semaforo di salute delle trattative dice il contrario del vero: rosso alla nascita, verde dopo
  sessanta giorni di silenzio.
- La posta del cliente non arriva sulla scheda del commerciale: le risposte di un prospect aprono
  un ticket di supporto.

**4. Larghezza a scapito della profondità.** Il menu ha 25 voci principali e 9 secondarie; un
commerciale ne usa sei. Ci sono Gantt con dipendenze FS/SS/FF/SF, matrice del carico, RACI, cronometro,
chat interna in due copie e sette schede di analisi della pipeline. Mancano invece le cose che
decidono se un CRM viene adottato:
- **la posta** (nessun collegamento con Gmail o Outlook, nemmeno un indirizzo in copia nascosta);
- **l'importazione** (niente mappatura delle colonne, i lead non si importano affatto);
- **il primo avvio** (chi si registra finisce in un vicolo cieco);
- **una pagina di impostazioni generali** (il fuso orario si imposta solo dentro l'SLA del
  supporto).

**La direzione consigliata è togliere prima di aggiungere.** Una sola cosa da registrare dopo una
chiamata. Un solo numero per ogni domanda. Una home che dice cosa fare. La posta che si archivia da
sola. Il resto dietro un interruttore.

| | Rilievi |
|---|---|
| Difetti da correggere subito (§1) | 17 |
| Numeri incoerenti (§2) | 8 |
| Lavoro quotidiano e navigazione (§3–4) | 12 |
| Anagrafiche, pipeline, documenti (§5–7) | 22 |
| Automazioni, posta, IA (§8–10) | 8 |
| Report e supporto (§11–12) | 10 |
| Amministrazione, coerenza, mobile (§13–15) | 23 |

---

## Principi per la roadmap

Servono per decidere, non per ornare. Ogni intervento proposto sotto ne rispetta almeno uno, e
nessuno ne viola uno.

1. **Una cosa successa, un gesto.** Registrare, pianificare il seguito e annotare sono un'azione
   sola, non tre moduli.
2. **Ogni schermata risponde a «cosa faccio adesso».** Un numero che non porta a un elenco di
   record su cui agire va spostato nei report.
3. **Un numero, una definizione.** Fatturato, vincite, tasso, aperti: un modulo, letto da ogni
   schermata.
4. **Il CRM si riempie da solo dove può.** Posta, esiti dei preventivi, risposte e scadenze entrano
   senza che nessuno le digiti.
5. **Nascondere prima di cancellare, cancellare prima di duplicare.** Funzioni di nicchia dietro un
   interruttore di modulo; una seconda copia della stessa funzione mai.
6. **L'IA propone, la persona conferma.** Nessuna scrittura automatica nel CRM, nessun testo
   inventato là dove il prodotto non ha la fonte. È la linea che l'audit di ottobre aveva tracciato,
   ed è giusta.

---

## 1. Difetti da correggere subito

Sono tutti del tipo più costoso: l'utente crede che sia successa una cosa che non è successa, o ne
succede una che non voleva.

| # | Difetto | Dove | Effetto | Intervento | |
|---|---|---|---|---|---|
| F-01 | **Registrare una chiamata invia al cliente il testo della nota** | `src/actions/activities.ts:30-56`; il modulo del timeline passa sempre `date: new Date()` | Un appunto interno («sensibile al prezzo, preferisce il concorrente») arriva al contatto o al lead come email «Call scheduled», in inglese | Togliere l'invio da `createActivity`. L'invito resta solo come azione esplicita «pianifica e invita» | verificato |
| F-02 | **I link alla trattativa non aprono la trattativa** | `?deal=` in `next-actions.ts:183,199`, `?dealId=` in `calendar.ts:208`, `leads/[id]/page.tsx:539`, `convert-lead-button.tsx:57`, `lead-modal.tsx:777`; `pipeline/page.tsx` non li legge | La voce più comune della lista di lavoro, «trattativa ferma», lascia l'utente su una board di quaranta schede | Tutti su `entityHref("deal", id)` → `/dashboard/pipeline/[id]`; stesso per `?contactId=` | verificato |
| F-03 | **Le automazioni lanciate dall'API d'importazione si perdono** | `api/crm/{close,opt-out,custom-fields,orders}` chiamano `runAutomations` in `after()` senza `runWithTenant`; `rule-engine.ts:188` chiama `getDb()` fuori dal `try` | Una chiave API non ha `x-tenant-id`: il rifiuto sparisce senza traccia. I POST di creazione e `leads/stage` non chiamano nemmeno le regole, quindi i lead dell'assistente non ricevono titolare, sequenza, punteggio né notifica | `runWithTenant(auth.tenantId, …)` come in `ticket-from-email.ts`; aggiungere le chiamate mancanti; estendere `public-entry-points.test.ts` | verificato |
| F-04 | **I link tracciati nelle email delle automazioni rispondono 400** | `automation/email-service.ts:32` costruisce `/api/track/click` senza `sig`; `api/track/click/route.ts:32` lo rifiuta | Ogni link di ogni email automatica è morto | `signTrackingUrl`, come `campaign-send.ts` | verificato |
| F-05 | **La richiesta di approvazione del preventivo va a una lista sbagliata** | `quotes.ts:537-540` cerca gli approvatori su `users.role` nella tabella utenti del workspace, cioè una copia del ruolo aggiornata solo quando la persona apre la dashboard e mai rimossa quando se ne va (*correzione successiva: nella prima stesura avevo scritto «a nessuno», confondendo questa colonna con la scala di piattaforma*) | Chi è appena stato promosso admin non riceve la richiesta finché non rientra; chi ha lasciato il workspace continua a riceverla. `deleteQuoteAction` e `sendQuoteEmailAction` confrontano `tenantRole !== "admin"`: un owner non può inviare il preventivo di un collega | Membri del workspace con `can(role, "quote:approve")`; `can()` al posto dei confronti | verificato |
| F-06 | **Una trattativa in valuta estera perde valore a ogni salvataggio** | `pipeline.ts:74-80` e `:246-256` convertono in EUR; `deal-modal.tsx:120-121` ripropone l'importo già in EUR con la valuta originale | Una trattativa in USD cala di circa l'8% a ogni modifica. La scheda sulla board mostra la cifra in EUR con il simbolo del dollaro | Salvare l'importo nella valuta della trattativa più il cambio, come fanno i preventivi | verificato |
| F-07 | **Il pulsante Importa dei lead chiama una rotta che non esiste** | `leads/page.tsx:87` → `/api/leads/import`; esiste solo `export/` | Errore a ogni importazione di lead | Rotta vera (vedi §13) o pulsante nascosto fino ad allora | verificato |
| F-08 | **Un viewer può importare CSV** | `api/contacts/import` e `api/companies/import` controllano solo `auth()`; `record:import` è dichiarata in `permissions.ts:68` e mai usata | Contraddice «viewer è in sola lettura ovunque». Salta anche il limite `maxRecords` del piano | `requireCapability("record:import")` più il limite di piano, con la sua mutazione | verificato |
| F-09 | **La registrazione autonoma porta a un vicolo cieco** | `registerAction` crea un utente senza workspace → `/select-tenant`: «No workspaces found… contact an administrator», in inglese, senza tema scuro | Chiunque provi il prodotto da solo si ferma lì | Oggi: nascondere la registrazione o trasformarla in «richiedi un workspace». Poi §13 | verificato |
| F-10 | **Le regole programmate non girano in nessuna installazione** | `automation/scheduler.ts:46` carica le regole una volta all'avvio con `getDb()`; è saltato sui Worker; quando scatta invia `event: "onCreate"` | Il costruttore mostra «Programmata ogni giorno alle…» in verde. Dove scatta, rilancia tutte le regole onCreate su fino a mille record | Nascondere l'opzione subito; ricostruirla su `runCronJob` (§8) | verificato |
| F-11 | **Il registro attività utenti è vuoto per costruzione** | `logActivity()` in `src/lib/activity-logger.ts` non ha chiamanti; lo leggono le schede Attività e Log dei report e l'esportazione CSV | Due schede su cinque dei report e l'unica esportazione dicono «il team non ha fatto niente» | Ricostruire le schede sulla tabella `activities`, o toglierle | verificato |
| F-12 | **L'invio email da un lead senza azienda fallisce dopo aver inviato** | `send-email-modal.tsx` indovina il tipo con `entity.companyName ? leadId : contactId` | L'id del lead finisce in `activity.contact_id`, la chiave esterna rifiuta. L'email è partita, l'utente vede un errore, riprova e la manda due volte | Passare il tipo di entità esplicitamente | |
| F-13 | **Il sollecito di un preventivo aperto fallisce dopo l'invio** | Il sollecito passa per `sendQuoteEmailAction`, che poi chiama `updateQuoteAction({status:"sent"})`; `viewed → sent` non è una transizione ammessa | Il caso più comune, «aperto e senza risposta», manda l'email e mostra un errore | `sendQuoteReminder` che non cambia stato e registra `reminded` | |
| F-14 | **Eliminazione in blocco senza conferma e senza ritorno** | `bulk-action-bar.tsx`, `src/actions/bulk.ts` (cancellazione fisica, trascina attività e task) | Un clic cancella decine di record e la loro storia. Le azioni in blocco saltano webhook e automazioni | Conferma con il numero; cestino di 30 giorni (§13); webhook e regole come per il singolo | |
| F-15 | **L'azione webhook delle regole non passa dal controllo anti-SSRF** | `send_webhook` nel motore non chiama `validateWebhookUrl`; creare una regola chiede solo `record:write` | Un editor può far chiamare alla piattaforma indirizzi interni | Validazione come nei webhook di impostazioni; capacità `automation:manage` | |
| F-16 | **I segnaposto suggeriti nell'email automatica non si risolvono** | Il costruttore suggerisce `{{contact.email}}` e `{{deal.name}}` (`rule-builder.tsx:225,1305,1328`); il servizio appiattisce il record | `{{contact.email}}` resta letterale e l'invio fallisce: «Invalid recipient email after merge» | Contesto con spazi dei nomi come l'azione webhook; test senza il doppio del servizio email | |
| F-17 | **Completare un proprio task notifica sé stessi** | `updateTaskStatus` (`tasks.ts:283-293`) notifica `assigneeId ?? ownerId` con tipo `task_due`, in push, e link al calendario | Rumore su ogni spunta, sul telefono | Notificare solo se chi completa non è il destinatario; tipo proprio, spento di default | |

**Stima:** da uno a due giorni per F-01, F-02, F-04, F-05, F-07, F-08, F-10 (solo nascondere),
F-12, F-13 e F-17. Da tre a cinque per gli altri, con test e mutazioni dove il costo lo richiede
(F-03, F-05, F-06, F-08, F-15).

---

## 2. Un solo numero per ogni domanda

**Il limite.** Home, Report, Finanza, Pipeline, Previsione e Supporto calcolano le stesse
grandezze ciascuno a modo suo. Nessuna cifra è sbagliata in modo evidente, e proprio per questo
nessuno se ne accorge finché due persone non portano due numeri diversi alla stessa riunione.

| Grandezza | Come oggi | Dove |
|---|---|---|
| **Fatturato vinto** | Sette calcoli. Report, Finanza e la scheda obiettivo in home usano `updatedAt` come data della vittoria: una trattativa vinta a marzo e risalvata a settembre conta a settembre. Pipeline, win/loss e territori usano `closedAt` | `reports.ts`, `finance.ts`, `crm/page.tsx:158` contro `pipeline.ts:370,808`, `territory-report-queries.ts:50` |
| **Doppio conteggio** | Finanza e il report vendite sommano le trattative vinte **e** gli ordini completati; convertire un preventivo in ordine segna vinta la trattativa (`orders.ts:597`), quindi la stessa vendita conta due volte. «Fonti di ricavo» la conta tre volte (trattativa, ordine, preventivo accettato). Le fatture emesse non sono lette da nessuna parte | `finance.ts:70-80`, `spending-breakdown.tsx` |
| **Tasso di vincita** | Tre definizioni: vinte / *create* nel periodo (può superare il 100%); vinte / (vinte + perse) su `closedAt`; lo stesso su `updatedAt` e 90 giorni fissi | `reports.ts:152`, win/loss, `finance.ts` |
| **Pipeline ponderata** | Il report pesa con `probability ?? stage.defaultProbability`, previsione e finanza con `probability ?? 0`. Il «totale pipeline» della previsione dice «tutte le trattative aperte» e conta solo quelle che chiudono nei prossimi sei mesi. Le trattative senza data o con data passata sono calcolate (`unscheduled`, `overdue`) e mai mostrate | `pipeline.ts`, `forecast/` |
| **Obiettivi** | «vs obiettivo» divide il *commit a sei mesi* per l'obiettivo *del mese*, escluso il vinto del mese. La pagina Obiettivi è solo un editor; nessuno legge gli obiettivi trimestrali e annuali che lo schema consente | `ForecastKPI`, `pipeline/targets` |
| **Ticket aperti** | Tre definizioni, e nessuna conta lo stato `new`, che è quello in cui nasce ogni ticket: una email appena arrivata non è «aperta». La home mostra due conteggi diversi | `dashboard.ts`, `reports.ts:131`, `support/page.tsx:61` |
| **SLA rispettato** | La panoramica supporto ricalcola `createdAt + minuti` sull'orologio, ignorando orari lavorativi, festività e pause, mentre il motore SLA salva già `slaBreachedAt`. Può dire «in tempo» per un ticket che il job ha segnato come violato. La colonna contatto legge `contact.name`, che non esiste: ogni riga dice «Nessun contatto» | `support/page.tsx:92-112` |
| **Valuta** | La home stampa «€» fisso su somme grezze; la previsione converte i KPI ma non i grafici; preventivi e ordini in valute diverse sono sommati; i totali di colonna della board sommano valute diverse | `crm/page.tsx:304,347,461`, `forecast-charts.tsx`, `pipeline-board.tsx:245`, `dashboard.ts` |

**Intervento.** Un modulo `src/lib/metrics/` con una funzione per grandezza: `wonInPeriod` su
`closedAt`, `winRate`, `weightedPipeline`, `OPEN_TICKET_STATUSES`, `slaCompliance` sui timestamp
salvati, `revenue` sulle fatture emesse e sugli ordini senza fattura. Ogni importo è raggruppato per
valuta o convertito esplicitamente con `<Money>`. Ogni schermata legge da lì.

Il test si scrive come quelli che il progetto ha già: una fixture in PGlite con una vendita
completa (trattativa, preventivo, ordine, fattura), e ogni schermata deve dare la stessa cifra.
Le mutazioni rompono la data e il doppio conteggio.

Il «giorno» e il «mese» vanno calcolati sul fuso del workspace. `getTodayView`, il saluto, i
bucket mensili dei report e i job su scadenze usano ancora l'orologio del server, che sui Worker è
UTC. Tra mezzanotte e le due, ora italiana, la home e il calendario non sono d'accordo su che giorno
sia.

**Taglia:** M (una settimana), più la sostituzione nelle schermate.

---

## 3. Il lavoro quotidiano del commerciale

### Cosa funziona

La home si apre con la **lista delle prossime azioni** (`src/lib/next-actions.ts`), personale e
ordinata per urgenza. Copre SLA a rischio, preventivi in scadenza o non aperti da cinque giorni,
trattative oltre la data di chiusura o ferme da quattordici giorni, lead non contattati da tre
giorni e clienti silenziosi da novanta. È la cosa giusta, ed è il nucleo su cui costruire.

### Cosa non funziona o manca

**3.1 Una telefonata sono tre record.**
- Il task non ha un tipo (chiamata, email, incontro): `db/schema.ts:561`.
- L'attività registra cosa è successo, ma accetta una data futura, e calendario e agenda la
  mostrano come evento.
- L'appuntamento è il vero oggetto a calendario.
- La guida commerciale insegna a registrare Attività, Task e Commento per la stessa chiamata.

Non esiste un «chiamare Rossi domani alle 10» che ricordi, compaia in agenda e diventi una
chiamata registrata quando è fatto. Chi lavora sessanta record al giorno salta i passaggi, e il CRM
si svuota.
*Intervento:*
- Il task prende un `type` (chiamata, email, incontro, da fare) e un orario facoltativo.
- Completare un task apre **«com'è andata?»**: esito (raggiunto, non risponde, segreteria), nota e
  **prossimo passo** nello stesso pannello. Il salvataggio crea l'attività e il task successivo.
- Il commento resta solo come discussione di squadra con @menzioni.
- Le note di tipo «nota» e il campo `notes` convergono.

*Taglia:* L.

**3.2 La lista delle prossime azioni non si può lavorare dove si trova.**
- Ogni riga è solo un link (`next-actions-card.tsx`), e in due casi il link è rotto (F-02).
- Mancano le regole che contano di più:
  - «trattativa aperta senza nessun task o appuntamento futuro», il segnale centrale di Pipedrive;
  - «risposta da dare»;
  - «preventivo accettato da trasformare in ordine».
- Ignora `leadScore`.

*Intervento:* azioni sulla riga (registra, pianifica il seguito, rimanda di N giorni, fatto) e le
regole mancanti. *Taglia:* M.

**3.3 Una modalità «coda».**
Né HubSpot né Close lasciano che il commerciale apra quaranta schede una alla volta: offrono una
coda che le passa in fila. In fila, ogni record mostra la scheda, il numero da chiamare e il modulo
di esito, con «avanti» in fondo. Tutti gli ingredienti esistono già: lista, `tel:` e modulo di
attività. *Taglia:* M.

**3.4 La home mescola «io» e «l'azienda».**
- La lista e l'agenda sono personali. Gli otto KPI, i due grafici e i lead recenti sono dell'intero
  workspace.
- Il conteggio dei task conta `todo` e non `in_progress`.
- Ticket, preventivi e contratti compaiono anche senza il modulo nel piano.

*Intervento:* tre numeri personali in cima (vinto nel mese contro obiettivo, trattative senza passo
successivo, attività di oggi), la lista, l'agenda. KPI e grafici nei report, o dietro un selettore
«Io / Squadra». *Taglia:* S.

**3.5 Promemoria.**
- I task ricevono solo un avviso al giorno «in scadenza oggi», più **un'email per ogni task**, senza
  riassunto e senza modo di spegnerla.
- Il promemoria delle attività (`reminderMinutes`) si imposta ma non scatta mai:
  `getActivitiesWithPendingReminder` (`activities.ts:191`) non ha chiamanti.
- Non esistono task ricorrenti.

*Intervento:*
- Promemoria «N minuti prima» sul task con orario, dentro il job da dieci minuti già esistente.
- **Un riepilogo mattutino** (email o push) costruito da `getNextActions` e `getTodayView` al posto
  delle email per singolo task.
- Ricorrenza sul task con lo stesso motore RRULE degli appuntamenti.

*Taglia:* M.

**3.6 La lista dei task non è una coda.**
- È ordinata per `createdAt desc`, non per «scaduti / oggi / prossimi».
- I filtri vivono nello stato del client e non nell'URL.
- Per un admin il filtro assegnatario parte da «tutti».

*Taglia:* S.

**3.7 Comunicazione e testi in inglese.**
- Notifiche, email dei promemoria e voci del timeline sono scritte in inglese nel codice:
  - `Task due today: …`, `Call today` (`task-reminders/route.ts`);
  - `SLA missed —`;
  - `Upcoming appointment` (`appointment-reminders.ts:154`);
  - `${email} replied`;
  - `Task completed: "…"` nel timeline.
- La home mostra gli stati grezzi dei lead e i tipi di attività non tradotti (`crm/page.tsx:499,548`).

La verifica delle traduzioni guarda i componenti, non i testi salvati nel database.
*Intervento:* salvare chiave e parametri, come fa già `NextAction.detailKey`, ed estendere il test.
*Taglia:* S–M.

---

## 4. Struttura delle informazioni e navigazione

### Cosa funziona

Ci sono un registro unico delle entità (`src/lib/entities.ts`) che alimenta ricerca, creazione
rapida e recenti, la palette ⌘K su 14 tipi, la ricerca per cifre del telefono e i filtri della
pipeline condivisi nell'URL.

### Cosa non funziona o manca

**4.1 Il menu è la mappa del codice, non del lavoro.**
- Ci sono 25 voci principali e 9 secondarie, più 3 voci e 8 sottovoci nel menu account.
- Un commerciale vede Gantt, Carico di lavoro, Chat, sei viste d'analisi della pipeline, Finanza e
  Contributo assistente.

*Intervento:* un **profilo di menu per ruolo**. Il commerciale vede Home, Calendario, Attività,
Contatti, Aziende, Lead, Pipeline, Preventivi e Ordini. Le analisi stanno in una voce sola,
«Analisi», con le schede dentro. Gantt, Carico e Chat vanno dietro un interruttore di modulo
(§15). *Taglia:* S.

**4.2 Gli URL non seguono il menu.**

| Voce | Gruppo nel menu | URL |
|---|---|---|
| Macro | Supporto | `/settings/macros` |
| Finanza | Analisi | `/sales/finance` |
| Pipeline | Vendite | fuori da `/sales/`, a differenza delle voci accanto |
| Home | — | `/dashboard/crm` |

Altre incongruenze:
- `/dashboard/coming-soon` e `/dashboard/roles` sono orfane.
- Sul desktop non c'è breadcrumb, tranne che nel ticket. La freccia indietro c'è solo su ordini e
  ticket.

Non è grave da solo, ma è ciò che fa sentire il prodotto «assemblato».
*Intervento:* riallineare con redirect permanenti quando si tocca ciascuna sezione, non in una
sessione a parte. *Taglia:* S ciascuna.

**4.3 La palette non naviga.**
`palette-commands.ts` offre i comandi «crea X» più due destinazioni. Scrivere «calendario» o
«previsione» non porta da nessuna parte.
*Intervento:* generare i comandi di navigazione da `sidebarItems` già filtrato per permessi. È
l'unico modo per non avere due elenchi che divergono. *Taglia:* S.

**4.4 Ricerca.**
- Usa `ILIKE %q%`: niente tolleranza agli errori e niente `unaccent` («Nicolo» non trova «Nicolò»).
- I contatti non si trovano per il nome della loro azienda.

*Intervento:* `unaccent` più `pg_trgm` sui campi nome, se il database del workspace li consente;
altrimenti una colonna normalizzata. *Taglia:* M.

**4.5 Viste salvate.**
Le viste esistono solo su contatti, aziende e lead, e sono private. Lo schema e `filters.ts` hanno
già viste pubbliche, fissate e predefinite (`getPublicFilters`, `getFilterPresets`,
`togglePinFilter`), ma nessuna schermata le chiama. Il filtro non ha:
- il titolare («i miei»);
- le etichette;
- l'ultima attività;
- l'azienda del contatto.

Il server ordina (`orderFor`), ma nessuna intestazione di colonna lo permette.
*Intervento:*
- Viste condivise e fissabili nel menu («I miei lead non contattati», «Chiudono questo mese»).
- I quattro campi di filtro mancanti.
- L'ordinamento dalle colonne.
- Lo stesso `FilterBuilder` su preventivi, ordini, fatture, ticket e task.

È l'equivalente delle *smart view* di Close e Attio, a costo basso. *Taglia:* M.

---

## 5. Contatti, aziende e lead

### Cosa funziona

- **Schede.** Le tre schede sono coerenti tra loro. Il pannello cliente su contatti e aziende mostra
  trattative, preventivi, ordini e ticket.
- **Conversione.** La conversione del lead è atomica, riconosce i duplicati e sposta attività, task
  e ticket.
- **Duplicati.** Il controllo avviene mentre si scrive, con una normalizzazione dei nomi d'azienda
  seria. La fusione è guidata dalle chiavi esterne dello schema.
- **Liste.** Paginate, con esportazione e azioni in blocco.

### Cosa non funziona o manca

**5.1 La scheda non è una vista a 360°.**
- Il timeline mostra solo le attività con la *propria* chiave esterna. L'azienda non vede ciò che è
  stato registrato sui suoi contatti e sulle sue trattative; il contatto non vede le attività delle
  sue trattative.
- Mancano invii di campagna e sequenza, aperture, appuntamenti, task completati, eventi dei
  preventivi e cambi di campo.
- È ordinato per `createdAt` invece che per data dell'attività, e non è paginato.
- Il modulo rapido fissa sempre «adesso»: niente data passata, durata o esito. Il modulo completo
  (`ActivityModal`) è usato solo sulla trattativa.

*Intervento:* un timeline unico per azienda, i suoi contatti e le sue trattative, con filtri a
etichetta. «Ultimo contatto: N giorni fa» nell'intestazione e come colonna di lista: la lista delle
prossime azioni lo calcola già. *Taglia:* M.

**5.2 La scheda azienda non elenca le sue persone.**
`companies/[id]/page.tsx` non interroga i contatti per `companyId`. Non c'è «aggiungi un contatto
qui», non c'è «invia email», e non si crea una trattativa né da azienda né da contatto: ci sono solo
i pulsanti preventivo e ordine (`customer-record.tsx:141`). *Taglia:* S.

**5.3 La conversione perde dati e atterra nel posto sbagliato.**
- L'elenco di ciò che si sposta è scritto a mano, a differenza di quello della fusione. Non porta
  valori dei campi personalizzati, documenti, appuntamenti, iscrizioni alle sequenze, punteggio e
  gruppo.
- Se contatto o azienda esistono già, non vengono arricchiti.
- La trattativa nasce sempre a 0 EUR, senza chiedere valore e data di chiusura.
- Dopo, porta a `?dealId=` e `?contactId=`, che nessuna pagina legge (F-02).

*Intervento:* derivare l'elenco dallo schema come fa `merge-children.ts`, e chiedere valore e data
nel dialogo. *Taglia:* M.

**5.4 Il punteggio del lead non si spiega.**
- `computeLeadScore` misura quanto è completo il record, più stato e valutazione impostati a mano.
  Non guarda aperture, risposte o attività.
- Il campo nel modulo è modificabile, ma il server lo sovrascrive in silenzio. Sulle aziende invece
  resta manuale e non viene mai calcolato.
- Un contatto arriva al massimo a 47, quindi non è mai «caldo».
- «Caldo» vuol dire due cose: la valutazione manuale e la fascia 60–79.

*Intervento:* togliere il campo dal modulo, mostrare il dettaglio al passaggio del mouse,
aggiungere i segnali di coinvolgimento (§8). Oppure toglierlo del tutto finché non misura
l'interesse. *Taglia:* S (togliere) / M (rifarlo).

**5.5 Campi personalizzati a metà.**
- Non ci sono come colonne di lista, nell'esportazione, nell'importazione o nel costruttore di
  report.
- Non compaiono nei dialoghi di creazione.
- `isRequired` disegna solo un asterisco.
- Modificarli dall'interfaccia non fa scattare regole né webhook, dall'API sì.
- La fusione non sposta i valori del duplicato.

*Taglia:* M.

**5.6 Duplicati poco profondi nell'interfaccia.**
- Il telefono è confrontato con un `ilike` esatto, mentre l'API normalizza le cifre
  (`contact-point.ts`).
- Il cellulare è ignorato, e non c'è confronto tra lead e contatti.
- Non esiste una vista «trova duplicati» né «seleziona due righe e unisci».

*Taglia:* S–M.

**5.7 Etichette e titolari.**
- Le etichette sono testo libero separato da virgole: niente suggerimenti, filtro o azione in
  blocco.
- I record nuovi nascono senza titolare.
- Per chi non è admin, l'esportazione restituisce solo i record di cui è titolare, quindi non quelli
  che ha appena creato, e ignora il filtro attivo.

*Intervento:* titolare di default su chi crea; etichette come elenco gestito. *Taglia:* S.

---

## 6. Opportunità e pipeline

### Cosa funziona

- **Board.** Trascinamento tra le fasi, con il dialogo del motivo di perdita. Le colonne si
  comprimono e mostrano conteggi e totali.
- **Scheda della trattativa.** Timeline, task, commenti, documenti e campi personalizzati.
- **Documenti collegati.** Preventivi e ordini legati alla trattativa.
- **Filtri condivisi.** Tutte le schede della sezione usano gli stessi filtri.

### Cosa non funziona o manca

**6.1 Tre modi di chiudere una trattativa, in disaccordo.**
- Trascinando si chiude solo entrando in una fase Vinta o Persa. Riportandola indietro, resta
  `status: won`.
- Nel modale, stato e fase sono indipendenti. Una trattativa spostata su «Vinta» dal modale resta
  `open` e continua a contare nella previsione: è il rilievo C-06 di ottobre che rientra da un'altra
  porta. Scegliendo «persa» lì si salta il motivo.
- `loseDeal()` non ha chiamanti.
- La conversione preventivo → ordine imposta `won` ma non la fase: la scheda resta in «Proposta».

*Intervento:*
- Un solo percorso `closeDeal(won|lost)` che imposta fase, stato, data e motivo insieme.
- Togliere lo stato dal modale.
- Uscire da una fase terminale riapre la trattativa.
- Pulsanti Vinta e Persa sulla scheda.

*Taglia:* M, con mutazioni.

**6.2 Il semaforo di salute è al contrario.**
`createDeal` non calcola il punteggio: parte da 0, quindi ogni trattativa nuova è **rossa**. Viene
ricalcolato solo subito dopo una modifica, quando `updatedAt` è «adesso», e perciò le penalità per
inattività non si applicano mai. Una trattativa abbandonata da sessanta giorni resta verde.
*Intervento:* sostituirlo con due segnali calcolati alla lettura, «giorni dall'ultima attività» e
«ha un passo successivo», che la lista delle prossime azioni sa già calcolare. Il campo salvato va
tolto. *Taglia:* S.

**6.3 Nessun passo successivo obbligato.**
Il principio dell'«activity-based selling» di Pipedrive: ogni trattativa aperta ha un'attività
futura. Senza, sulla scheda compare un avviso e il CRM chiede di pianificarne una dopo ogni
registrazione o cambio di fase. In Flux non ce n'è traccia. È l'intervento di **maggior valore e
minor costo** di tutto il documento, e richiede 3.1.
*Taglia:* S dopo 3.1.

**6.4 La board non regge l'uso quotidiano.**
- Carica ogni trattativa mai creata, vinte e perse comprese, senza finestra temporale.
- Il filtro titolare parte da «tutti».
- La scheda non mostra azienda, titolare né prossimo task. L'unica azione rapida è la matita, che
  compare solo al passaggio del mouse e quindi non su un telefono.
- Non c'è totale ponderato per colonna.

*Intervento:*
- Di default «le mie aperte più le chiuse negli ultimi 30 giorni».
- Sulla scheda: azienda, prossimo task con data oppure «nessun passo» in rosso, e giorni nella fase.
- Azioni rapide: registra, task, vinta, persa.

*Taglia:* M.

**6.5 Nessuna storia delle fasi.**
- «Giorni medi nella fase» del report è in realtà l'età della trattativa (`now - createdAt`,
  `pipeline.ts:383`).
- Senza una tabella `deal_stage_history`, scritta in `updateDealStage`, non si calcolano tempo per
  fase, conversione tra fasi, velocità di vendita e soglia di ristagno per fase.

*Taglia:* M.

**6.6 Il valore della trattativa è digitato a mano e non segue il preventivo.**
Non ci sono prodotti sulla trattativa. L'accettazione di un preventivo non aggiorna l'importo.
*Intervento:* l'importo segue l'ultimo preventivo accettato, o quello inviato più recente,
modificabile a mano. Prodotti sulla trattativa solo se un cliente li chiede: il preventivo li ha
già. *Taglia:* S.

**6.7 Impostazioni mancanti.**
- La pagina delle fasi non permette di marcare una fase come Vinta o Persa.
- I motivi di perdita hanno azioni server (`createLossReason`, `updateLossReason`) ma nessuna
  schermata.
- I motivi e le fasi predefinite nascono in inglese anche nei workspace italiani
  (`seed-workspace.ts:36-76`).

*Taglia:* S.

**6.8 Una sola pipeline.**
`pipeline_stage` non ha un identificativo di pipeline. Per chi vende nuovi clienti e rinnovi, o due
linee di prodotto, è un limite reale, ma non per tutti. Da valutare dopo le fondamenta (§16, Fase 3).

---

## 7. Preventivi, ordini, contratti e fatture

### Cosa funziona

- **Preventivi.** Macchina a stati, pagina pubblica con accetta o rifiuta e registrazione
  dell'apertura, PDF sui Worker, bozze di sollecito sempre modificate prima dell'invio.
- **Da preventivo a fattura.** Preventivo → ordine in un clic. Ordine → fattura con FatturaPA
  validata, note di credito e archivio.
- **Contratti.** Rinnovi con l'avviso nel momento in cui la decisione si può ancora prendere.

È il pezzo più maturo del prodotto.

### Cosa non funziona o manca

**7.1 L'accettazione del cliente non avvisa nessuno.**
- Il POST pubblico (`api/quotes/public/route.ts`) manda solo un webhook: niente notifica, niente
  regola, niente voce nel timeline, e la trattativa non si muove.
- `quote_accepted` non esiste tra i tipi push.
- Gli eventi `opened_email`, `clicked_email` e `reminded`, dichiarati in `quote-detail.tsx:75-79`,
  non sono mai scritti.
- Nessuna azione su preventivi, contratti o fatture chiama `runAutomations`.

*Intervento:*
- Notificare il titolare, anche in push, su apertura, accettazione e rifiuto.
- All'accettazione proporre «crea l'ordine / segna vinta»; al rifiuto aprire il dialogo del motivo.
- Aggiungere eventi di automazione per i documenti.

*Taglia:* M.

**7.2 Esiti presi al telefono.**
«Segna accettato / rifiutato» compare solo dallo stato `viewed` (`quote-detail.tsx:441`). Se il
cliente conferma al telefono senza aver aperto il link, non si può registrare. *Taglia:* S.

**7.3 Nessuna revisione.**
Solo le bozze si modificano, `version` non cresce mai, e non esistono «duplica» o «nuova
revisione». «Il cliente vuole il 5% in meno» significa rifare il preventivo da zero.
*Intervento:* «Nuova revisione» copia il preventivo, incrementa la versione e marca il precedente
come superato. *Taglia:* S–M.

**7.4 Due moduli di preventivo.**
Dalla trattativa si apre `CreateQuoteModal`, che:
- ignora listini, aliquote dei prodotti e valuta;
- propone anche i prodotti disattivati;
- non funziona per trattative senza azienda.

*Intervento:* il pulsante porta a `/sales/quotes/new?dealId=`, e il modale va eliminato. È il
principio 5. *Taglia:* S.

**7.5 L'approvazione si aggira.**
`approvalRequiredReason` controlla solo lo sconto di testata: gli sconti di riga passano. La soglia
si legge dalle impostazioni, ma nessuna schermata la scrive. *Taglia:* S.

**7.6 Il ciclo ordine → incasso non si chiude.**
- L'ordine non elenca le sue fatture, e niente impedisce una seconda fattura dopo la prima
  emissione.
- I pagamenti vivono sull'ordine: una fattura manuale non ha stato «pagata» o «scaduta».
- Non ci sono solleciti di pagamento.
- `contract.dealId` non viene mai impostato, e i contratti non generano fatture.

È la parte I9 del piano di chiusura, «da ordine a incasso», ancora aperta. *Taglia:* L.

**7.7 Modelli di preventivo.**
- Il PDF ha solo note libere: niente logo, condizioni standard o validità predefinita
  (`src/lib/pdf/quote-pdf.ts`).
- Il logo si imposta solo dal pannello di piattaforma.

*Intervento:* condizioni e validità predefinite nella pagina delle impostazioni generali (§13), e
logo lì. *Taglia:* S–M.

**7.8 Già pianificati e ancora aperti.**
- **I6**, invio allo SDI: attende la decisione D1 sul canale.
- ~~**L2**, firma del preventivo~~: fatta il 27 settembre 2026 con la firma semplice (D5); l'avanzata tramite fornitore resta aperta.
- ~~**L8**, provvigioni~~: fatta il 27 settembre 2026, maturazione sulla trattativa vinta (D6); «sull'incassato» da rivalutare quando I9 esisterà.
- **L9**, ambiti delle chiavi API e API di lettura: prossimo passo del piano.

Restano validi e sono collocati nella roadmap sotto.

---

## 8. Automazioni

### Cosa funziona

- **Motore.** Sei entità, condizioni di cambiamento (`changed_to`, `changed_from`) con espressioni
  E/O sui campi personalizzati, e rilevamento dei cicli.
- **Azioni.** Otto, tra cui assegnazione a rotazione con instradamento per territorio e fonte, e
  iscrizione a sequenza.
- **Ricette.** Otto, con anteprima dei record coinvolti.
- **Registro.** Distingue le esecuzioni dai fallimenti.

### Cosa non funziona o manca

**8.1 Mancano i trigger che servono alle vendite.**
- Il costruttore offre, per le trattative, solo stato, probabilità, valuta e note: niente fase,
  importo, titolare o data di chiusura (`rule-builder.tsx:84-101`).
- «Una trattativa entra in Proposta → crea un task» non si può costruire.
- Le ricette usano campi (`amount`, `totalAmount`) che il costruttore non mostra.
- Non ci sono trigger temporali (F-10), né condizioni relative alle date: «data di chiusura
  passata», «nessuna attività da N giorni», «preventivo non aperto da N giorni».

*Intervento:* fase, importo, titolare e data nel costruttore. Un job `automation-schedule` su un
programma esistente, che è gratuito perché non aggiunge trigger, con evento proprio `onSchedule` e
le condizioni relative. *Taglia:* M.

**8.2 Non si capisce perché una regola non è partita.**
- Non c'è una prova a secco, e «non si applicava» non viene registrato.
- Quando la quota mensile è esaurita (1.000 esecuzioni sul piano Professional), le regole vengono
  saltate con un solo `console.warn`.

*Intervento:*
- «Prova su questo record», che mostra condizione per condizione vero o falso senza eseguire.
- Una riga nel registro e un avviso all'admin a quota esaurita.

*Taglia:* S–M.

**8.3 L'email delle automazioni scavalca la configurazione del workspace.**
- Usa `RESEND_API_KEY` globale e `automation@fluxcrm.app` come mittente.
- Ignora SMTP, chiave e mittente di Impostazioni → Email.
- Salta la coda, la lista di esclusione e il link di disiscrizione.

*Intervento:* passare da `email_job`, `getEmailConfig()` e dal controllo di esclusione, come le
sequenze. *Taglia:* M.

**8.4 Le sequenze sono solo email.**
Nella pratica commerciale un passo è spesso una telefonata o un messaggio LinkedIn.
*Intervento:*
- Un tipo di passo «task» che crea l'attività al commerciale.
- Giorni lavorativi invece di giorni di calendario.
- Una finestra oraria di invio.
- I passi inviati come risposta nello stesso thread.

*Taglia:* M.

**8.5 Chi crea le regole.**
Basta `record:write`: un editor può creare regole che mandano email o chiamano indirizzi esterni
per l'intero workspace (F-15).
*Intervento:* una nuova capacità `automation:manage`, per admin. *Taglia:* S.

**8.6 Da non fare adesso.**
Un costruttore visuale a diagramma. Il modulo a schede è adeguato a una PMI se offre i campi giusti
e la prova a secco. Il diagramma costa molto e aggiunge complessità.

---

## 9. La posta: il vuoto più grande

**Il limite.** In tutto il prodotto la posta *esce* e non *rientra*:

- L'email mandata dalla scheda parte dall'indirizzo del workspace, senza Reply-To verso il
  commerciale (`src/actions/email.ts`).
- La risposta di un prospect arriva a `processInboundEmail`. Se c'è una sequenza la ferma; poi
  **apre un ticket di supporto** e crea un contatto provvisorio anche quando il mittente è già un
  lead (`ticket-from-email.ts:265-300`). Sul timeline del lead non arriva niente.
- La posta scambiata fuori da Flux, cioè quasi tutta, non entra mai.
- Non esistono OAuth Gmail o Outlook, IMAP, né un indirizzo in copia nascosta: nessuna delle tre
  cose compare nel codice.

Il doppio inserimento è la prima ragione per cui un CRM viene abbandonato: l'audit di ottobre lo
diceva a proposito del calendario, ed è ancora più vero per la posta. La scelta di ottobre sul
calendario, lettura di un indirizzo iCal nei due sensi, era giusta per i tempi e i vincoli. Per la
posta non esiste un equivalente senza OAuth, **tranne uno**.

**Intervento, in tre passi di costo crescente:**

1. **Instradare le risposte per mittente** (S–M). Se l'indirizzo appartiene a un lead o a un
   contatto con un titolare e la mail non è una risposta a un ticket, va sul timeline e nella lista
   del titolare come «risposta da dare», **non** al supporto. Le email dalla scheda portano Reply-To
   al commerciale, oppure un indirizzo di risposta tracciato del workspace.
2. **Un indirizzo in copia nascosta per workspace o per persona** (M). Chi scrive da Gmail o Outlook
   mette in Ccn `crm+…@` e l'email si archiva sul contatto giusto per destinatario. Usa la pipeline
   in entrata che esiste già. Dà l'80% del valore del collegamento completo, senza verifiche Google
   e senza tenere credenziali per conto di nessuno.
3. **Collegamento OAuth Gmail / Microsoft 365** (L–XL). Invio dalla propria casella, lettura dei
   thread e calendario nei due sensi. Serve la verifica degli ambiti da parte di Google, che è una
   coda esterna: va avviata presto se la si vuole (decisione D-B).

Il tracciamento delle aperture delle email individuali usa l'infrastruttura delle campagne che
esiste già. *Taglia:* S.

**Recapitabilità.**
- Le campagne non inviano gli header `List-Unsubscribe` e `List-Unsubscribe-Post`, che Gmail e
  Yahoo richiedono ai mittenti massivi dal 2024.
- Non c'è una guida alla verifica del dominio (SPF, DKIM).
- Il worker invia 30 email ogni 10 minuti, cioè 180 all'ora per workspace: una campagna a 5.000
  contatti richiede circa 28 ore. Non è un difetto, ma va detto nella schermata di invio, e la
  dimensione del lotto va resa configurabile per i piani che la reggono.

*Taglia:* S (header), M (guida al dominio).

---

## 10. L'intelligenza artificiale

> **Aggiornamento del 30 settembre 2026.** La proposta di questa sezione è stata accolta e allargata:
> D-A è rivista e il copilota è la Fase 5 (§18). Il vincolo sotto su `fetch` senza SDK resta: il
> livello del modello (`src/lib/ai/`) è scritto così, e cambiare modello o fornitore è una variabile
> d'ambiente. Il margine del bundle, però, oggi è più ampio: 8.968 KiB su 10.240. Il progetto è in
> [`ia-copilota-in-flux-o-voipai-2026-09.md`](ia-copilota-in-flux-o-voipai-2026-09.md).

**Lo stato.** Nel prodotto non c'è nessun modello linguistico. È una scelta dichiarata dell'audit di
ottobre (S-05, S-06), e le sue ragioni sono buone. Dove il prodotto non ha la fonte, un modello
inventa. Il verbale di riunione ricostruito senza trascrizione è il caso da manuale, e
`meeting-minutes.ts` lo spiega bene. Le funzioni «intelligenti» di oggi sono regole esplicite:
- prossime azioni;
- bozze di sollecito;
- triage per somiglianza di parole;
- passaggio di consegne.

Sono buone proprio perché si possono contestare.

**Il limite.** L'argomento contro l'invenzione vale dove manca il testo di partenza. Non vale dove
il testo c'è già: una nota digitata, un thread email, la storia di un ticket. Lì un modello non
inventa, **riordina**. È anche lì che si risparmia più tempo al commerciale. Il mercato si è mosso:
HubSpot, Pipedrive, Salesforce e Close hanno tutti bozze e riassunti, e un acquirente se lo aspetta.

**Proposta: riaprire la decisione (D-A) con un perimetro stretto**, coerente con il principio 6.

| Funzione | Fonte | Perché regge | Valore |
|---|---|---|---|
| **Bozza di risposta o sollecito** dal thread e dalla scheda | Thread email (dopo §9), storia del preventivo | Estende `quote-followup`: resta bozza, mai inviata da sola | Alto |
| **Nota di chiamata strutturata**: dal testo digitato o dettato, riassunto, prossimo passo e task proposti, ciascuno con il riferimento al testo | Ciò che il commerciale ha scritto | Estrae, non inventa; alimenta 3.1 | Alto |
| **Riassunto del thread per chi subentra** su un ticket | Messaggi del ticket | `ticket-triage.ts` stesso lo indica come l'unico caso che richiede un modello | Medio |
| **Filtri in linguaggio naturale** («i miei lead di Milano non contattati da un mese») → vista salvata | Nessuna: produce un filtro che l'utente vede e corregge | Il risultato è verificabile prima dell'uso | Medio |
| **Spiegazione del rischio** di una trattativa sopra le regole delle prossime azioni | Segnali calcolati | Il modello spiega segnali veri, non li produce | Basso–medio |

**Vincoli:**
- Chiamata al fornitore con `fetch` semplice e nessun SDK: il bundle ha circa 450 KiB di margine.
- Attivazione per workspace, con informativa privacy.
- Nessun dato inviato senza consenso dell'admin.
- Nessuna scrittura nel CRM senza clic.
- Da escludere: arricchimento a pagamento dei dati, agenti autonomi, «approfondimenti» generici su
  pannelli.

*Taglia:* M per le prime due voci, dopo §9.

---

## 11. Reportistica e dashboard

### Cosa funziona

- **Report territoriale.** Corretto su `closedAt`.
- **Win/loss.** Legge i motivi da un elenco.
- **Costruttore di report.** Sette entità, raggruppamento per periodo e cinque tipi di grafico.

### Cosa non funziona o manca

Oltre a §2, i numeri incoerenti:

**11.1 Quattordici superfici, troppe sovrapposte.**
- Le schede Attività e Log dei report sono vuote (F-11).
- La scheda Campagne duplica la lista del marketing e carica *tutti* i log.
- «Ricavo per fase (vinte)» mostra una colonna sola per definizione.
- Finanza ripete la pipeline per fase e il tasso di vincita.
- Il report della pipeline sovrappone previsione, imbuto e win/loss.
- La «distribuzione trattative» in home conta vinte e perse per fase.
- Il carico di lavoro esiste in due copie.
- Nel codice di Finanza è rimasto un file del template, `card-overview.tsx`, con affitto, bolletta e
  «ChatGPT Plus».

*Intervento:* la sezione Pipeline, sopra il modulo delle metriche, diventa il posto unico dei
numeri di vendita. Report tiene il costruttore e la scheda per commerciale (11.2). Finanza si
ricostruisce sulle fatture o confluisce. Le schede vuote e duplicate si tolgono. *Taglia:* M.

**11.2 La vista che un responsabile chiede per prima non c'è.**
Una tabella per commerciale con:
- vinto contro obiettivo;
- copertura della pipeline (aperto / obiettivo residuo);
- attività (chiamate, incontri);
- tasso di vincita;
- valore medio;
- ciclo medio.

È «Sales rep productivity» di HubSpot, «Insights» di Pipedrive. *Taglia:* M dopo §2.

**11.3 Nessun approfondimento dal grafico al record.**
- Nessun grafico ha un clic.
- I KPI in home portano a liste non filtrate, e «Top deal» porta alla board invece che alla
  trattativa.
- Il confronto con il periodo precedente c'è solo in Finanza.
- Il filtro utente è ignorato dalle schede Vendite e Campagne dei report.
- Non c'è filtro per squadra, anche se `deals.groupId` e i gruppi utenti esistono.

*Intervento:* ogni numero è un link a una lista filtrata, riusando i parametri URL della pipeline. È
il principio 2. *Taglia:* S–M.

**11.4 Il costruttore non risponde alle tre domande classiche.**
- Non espone titolare, fase, azienda o `closedAt`: «trattative per titolare», «per fase» e
  «attività per commerciale» non si costruiscono.
- Mancano ordini, fatture, ticket e campi personalizzati.
- I gruppi per data sono ordinati per conteggio, quindi una linea mensile esce in ordine sparso.
- Non ci sono date relative («questo mese»), e un report salvato invecchia.
- Salvano solo gli admin, e ogni report salvato è visibile a tutti.
- Le etichette dei campi sono in inglese nel codice.

*Taglia:* M.

**11.5 Nessun invio programmato.**
Un riepilogo settimanale al responsabile (scheda per commerciale, trattative ferme, previsione) sul
job giornaliero esistente. *Taglia:* M.

**11.6 Home non personalizzabile.**
È secondaria se si fa 3.4. Scegliere e nascondere le schede è utile, ma viene dopo.

---

## 12. Supporto

### Cosa funziona

È ben integrato:
- ticket legati a contatto, azienda, lead e ordine, e visibili sulle schede;
- email in entrata e in uscita con thread e allegati;
- SLA su calendario lavorativo con festività e soglie;
- macro, triage per somiglianza, passaggio di consegne e presenza.

### Cosa non funziona o manca

**12.1** La panoramica calcola SLA e risoluzione in modo sbagliato (§2). «Tasso di risoluzione»
conta `resolved` e non `closed`, quindi *scende* man mano che la chiusura automatica lavora.
L'etichetta «Mese corrente» copre in realtà 30 giorni più tutti gli aperti. *Taglia:* S–M.

**12.2** Non c'è un report per agente (tempo di prima risposta, risoluzione, violazioni per
priorità), né l'andamento dell'arretrato, né l'entità ticket nel costruttore. *Taglia:* M.

**12.3** Mancano:
- un modulo web per aprire un ticket e una pagina di stato per token;
- la soddisfazione del cliente (CSAT): il quadrante finto al 92% è stato tolto e non sostituito;
- la fusione dei ticket.

*Intervento:* CSAT con un clic nell'email di risoluzione, con lo stesso meccanismo a token della
disiscrizione (S–M). Modulo e pagina di stato (M). **Base di conoscenza: rimandare**, perché costa
molto e allontana dalla semplicità.

**12.4** Canali chat, telefono e social sono solo etichette scelte a mano. Va bene, ma non vanno
presentati come canali.

---

## 13. Configurazione, amministrazione e primo avvio

### Cosa funziona

- **Permessi.** Tabella delle capacità pulita e unica (`permissions.ts`).
- **Utenti.** Inviti con link di riserva e gruppi di utenti.
- **Piani.** Tre piani con Stripe.
- **Impostazioni.** Indice con undici schede filtrate per capacità.
- **Workspace nuovo.** Nasce con fasi, SLA e motivi di perdita.
- **Aiuto e documentazione.** Centro assistenza in due lingue, specifica OpenAPI e collezione
  Postman.

### Cosa non funziona o manca

**13.1 Dal «mi registro» al primo valore passano giorni.**
- La registrazione autonoma è un vicolo cieco (F-09).
- Un workspace lo crea solo il personale Flux da `/admin/tenants`, incollando una stringa di
  connessione Postgres.
- Sui Worker serve anche un binding Hyperdrive e un deploy, perché i binding sono statici.

Per un CRM venduto a PMI è il limite commerciale più serio: esclude la prova autonoma, che è il modo
in cui Pipedrive, HubSpot e Attio acquisiscono clienti.
*Intervento:*
- **Subito:** «richiedi un workspace», con notifica al personale.
- **Poi:** decidere il modello di approvvigionamento (decisione D-C): database per cliente creato
  via API del fornitore con coda, oppure un database condiviso per i piani d'ingresso con migrazione
  al dedicato quando serve. Finché i Worker richiedono un binding per database, la prova autonoma
  su Workers non è possibile senza la seconda strada.

*Taglia:* S (subito) / XL (poi).

**13.2 Nessuna guida al primo avvio.**
Non ci sono procedura guidata, lista di controllo o dati d'esempio. `seed-demo.ts` esiste solo come
script.
*Intervento:* una scheda in home con cinque passi, ciascuno spuntato dai dati e non a mano:
1. dati dell'azienda;
2. invita la squadra;
3. importa i contatti;
4. rivedi le fasi;
5. collega la posta.

In più, un pulsante «carica dati d'esempio / rimuovili». *Taglia:* M.

**13.3 Manca una pagina «Azienda e preferenze».**
- Il **fuso orario del workspace** si imposta solo in Supporto → SLA → Orari lavorativi
  (`business-hours-card.tsx:47`), dietro il modulo supporto e `sla:manage`. Però governa calendario,
  promemoria e, dopo §2, tutte le date dei report. Un workspace senza modulo supporto non può
  cambiarlo.
- Le chiavi di traduzione `settings.general` (nome, fuso, formato data, valuta, lingua, logo)
  esistono già e non sono usate.
- Logo e colore si impostano solo dal pannello di piattaforma.
- La valuta di base è fissa a EUR.

*Intervento:* una pagina Generale, con il fuso spostato lì (letto ancora dallo stesso posto per chi
l'ha già impostato). *Taglia:* S–M.

**13.4 Importazione.**
- I lead non si importano (F-07).
- Contatti e aziende accettano solo intestazioni esatte in camelCase inglese (`firstName`) e non
  gestiscono il `;` dell'Excel italiano.
- Non c'è mappatura delle colonne né anteprima.
- I duplicati si saltano invece di aggiornarli.
- I campi personalizzati non si importano.
- Le aziende si abbinano con il nome esatto invece che con la normalizzazione usata altrove.
- Scrive riga per riga fino a 5.000 righe: lo stesso problema di budget delle sottorichieste sui
  Worker che il `CLAUDE.md` descrive per l'API.

Nessun CRM viene adottato senza un'importazione che funzioni al primo colpo.
*Intervento:* un'importazione guidata:
1. caricamento;
2. rilevamento del separatore;
3. mappatura con suggerimenti in italiano e inglese;
4. anteprima con i duplicati trovati e la scelta «aggiorna / salta / crea»;
5. scrittura a blocchi con `api-import-batch`.

Poi i predefiniti per le esportazioni di HubSpot, Pipedrive ed Excel. *Taglia:* L.

**13.5 Visibilità dei record.**
Chiunque nel workspace vede tutto. Per una squadra commerciale con agenti in concorrenza è un freno.
*Intervento:* un solo interruttore di workspace, «gli editor vedono solo i propri record e quelli
del proprio gruppo», e **non** ruoli configurabili o permessi per campo, che sarebbero la direzione
di Salesforce (decisione D-D). *Taglia:* L, perché tocca ogni query di lista, ricerca ed
esportazione. Va fatto con una guardia strutturale come quella sulle colonne utente.

**13.6 Registro delle modifiche.**
- Il registro attività utenti non viene scritto (F-11). `tenants.ts:305` contiene `TODO: implement
  audit log`.
- La storia delle modifiche esiste solo sui ticket e sull'API.

*Intervento:* storia dei campi su trattative, contatti e aziende (chi, cosa, da, a), mostrata nel
timeline di §5.1. *Taglia:* M.

**13.7 Profilo e sicurezza personale.**
- Chi non è admin non può cambiare la propria password: `changePasswordAction` è raggiungibile solo
  da `/dashboard/users`.
- Non c'è una pagina profilo, e il menu account del template ha voci senza gestore.
- Non c'è verifica in due passaggi per gli utenti di workspace.

*Taglia:* S (profilo e password) / M (2FA).

**13.8 GDPR a portata di admin.**
- La cancellazione esiste solo come `POST /api/crm/erasure` con chiave API: una PMI dovrebbe usare
  `curl`.
- Non c'è un'esportazione dei dati di una persona (diritto di accesso).
- Non c'è una politica di conservazione.
- Il consenso è un booleano con data, senza fonte, finalità o storico.

*Intervento:* pulsanti «Esporta i dati di questa persona» e «Cancella» sulla scheda, sopra il motore
che esiste già. Fonte e finalità del consenso. *Taglia:* S–M.

**13.9 Impostazioni sparse.**
- Macro nel gruppo Supporto con URL sotto Impostazioni.
- SLA e orari assenti dall'indice.
- Le notifiche sono nell'indice, ma l'indice è solo per admin: un editor ci arriva solo dalla
  campanella.
- Fatturazione elettronica, territori e macro compaiono anche senza il modulo nel piano.
- Tipi e categorie d'azienda si creano al volo e non si gestiscono da nessuna parte, da cui
  «Prospect» e «prospect».
- In italiano «Fatturazione» (l'abbonamento) sta accanto a «Fatturazione elettronica».

*Intervento:* un indice unico per tutti con le schede filtrate, una pagina «Elenchi» (tipi,
categorie, fonti, motivi di perdita) e «Abbonamento» al posto di «Fatturazione». *Taglia:* S–M.

**13.10 I piani promettono cose non applicate.**
- `maxUsers` non è controllato all'invito: il piano Free dice un utente.
- `storageGb` e `maxIntegrations` non sono mai letti.
- `hasWhiteLabel`, `hasSandbox` e il modulo `helpdesk` compaiono solo nel modulo di piattaforma.
- Un editor che clicca un modulo bloccato arriva alla pagina dell'abbonamento, che è per admin, e
  riceve «non autorizzato» invece di «chiedi al tuo amministratore».

*Taglia:* S–M.

**13.11 Integrazioni.**
- La documentazione API è solo in `/admin/api-docs`, dietro il login del personale Flux: chi riceve
  la chiave non la vede. Sono due fonti che divergono: la pagina, 5.069 righe in italiano con 66
  endpoint, e `openapi/spec.ts`, in inglese con 42 percorsi.
- La schermata webhook offre 10 eventi, mentre il codice ne emette almeno 15. Preventivi, fatture e
  ticket non ne emettono.
- Non c'è un'app Zapier o Make.

*Intervento:*
- Documentazione pubblica generata dalla specifica, un'unica fonte con la guardia di allineamento
  che esiste già.
- Eventi webhook letti dallo stesso catalogo del codice.
- Un'app Zapier o Make **dopo** l'API di lettura (L9).

*Taglia:* M.

---

## 14. Coerenza dell'interfaccia e della lingua

**14.1 Liste.**
- Il costruttore di filtri esiste su contatti, aziende, lead e prodotti, e manca su preventivi,
  ordini, fatture, ticket e task.
- L'importazione esiste solo sulle prime tre.
- Stati vuoti con un'azione su sei liste; mancano su preventivi, fatture, contratti, campagne e
  task.
- I task non hanno la vista a schede sul telefono.

**14.2 Dettaglio.**
- Contatto, azienda, lead e trattativa condividono timeline e campi personalizzati; ordine,
  preventivo e fattura no.
- La modifica cambia forma a seconda del record: modale per i contatti, pagina per preventivi e
  ordini, pannello laterale per gli appuntamenti, modale via `?task=` per i task.

**14.3 Conferme.**
17 punti usano il `confirm()` nativo del browser (`contact-modal.tsx:634`, `company-modal.tsx:777`…),
13 usano `AlertDialog`.

**14.4 Caricamento ed errori.**
- Uno scheletro unico a forma di tabella per ogni pagina (`dashboard/loading.tsx`): calendario e
  board «saltano» all'arrivo dei dati.
- Un `error.tsx` unico.

**14.5 Lingua fuori dalla dashboard.**
- Il pannello `/admin` (22 file) non è tradotto e mescola inglese e italiano.
- `select-tenant`, `not-found` e `tenant-switcher` sono in inglese.
- La verifica delle traduzioni non guarda queste cartelle.

**14.6 Terminologia.**
- La guida dice «Deal» 37 volte e «clicca "+ Nuova Deal"», mentre il pulsante dice «Nuova
  Trattativa».
- «Rapporti» e «Report» sono usati entrambi.
- «Attività» indica sia i task sia le attività registrate; dopo 3.1 va deciso un nome per ciascuno.

**14.7 Codice morto.**
Da togliere:
- `crm.config.ts` (dati finti del template);
- `account-switcher.tsx`;
- `roles-client.tsx`;
- `/dashboard/coming-soon`;
- `leads/actions.ts`, con azioni duplicate senza guardie;
- `finance/_components/card-overview.tsx`.

**Intervento complessivo.** Una lista di verifica «pagina nuova» nel `CONTRIBUTING.md` (lista con
filtri, stato vuoto con azione, scheda sul telefono, conferma con `AlertDialog`, breadcrumb). Un
controllo in `mobile:audit` o in un nuovo `ui:audit` che trova i `confirm(` nativi, come la
verifica sul `vh`. Le singole pagine si allineano quando vengono toccate. *Taglia:* S per la
guardia, il resto per assorbimento.

Il punto di partenza è buono: 135 pulsanti a icona su 150 hanno un'etichetta accessibile.

---

## 15. Mobile

### Cosa funziona

È stato fatto più di quanto la maggior parte dei CRM offra:
- barra in basso configurabile, con crea e menu;
- liste a schede e dialoghi a tutto schermo;
- app installabile, con notifiche push;
- zone sicure gestite;
- una verifica automatica dei difetti da telefono.

### Cosa non funziona o manca

- **Dopo la chiamata non succede niente.** Toccare `tel:` non chiede «com'è andata?», e il modulo
  attività parte da «nota» invece che da «chiamata», senza esito. È 3.1 visto dal telefono, dove
  conta di più. *Taglia:* S dopo 3.1.
- **«Registra chiamata» non è tra le voci di Crea.** Le attività non sono nel registro delle
  entità. *Taglia:* S.
- **Creazione rapida lenta.** Naviga alla lista con `?new=true` invece di aprire il modulo sul
  posto. *Taglia:* S.
- **Link mancanti.** Non c'è link WhatsApp, e le aziende non hanno link a Maps: ce l'hanno solo gli
  appuntamenti. *Taglia:* S.
- **La bolla della chat interna** sta sopra la barra in basso su ogni schermata, e interroga il
  server ogni 30 secondi per scheda aperta, mantenendo sveglio il database (vedi `CLAUDE.md` sul
  costo di Neon). *Intervento:* §16, Fase 0.

---

## 16. Cosa togliere o nascondere

Principio 5. Nessuna di queste funzioni è rotta. Sono tutte cose che un commerciale deve scavalcare
per arrivare a quelle che usa, e alcune costano risorse.

| Funzione | Proposta | Perché |
|---|---|---|
| **Gantt, carico di lavoro, dipendenze tra task, RACI, cronometro, stime ore, priorità a cinque livelli, sottotask a tre livelli** | Dietro un modulo «Progetti», spento di default | Sono strumenti di gestione progetti. Il modulo di creazione del task è di 1.054 righe, quello di modifica di 949. Un task commerciale ha tipo, data, record e titolare |
| **Chat interna** (widget da 1.086 righe più pagina da 719, due implementazioni) | Dietro un modulo, spenta di default. Al suo posto, @menzioni nei commenti di ogni record (oggi solo sulle trattative) | È un messaggistico generico senza legame con i record. Interroga il server ogni 30 secondi per scheda |
| **Territori** | Voce di menu e scheda visibili solo se esiste almeno un territorio | Utili per chi li usa (instradamento L5), rumore per gli altri |
| **Report della pipeline** | Confluire nella previsione | Duplica previsione, imbuto e win/loss |
| **Schede Attività, Log e Campagne dei report; «Ricavo per fase (vinte)»; «Fonti di ricavo»** | Togliere | Vuote, duplicate o prive di significato (§11) |
| **Punteggio di salute salvato** | Togliere, sostituire con segnali calcolati | Sbagliato in entrambe le direzioni (§6.2) |
| **Campo «punteggio» modificabile nei moduli** | Togliere | Il server lo sovrascrive in silenzio |
| **Tabelle di filtri pubblici, etichette e predefiniti mai usate** | Usarle (§4.5) o toglierle | Nessuna via di mezzo |
| **`CreateQuoteModal`** | Togliere, usare la pagina completa | Secondo modulo che ignora i listini (§7.4) |
| **Codice morto** (§14.7) | Togliere | |

---

## 17. Confronto con i CRM di riferimento

Riferimento: Pipedrive e HubSpot Sales per le PMI; Close e Attio per l'approccio operativo.
«Valore» è ciò che cambia nella giornata del commerciale o del responsabile. «Costo» è la
complessità, per il prodotto oltre che per lo sviluppo.

| Capacità | Flux oggi | Valore | Costo | Dove |
|---|---|---|---|---|
| Registrare e pianificare in un gesto | Tre oggetti separati | Molto alto | Medio | §3.1 |
| Passo successivo obbligato sulla trattativa | Assente | Molto alto | Basso | §6.3 |
| Posta archiviata sul contatto (Ccn / sincronizzazione) | Assente; le risposte vanno al supporto | Molto alto | Medio / alto | §9 |
| Importazione guidata | Solo intestazioni esatte; lead assenti | Molto alto | Medio | §13.4 |
| Prova autonoma e primo avvio guidato | Vicolo cieco | Molto alto (commerciale) | Alto | §13.1–13.2 |
| Metriche coerenti e scheda per commerciale | Sette definizioni | Alto | Medio | §2, §11.2 |
| Coda di lavoro / modalità focus | Assente | Alto | Medio | §3.3 |
| Viste condivise e fissabili | Solo private, solo tre liste | Alto | Basso | §4.5 |
| Notifiche su apertura e accettazione del preventivo | Solo webhook | Alto | Basso | §7.1 |
| Trigger per fase, data e inattività | Assenti; regole programmate inerti | Alto | Medio | §8.1 |
| Visibilità dei record per titolare o squadra | Assente | Alto per squadre | Alto | §13.5 |
| Bozze e riassunti con IA | Assenti per scelta | Alto | Medio | §10 |
| Storia delle fasi e velocità | Assente | Medio / alto | Medio | §6.5 |
| Link di prenotazione pubblico | Assente (il selettore di disponibilità esiste) | Medio / alto | Medio | Fase 3 |
| Modulo web per lead e ticket | Assente | Medio / alto | Medio | Fase 3 |
| Più pipeline | Assente | Medio | Medio | §6.8 |
| Revisioni e modelli di preventivo | Assenti | Medio | Basso | §7.3, §7.7 |
| Zapier / Make | Assente | Medio | Medio (dopo L9) | §13.11 |
| Costruttore visuale di automazioni, oggetti personalizzati, permessi per campo, arricchimento a pagamento | Assenti | Basso per questo pubblico | Alto | **Non fare** |

---

## 18. Roadmap

Ordinata per rischio e dipendenza, come il piano di chiusura. Le taglie sono indicative:
- **S** fino a un giorno;
- **M** da due a cinque giorni;
- **L** da una a due settimane;
- **XL** oltre.

Includono test, mutazioni dove un errore costa, voce nel Centro assistenza e documentazione API,
secondo le regole di chiusura già in uso.

### Fase 0 — Smettere di sbagliare in silenzio

**Una o due settimane · nessuna decisione**

| ID | Intervento | Rilievi | Taglia |
|---|---|---|---|
| V0.1 | Togliere l'invio al cliente dalla registrazione delle chiamate | F-01 | S |
| V0.2 | Link alle trattative e ai contatti sulle schede vere | F-02 | S |
| V0.3 | Automazioni dall'API nel workspace giusto, e sui POST di creazione | F-03 | M |
| V0.4 | Firma dei link di tracciamento; segnaposto con spazi dei nomi | F-04, F-16 | S–M |
| V0.5 | Approvatori dei preventivi per capacità; `can()` al posto dei confronti | F-05 | S |
| V0.6 | Importo della trattativa nella propria valuta | F-06 | M |
| V0.7 | Permessi e limite di piano sull'importazione; pulsante lead nascosto finché V1.5 non c'è | F-07, F-08 | S |
| V0.8 | Registrazione → «richiedi un workspace» | F-09 | S |
| V0.9 | Opzione «programmata» nascosta; registro attività utenti ricostruito su `activities` o tolto | F-10, F-11 | S |
| V0.10 | Invio email da lead, sollecito del preventivo aperto, eliminazione in blocco con conferma | F-12, F-13, F-14 | S–M |
| V0.11 | Anti-SSRF e capacità `automation:manage` sulle regole | F-15 | S |
| V0.12 | Notifiche a sé stessi, promemoria delle attività mai inviati, testi delle notifiche tradotti | F-17, §3.5, §3.7 | S–M |
| V0.13 | Chat e Gantt dietro un interruttore di modulo; codice morto tolto | §16, §14.7 | S |

### Fase 1 — Fondamenta operative

**Quattro-sei settimane · decisioni D-E e D-F**

| ID | Intervento | Rilievi | Taglia |
|---|---|---|---|
| V1.1 | **Modulo delle metriche** e sostituzione in ogni schermata; giorno e mese sul fuso del workspace | §2 | M+M |
| V1.2 | **Un gesto per registrare e pianificare**: task con tipo e orario, «com'è andata?» con esito e passo successivo | §3.1, §15 | L |
| V1.3 | **Chiusura unica della trattativa**; semaforo sostituito da segnali calcolati; motivi e fasi terminali configurabili | §6.1, §6.2, §6.7 | M |
| V1.4 | **Risposte instradate al titolare**, non al supporto; Reply-To al commerciale | §9 passo 1 | S–M |
| V1.5 | **Importazione guidata** per contatti, aziende e lead | §13.4 | L |
| V1.6 | **Pagina Azienda e preferenze** (fuso, logo, condizioni di preventivo); indice impostazioni unico; «Elenchi» | §13.3, §13.9, §7.7 | M |
| V1.7 | Timeline unico azienda-contatti-trattative con storia dei campi; persone sulla scheda azienda | §5.1, §5.2, §13.6 | M+M |
| V1.8 | Profilo personale e cambio password per tutti | §13.7 | S |

### Fase 2 — Un CRM che guida

**Sei-otto settimane · dopo la Fase 1**

| ID | Intervento | Rilievi | Taglia |
|---|---|---|---|
| V2.1 | **Passo successivo obbligato** e lista delle prossime azioni con azioni sulla riga e nuove regole | §6.3, §3.2 | M |
| V2.2 | **Board operativa**: le mie aperte, schede con prossimo task e giorni in fase, azioni rapide | §6.4 | M |
| V2.3 | **Home «cosa faccio adesso»** e riepilogo mattutino al posto delle email per task | §3.4, §3.5 | M |
| V2.4 | **Coda di lavoro** | §3.3 | M |
| V2.5 | **Viste condivise e fissabili**, filtri su titolare, etichette e ultima attività, su tutte le liste | §4.5 | M |
| V2.6 | **Ciclo del preventivo**: notifiche e regole su apertura, accettazione e rifiuto; esiti da telefono; revisioni; un solo modulo | §7.1–7.5 | M+S |
| V2.7 | **Automazioni per le vendite**: fase, importo e data nel costruttore; job programmato con condizioni relative; prova a secco; email dalla coda del workspace | §8.1–8.3 | M+M |
| V2.8 | **Indirizzo in copia nascosta** per archiviare la posta esterna | §9 passo 2 | M |
| V2.9 | **Scheda per commerciale**, approfondimento dai grafici, pulizia dei report | §11.1–11.3 | M+M |
| V2.10 | Primo avvio guidato con dati d'esempio | §13.2 | M |
| V2.11 | GDPR dalla scheda: esporta e cancella | §13.8 | S–M |
| V2.12 | Menu per ruolo; palette che naviga; ricerca senza accenti | §4.1, §4.3, §4.4 | S+S+M |

### Fase 3 — Evoluzione

**Dopo le decisioni D-A, D-B, D-C, D-D e quelle del piano di chiusura**

| ID | Intervento | Dipende da | Taglia |
|---|---|---|---|
| V3.1 | **Flux per l'assistente** (D-A): F1 l'origine degli eventi dice quale chiave ha scritto; F2 evento di consenso ritirato; F3 segno «seguito dall'assistente», che sequenze e campagne rispettano; F4 lettura di fasi e prodotti con il prezzo del cliente; F5 bozza di preventivo via API con i prezzi calcolati da Flux. Nessun modello in Flux | D-A | S+S+M+S+M |
| V3.2 | ~~**Collegamento Gmail / Microsoft 365**~~ (invio, thread, calendario nei due sensi) — *deciso: entrambi, spenti finché non verificati* — **costruito il 27 settembre 2026, dormiente**: un'astrazione comune (`src/lib/mail-providers/`) con i client Gmail/Google Calendar e Microsoft Graph; collegamento dal profilo con stato firmato, cookie e PKCE; token cifrati con la chiave di piattaforma e inclusi nella rotazione; invio dalla propria casella; posta con contatti e lead aperti archiviata sulla cronologia (il resto letto e dimenticato), risposte che fermano le sequenze; impegni del calendario nella disponibilità e nella pagina di prenotazione; appuntamenti scritti nel calendario dell'organizzatore (non ancora le serie ricorrenti). Tre stati: spento senza credenziali, prova solo per il personale senza `MAIL_*_VERIFIED=1`, acceso dopo la verifica del fornitore. **Nessuna casella reale è ancora passata da qui**: il primo test vero arriva con le credenziali verificate. Migrazione 0052, spec `mailbox.json` 28/28 | D-B | XL |
| V3.3 | ~~**Prova autonoma** con approvvigionamento automatico del workspace~~ — *non si fa per ora (D-C): nessuna prova gratuita; i workspace li crea il personale, dalla «richiesta di workspace» (F-09)* | D-C | — |
| V3.4 | ~~Visibilità dei record per titolare e gruppo~~ — *non si fa (D-D): tutti vedono i record del workspace* | D-D | — |
| V3.5 | Link di prenotazione pubblico sul selettore di disponibilità | — | M |
| V3.6 | Modulo web per lead e per ticket (Turnstile, validatori dell'API) | — | M |
| V3.7 | Storia delle fasi, velocità, soglie di ristagno | V1.3 | M |
| V3.8 | Più pipeline | V1.3 | M–L |
| V3.9 | Sequenze con passi «task», giorni lavorativi, thread | V1.2 | M |
| V3.10 | CSAT, report per agente, modulo e stato ticket | V1.1 | M+M |
| V3.11 | Documentazione API pubblica da una fonte; catalogo eventi; Zapier/Make | L9 | M+M |
| — | Dal piano di chiusura: ~~**L9** API di lettura~~ (fatta), **I6** SDI (D1 da scegliere), ~~**I9** incassi~~ (fatto: pagamenti collegati alla fattura oltre che all'ordine, scadenzario dei crediti per età su Finance, evento `invoice.paid`; `src/lib/receivables.ts`, migrazione 0053, spec 11/11), ~~**L2** firma semplice (D5)~~ (fatta: nome, consenso dal server nella lingua del cliente, IP, browser, SHA-256 e byte del PDF conservati; `src/lib/quote-signature.ts`, migrazione 0049, spec 12/12), ~~**L8** provvigioni sul vinto (D6)~~ (fatta: aliquote per persona e pipeline con data di decorrenza, mese approvato e congelato in un solo statement, scostamenti segnalati, vittorie tardive pagate col mese successivo, ognuno vede le proprie; `src/lib/commissions.ts`, migrazione 0051, `/dashboard/pipeline/commissions`, spec 23/23) | D1, D5, D6 | come pianificato |

### Fase 4 — Incassi affidabili

**Decisione R6 (28/09): entrambi i modi di fatturare un acconto, il B come predefinito; riconciliazione bancaria sì**

Oggi un incasso è una riga scritta a mano su un ordine o una fattura, e l'acconto seguito dal saldo
— il caso più comune — non ha una strada: nessuna fattura d'acconto (TD02), una seconda fattura
precompilata con tutto l'ordine, un incasso dall'ordine con due fatture che non si collega più a
nessuna, una sola scadenza per fattura. I numeri di Finanza e della dashboard Amministrazione
ereditano tutto questo.

| ID | Intervento | Taglia |
|---|---|---|
| ~~I10~~ | **Il modello dell'incasso** — *fatto il 28/09: `src/lib/receipts.ts`, migrazione 0059, scheda «Incassi» sull'azienda, spec `receipts.json` 14/14*. Un incasso è un fatto (data di accredito, importo, conto, riferimento CRO/TRN, cliente, origine: a mano, banca, carta); le sue **imputazioni** dicono a quali documenti va, anche più fatture con un bonifico solo. Il non imputato è **credito del cliente**, utilizzabile sulle fatture successive. Rimborsi come movimento negativo legato alla nota di credito. Gli incassi esistenti diventano un incasso con un'imputazione ciascuno. Sull'ordine con più fatture si sceglie la fattura; gli incassi già orfani si collegano a mano; modifica con storico; niente date future; cancellare un incasso di una fattura chiede i permessi della fattura. «Incassato» si calcola sugli incassi (cassa), non sulle imputazioni | L |
| ~~I11~~ | **Acconto e saldo (modo B, predefinito)** — *fatto il 28/09: `src/lib/invoice-deposits.ts`, migrazione 0060, «Fattura d'acconto» e «Fattura di saldo» sull'ordine, spec `deposits.json` 11/11*. Dall'ordine «Fattura d'acconto» (TD02) per importo o percentuale, IVA ripartita per aliquota come l'ordine; «Fattura di saldo» precompilata con le righe dell'ordine **meno lo storno degli acconti** (un rigo per aliquota, col riferimento alla TD02). Sull'ordine: ordinato, fatturato, incassato, da fatturare, da incassare; una fattura oltre il residuo è rifiutata. Un incasso sull'ordine senza fattura è segnalato come **acconto da fatturare**, con la TD02 proposta per quell'importo | L |
| ~~I12~~ | **Rate (modo A)** — *fatto il 29/09: `src/lib/payment-terms.ts`, migrazione 0062, condizioni abituali sul cliente e sulla fattura, rate fissate all'emissione, spec `installments.json` 12/12*. Piano di pagamento sulla fattura (date e importi, modelli 30/70 e 30-60-90 gg d.f.f.m.), condizioni di pagamento predefinite per cliente; XML con `TP01` e un `DettaglioPagamento` per rata; scadenzario per rata, con gli incassi imputati alle rate in ordine di scadenza | M |
| ~~I13~~ | **Riconciliazione bancaria** (progetto sotto) — *fatto il 29/09: `src/lib/bank/`, migrazione 0061, `/dashboard/sales/bank`, spec `bank.json` 22/22. CAMT.053/052/054 e CSV letti nel browser, proposte con motivi, conferma singola, da tastiera e in blocco delle sicure, scelta a mano con credito, incassi già registrati collegati e non duplicati, IBAN imparato. Il flusso automatico PSD2 resta per dopo* | L |
| ~~I14~~ | **Statistiche di cassa verificabili** — *fatto il 29/09, salvo le provvigioni sull'incassato (decisione aperta, vedi D6): `src/lib/cash-stats.ts`, sezione Cassa in Finanza con le definizioni accanto a ogni cifra, estratto conto CSV dal cliente, «Non disponibile» invece di € 0, spec `cash-stats.json` 10/10*. Definizioni scritte accanto a ogni numero; incassi per mese; DSO; riscossione lordo su lordo; acconti da fatturare; estratto conto per cliente esportabile; i numeri di Finanza che oggi sono «vinto e ordini» chiamati così; un errore di caricamento mostrato come errore, non come «€ 0»; provvigioni sull'incassato come opzione (rivaluta D6) | M |

Ordine: I10 per primo (tutto il resto imputa incassi), poi I11 (il modo usato), I13, I12, I14.

**Riconciliazione bancaria (I13): il progetto**

- **Conti.** Uno o più conti del workspace (nome, IBAN, valuta). Ogni incasso dice su quale è arrivato.
- **Movimenti.** Importati da file: **CAMT.053** (lo standard ISO 20022 che le banche italiane
  forniscono via CBI) e **CSV** con una mappatura delle colonne salvata per conto, perché ogni
  banca esporta il suo. Il file si legge **nel browser** (`DOMParser`, `papaparse`, già nelle
  dipendenze): al server arrivano movimenti normalizzati, validati di nuovo, e il bundle del Worker
  non cresce. Un movimento già importato non entra due volte: impronta unica per conto su
  data, importo, riferimento della banca e causale. Import in blocchi, come l'API (tre passaggi,
  niente scritture nel ciclo).
- **Abbinamento.** Una funzione pura, testabile, propone per ogni accredito i documenti con un
  punteggio e i **motivi in chiaro**:
  - numero di fattura nella causale (forte; normalizzato: «FT 12/2026», «fatt. n.12», «12-2026»);
  - IBAN del pagante già visto per quel cliente (forte; imparato a ogni conferma);
  - importo uguale al residuo di una fattura, di una rata o di un acconto da fatturare;
  - somma esatta di più fatture aperte dello stesso cliente (ricerca limitata);
  - nome del pagante simile alla ragione sociale;
  - vicinanza alla scadenza.
- **Lavoro.** Una coda «Da riconciliare» per conto, con la proposta migliore già pronta:
  - **conferma in un gesto**, anche da tastiera;
  - **conferma in blocco** delle proposte sicure;
  - ripartizione su più fatture;
  - «credito del cliente» quando non c'è ancora un documento;
  - «ignora» per commissioni e movimenti non di clienti;
  - annullamento di un abbinamento.

  Niente conferma automatica per impostazione: la precisione vale più della velocità, e la conferma
  in blocco dà la velocità.
- **Uscite.** Gli addebiti sono ignorati, salvo i rimborsi abbinati a una nota di credito.
- **Dopo.** Un flusso automatico dalla banca (PSD2, tramite un aggregatore) dietro un adattatore,
  come la posta: stesso abbinamento, stessa coda; il file resta la via che funziona sempre.

**Dove si innesta il piano di chiusura.** L9, gli ambiti delle chiavi, è il prossimo passo già
deciso, e può correre in parallelo alla Fase 0 perché non tocca le stesse aree. I9 va prima di
V2.9, così la scheda per commerciale può mostrare l'incassato. L8, con la provvigione sul vinto (D6), non dipende più da I9; «sull'incassato» si rivaluta quando I9 ci sarà.

### Fase 5 — Il copilota IA

**D-A rivista il 30/09: un modello dentro Flux, come copilota dell'operatore (opzione A)** · progetto:
[`ia-copilota-in-flux-o-voipai-2026-09.md`](ia-copilota-in-flux-o-voipai-2026-09.md)

Il modello prepara, riassume, estrae e propone; ogni invio e ogni modifica di un dato importante la
conferma una persona (principio 6). Nessuna funzione della fase scrive al cliente da sola.

| ID | Intervento | Dipende da | Taglia |
|---|---|---|---|
| C0 | **Fondamenta.** ~~Il livello del modello~~ — *fatto il 30/09: `src/lib/ai/`, un'interfaccia per ogni fornitore, Gemini per primo, modello e fornitore scelti per compito da variabili d'ambiente, `fetch` semplice senza SDK; spec `ai-provider.json` 10/10*. ~~Il flag nel piano, il limite mensile, l'interruttore del workspace, `ai_suggestion`~~ — *fatto il 30/09: flag «AI copilot» e limite «AI copilot requests / month» in /admin/plans (modulo `ai`, nessuna migrazione di piattaforma), interruttore `ai` in Funzionalità, controllo in `src/lib/ai/access.ts`, porta unica `runAiTask`, tabella `ai_suggestion` (migrazione 0069) con esito deciso da chi ha chiesto, cancellata con la persona; spec `ai-access.json` 9/9*. ~~Il context builder~~ — *fatto il 30/09 con C1–C3: `src/lib/ai/context.ts`*. Contratto col fornitore: chiave a pagamento, dove girano i dati | Fornitore scelto | L |
| ~~C1~~ | *Fatto il 30/09 (sotto, stato di avanzamento).* **Bozza e riscrittura delle email**, dal record e in risposta a un'email in arrivo. Numeri, prezzi, date e importi li inserisce Flux come segnaposto, non il modello. Una persona «seguita dall'assistente» fa comparire un avviso | C0 | M |
| ~~C2~~ | *Fatto il 30/09.* **Sintesi** di record e ticket, anche per chi subentra, con il link a ogni fonte riassunta | C0 | M |
| ~~C3~~ | *Fatto il 30/09.* **Briefing** prima di un appuntamento: chi è, cosa è aperto, cosa è stato promesso | C0 | S–M |
| C4 | **Nota di chiamata strutturata**: dal testo digitato, un riassunto, il prossimo passo e i task proposti, ciascuno con il riferimento al testo | C0, V1.2 | M |
| C5 | **Estrazione come proposte**: budget, decisore, quantità, scadenze. Ogni proposta mostra la differenza e la frase da cui viene, e si conferma dalle server action esistenti | C0 | M |
| C6 | **Classificazione e intento** di ticket ed email in arrivo, correggibili in un clic. Accodate all'`email-worker`, con un budget per giro. Un intento legale (disdetta, revoca del consenso) non si esegue mai da solo | C0 | M |
| C7 | **Informazioni mancanti e prossime azioni dal testo** («mi richiami a marzo»), proposte nella coda di lavoro accanto alle regole di `next-actions.ts` | C0, C5 | M |
| C8 | **Ask CRM e filtri in linguaggio naturale**: strumenti di sola lettura sulle funzioni esistenti, con `requireCapability`; il filtro prodotto si vede e si corregge prima di diventare una vista | C0 | L |
| C9 | **Ricerca semantica** nello storico, solo se la ricerca testuale si dimostra insufficiente: embedding per database di workspace, cancellati con l'erasure | C8 | L–XL |

**Ordine.**
1. C0, poi C1, C2 e C3: usano solo dati che Flux ha già.
2. **Cancello:** prima di andare oltre si misurano il costo per workspace e la quota di bozze accettate senza modifiche. Il limite del piano si fissa su quella misura.
3. Poi C4–C7, poi C8. C9 solo se serve.

Aggiornamenti automatici dei dati, anche solo per task e note, si valutano dopo C7, e solo dove quella
quota lo giustifica.

**Non in Flux:** assistenza vocale in tempo reale e invio automatico di testo generato.

**Opzione B, lasciata aperta per il futuro.** L'autonomia end-to-end resta di VoipAI: rispondere da solo
su voce e WhatsApp, prenotare, prendere ordini, ricontattare. Se un giorno Flux vorrà offrire anche
quella, si appoggerà a VoipAI invece di costruirla. Il primo passo sarà la **continuità per riferimento**
(§6 del progetto):
- il passaggio a una persona è segnalato in Flux senza le parole del cliente;
- la conversazione si legge da VoipAI quando l'operatore la apre, senza copiarla;
- la risposta parte da Flux sul canale di VoipAI.

Poi le eventuali automazioni. Anche il numero WhatsApp proprio di Flux è rimandato, come progetto a sé.
Nessun intervento della Fase 5 chiude queste strade: il modello e il canale di risposta stanno dietro
interfacce, e il copilota lavora sui dati di Flux con o senza VoipAI.

---

## 19. Decisioni da prendere

**Prese il 27 settembre 2026**, domanda per domanda, dopo aver chiarito due serie di risposte
che non coincidevano:

| Decisione | Scelta | Effetto |
|---|---|---|
| D-A · IA | **Rivista il 30 settembre 2026: un copilota dentro Flux (opzione A), VoipAI per l'autonomia end-to-end (opzione B, lasciata aperta).** Con un operatore che conferma ogni output, il contesto di cui il copilota ha bisogno è già in Flux, e la rigidità pensata per parlare da soli col cliente non serve. Le funzioni che richiedono autonomia restano di VoipAI. Il resto di questa cella è la scelta del 27/09, conservata per il suo ragionamento. ~~**Nessun modello dentro Flux, per ora.** L'intelligenza resta in VoipAI, il motore IA del titolare che lavora con i clienti su voce, WhatsApp, SMS ed email e scrive in Flux via API; Flux diventa il posto dove quel lavoro si vede e si controlla. Motivi: i documenti di VoipAI già dicono «Flux racconta, non comanda»; il motore ha fornitori, uscita unica per le azioni, dichiarazione AI Act, mascheramento dei dati e 4.710 test, e rifarli qui duplicherebbe fornitori, DPA, costi e conformità; il prezzo di Flux per utente non porta il costo di un modello. Da rivedere quando ci saranno clienti di Flux senza VoipAI che chiedono bozze o riassunti~~ | V3.1 diventa «Flux per l'assistente» (F1–F5), prima di L2 e L8 (fatta). **Dal 30/09: Fase 5, C0–C9** |
| D-B · Posta | **Gmail e Microsoft 365, entrambi, spenti**: costruiti dietro un'astrazione comune, dormienti e innocui finché non esistono credenziali e verifica del fornitore, e le impostazioni lo dicono. La verifica si avvia quando un cliente la chiede | V3.2 si costruisce |
| D-C · Workspace | **Nessuna prova gratuita, per ora** (confermato il 27 settembre 2026). Il titolare non vuole offrire una prova autonoma; ogni workspace resta un database dedicato creato dal personale, a partire dalla «richiesta di workspace» (F-09). Il modello di approvvigionamento (automatico o condiviso per i piani d'ingresso) si riapre solo se la prova autonoma tornerà in discussione | V3.3 non si fa; nessuna migrazione |
| D-D · Visibilità | **Nessun interruttore**: chiunque, qualunque ruolo, vede tutti i record del workspace in cui è entrato | V3.4 chiusa, non si fa |
| D5 · Firma | **Firma semplice ora** (L2); quella avanzata tramite fornitore resta aperta | L2 si costruisce |
| D6 · Provvigioni | **Sulla trattativa vinta**; «sull'incassato» da rivalutare più avanti | L8 si costruisce, senza attendere I9 |
| R1 · Disiscrizione (27/09) | **Conferma + un clic**: aprire il link non disiscrive, il pulsante sì; le email portano `List-Unsubscribe` e `List-Unsubscribe-Post` (RFC 8058) | Fatto: `/api/unsubscribe` GET chiede, POST agisce |
| R2 · Consenso dalla scheda (27/09) | **Solo marketing**: togliere la spunta manda `consent.withdrawn` con `channel: "marketing"`; i seguiti che la persona ha chiesto continuano | Fatto in Flux; **VoipAI deve gestire il valore `marketing`** |
| R3 · Telefoni (27/09) | **Prefisso del workspace**: un numero senza prefisso è del paese in cui il workspace fattura (Italia se non impostato) | Fatto: opt-out, assistente, cancellazione e accesso ai dati |
| R4 · Correzioni minori (27/09) | Fatte: descrizione del ticket al cliente solo se l'ha scritta lui; il segno dell'assistente appartiene alla chiave che l'ha messo (migrazione 0055); il replay idempotente conserva lo stato (201). **Non fatta, per scelta**: il blocco dei webhook verso nomi che risolvono a IP privati | — |
| R5 · Home «Io / Azienda» (27/09) | Rivista V2.3: la seconda metà è lo **stato dell'azienda**, non un report della squadra, e si chiama «Azienda». Si apre per ruolo (chi gestisce tutti i record → Azienda, gli altri → Io) e poi sull'ultima scelta del browser. In «Io» un quarto numero, **Lead da lavorare** (attivi, propri o non assegnati), che apre la lista filtrata; nei filtri a scelta c'è ora «È vuoto». I dati aziendali si leggono solo quando la metà è aperta | Fatto: `src/lib/home-view.ts` |
| R6 · Incassi (28/09) | **Entrambi i modi di fatturare un acconto** — fattura d'acconto TD02 e saldo con storno (B, **predefinito**), oppure una fattura con rate (A) — e **riconciliazione bancaria** da estratto conto, pensata per la precisione: proposte con motivi, conferma in un gesto o in blocco, niente conferma automatica | Fase 4, I10–I14 |
| R7 · Modello dell'IA (30/09) | **Gemini 2.5 Flash-Lite oggi, sostituibile domani.** Il livello del modello è astratto: un file per fornitore, e modello e fornitore scelti per compito da variabili d'ambiente (`AI_PROVIDER`, `AI_MODEL`, `AI_MODEL_<TASK>`, `AI_PROVIDER_<TASK>`). ⚠️ Google riserva i modelli 2.5 alle chiavi che li hanno già usati: con una chiave nuova si imposta `AI_MODEL` su un modello 3.x Flash-Lite, senza toccare il codice. Chiave a pagamento, perché nei prompt ci sono dati dei clienti | Fatto: `src/lib/ai/` (C0, livello del modello) |
| D1 · SDI | Proposto Namirial; **confronto fatto** con A-Cube, Openapi, Aruba e InfoCert. Criterio decisivo: un contratto partner per molte partite IVA, API REST con webhook di consegna e scarto, sandbox, conservazione a norma inclusa (l'archivio di Flux non lo è), ricezione del passivo. Prossimo passo: preventivi da Namirial (programma partner) e A-Cube su quei quattro punti e sul prezzo per fattura ai volumi attesi. I6 si costruisce dietro un adattatore sostituibile, come la posta | I6 ferma fino alla scelta del fornitore |

Nessuna blocca le Fasi 0 e 1. Accanto a ciascuna c'è la raccomandazione, com'era prima della scelta.

- **D-A · IA dentro il prodotto, con perimetro stretto.** Riaprire la scelta di ottobre per le sole
  funzioni con fonte (§10).
  *Consiglio sì, a partire da bozze e note strutturate, attivabile per workspace e mai con scrittura
  automatica. Da decidere anche il fornitore e dove girano i dati.*
- **D-B · Posta: copia nascosta o collegamento OAuth.**
  *Consiglio la copia nascosta subito (V2.8). La verifica Google per l'OAuth va avviata in parallelo
  se si vuole V3.2 entro sei mesi, perché è una coda esterna.*
- **D-C · Modello di approvvigionamento dei workspace.** Database per cliente creato
  automaticamente, oppure condiviso per i piani d'ingresso.
  *È la decisione più costosa del documento, e condiziona la prova autonoma. Finché sui Worker ogni
  database richiede un binding e un deploy, la prova autonoma su Workers passa solo dalla seconda
  strada o dall'uscita da Hyperdrive (l'app accanto al database, come dice il `CLAUDE.md`).*
- **D-D · Visibilità dei record.** Un interruttore «solo i propri e del gruppo», o nulla.
  *Consiglio l'interruttore, per chi vende a squadre. Niente ruoli configurabili.*
- **D-E · Cosa diventa un task.** Unificare task e attività pianificate con un tipo e un esito,
  lasciando l'attività come registro del già fatto.
  *Consiglio sì; è il presupposto di V1.2, V2.1, V2.4 e V3.1.*
- **D-F · Moduli da spegnere di default.** Progetti (Gantt, carico, dipendenze, RACI, cronometro) e
  Chat.
  *Consiglio spenti per i workspace nuovi, lasciati accesi per quelli che li hanno usati negli
  ultimi 90 giorni.*

---

## Cosa è già solido e va difeso

- **Isolamento tra clienti e superficie pubblica** risolta dai dati.
- **Test per mutazione** sui punti dove un errore costa.
- **Fatturazione elettronica** validata contro lo schema ufficiale, con numerazione e note di
  credito decise dall'istruzione SQL.
- **Calendario sul fuso del workspace**, con le ricorrenze RFC 5545.
- **Sequenze** che si fermano alla risposta, e **coda email** con presa atomica.
- **Lista delle prossime azioni**: il seme giusto per tutto ciò che questo documento chiede alla
  Fase 2.
- **Registro unico delle entità**, che tiene allineati ricerca, creazione e recenti.
- **Lavoro sul mobile**, oltre la media.
- **Documentazione onesta**: il `CLAUDE.md` e il piano di chiusura dicono cosa non funziona e
  perché, ed è il motivo per cui molti rilievi di questo documento si sono potuti verificare in
  pochi minuti.

La lezione che torna da ottobre è la stessa: in Flux i guasti costosi non fanno rumore. Una
chiamata registrata che scrive al cliente, un'automazione persa dietro `after()`, una cifra calcolata
su `updatedAt`: niente di questo appare come un errore. La guardia che ha funzionato per il
confine dell'API, un test che legge il codice e fallisce sulla regola violata, va estesa a quattro
cose:
- le chiamate a `runAutomations` fuori dalla dashboard;
- i link a record che nessuna pagina legge;
- le date di vittoria;
- i confronti di stringhe di ruolo rimasti nel codice.

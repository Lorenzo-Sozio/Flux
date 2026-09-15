# Piano di chiusura Flux

*Flux CRM · piano di lavoro*

Tutti i punti emersi dall'analisi del 15 settembre 2026, ordinati per rischio e dipendenze: prima la fuga di dati attiva, poi le prestazioni che si vedono a ogni login, poi il ciclo commerciale fino alla fattura elettronica.

- **32** attività
- **7** decisioni tue prima di iniziare le fasi 3 e 4
- stima complessiva **≈ 52** giorni di lavoro
- fasi 0 e 1 avviabili subito

## Stato di avanzamento

*Aggiornato il 15 settembre 2026. Il piano originale segue sotto, invariato: questa sezione dice cosa è stato fatto davvero, dove il lavoro si è discostato dal piano e perché.*

### Fatto

Ogni riga è verificata con suite, build e, dove indicato, mutazioni intercettate.

| ID | Esito | Commit |
|---|---|---|
| S1 | Le relazioni verso l'utente caricate intere erano **17**, non 12. La più grave era `GET /api/quotes/public`, che mandava il titolare intero, calendario segreto compreso, al cliente con il link. Ora due insiemi di colonne espliciti, e il pubblico riceve solo nome ed email. | `46e4748` |
| S2 | Guardia che ricava i nomi delle relazioni dallo schema e ignora i commenti. Una delle tre mutazioni è sopravvissuta al primo giro: allargare l'insieme di colonne non era intercettato. Gli insiemi ora sono fissati per intero; 3 mutazioni su 3. | `46e4748` |
| P1 | Cruscotto da **19** viaggi di rete in fila a **7 in parallelo**, non 3. Ridurre ancora avrebbe richiesto `db.execute` con una forma del risultato mai verificata in questo progetto, sulla prima schermata dopo il login. | `ab251a4` |
| P2 | Le tre schede indicate nel piano **non le importava nessuno**: eliminate. Il pacchetto dei grafici, 384 KB, arrivava da `CRMCharts.client.tsx`, ora caricato dopo la pagina. Misurato nella build: il manifesto di `/dashboard/crm` non lo include più. Tolto anche un `@ts-nocheck` che non nascondeva nessun errore. | `ab251a4` |
| P3 | Promemoria: tutte le persone lette in una sola istruzione prima dei due cicli. | `ab251a4` |
| P4 | Non un compare-and-swap ma una sola istruzione `INSERT … ON CONFLICT DO UPDATE … RETURNING`, atomica senza transazione. Trovato un secondo difetto oltre alla corsa: `max()` sul testo mette `ORD-2026-10000` prima di `ORD-2026-9999`, quindi dopo il 9.999esimo ordine dell'anno ogni ordine avrebbe fallito. Migrazione `0018`, 6 mutazioni su 6. | `c271778` |
| P5 | Nuovo ordine e nuovo preventivo caricati dal server. | `4f0b98f` |
| P6 | Thread paginato a 100 elementi con "carica precedenti". Il riepilogo di presa in carico ora è calcolato sul server sull'intero thread: da una pagina sola avrebbe indicato il messaggio di apertura sbagliato senza nessun segno. Pagina caricata dal server. 5 mutazioni su 5. | `7b0795b` · `def0c3e` |
| — | **Fuori piano:** il contatore messaggi di elenco e kanban ticket valeva sempre al massimo 1, perché la query carica un solo messaggio per l'anteprima. | `fda6ad2` |
| O6 | Il provider Google era registrato con le variabili vuote. Ora solo se configurato. L'unico pulsante Google era in un modulo di login che nessuno importava, eliminato. | `7cfcc00` |
| O4 | La chiave cifra tre campi, tutti nel database di piattaforma. La rotazione aveva un buco: in qualunque ordine, per un momento la produzione non avrebbe letto nessun workspace. Ora la decifratura accetta `PLATFORM_ENCRYPTION_KEY_PREVIOUS`, e lo script `npm run rotate:platform-key` parte in prova a secco, blocca tutto se un solo valore è illeggibile, fa il backup dei testi cifrati, scrive solo valori non cambiati nel frattempo, rilegge e verifica, e ha il ripristino. **Non è stato eseguito contro un database**: l'unico configurato è la produzione. Verificati i cinque percorsi di errore con un indirizzo inesistente, e l'SQL della scrittura condizionata. 14 + 8 + 3 test, 12 mutazioni. | `cb8ffe3` · `28cff13` |
| S3 | **Fuori piano, trovata durante O4.** La chiave Resend e la password SMTP di ogni workspace erano in chiaro nel suo database. Ora si cifrano al salvataggio; la lettura accetta entrambe le forme, così i workspace esistenti continuano a inviare il giorno del rilascio; e una riga ancora in chiaro viene cifrata al primo invio, con scrittura condizionata. La maschera rimandata dal modulo non sovrascrive più una chiave vera. Guardia sui due punti reali di salvataggio e lettura. 12 test, 5 mutazioni. | `c98bb72` |
| L1 | Nuova azione **Assign Owner (round robin)** per lead, contatti, aziende e deal. Non un compare-and-swap sul turno ma lo stesso contatore atomico di P4, con una sequenza per regola: due lead simultanei vanno a due persone diverse. Tre regole oltre al piano, ognuna contro un'assegnazione che sembra riuscita: riceve solo chi è **ancora membro** del workspace (letto dal registro di piattaforma, non dalla tabella utenti che sopravvive all'uscita); un record **già assegnato** resta a chi lo ha, salvo opzione esplicita, e non consuma il turno di nessuno; la scrittura è **condizionata** all'assenza di titolare, così un'assegnazione a mano arrivata un attimo prima vince. Il nuovo titolare di un lead riceve la notifica (e il push); la modifica fa scattare le regole su aggiornamento come qualunque altra. Test su un database finto che valuta davvero le condizioni; 31 test, 12 mutazioni su 12 (una sopravvissuta al primo giro: il test accettava il messaggio d'errore sbagliato). Voce nel Help Centre. | commit successivo |

### Prossimi passi, in quest'ordine

Nessuno richiede decisioni. Ciascuno si chiude con test, mutazioni dove un errore costa, build verde e questa sezione aggiornata.

| # | ID | Attività | Perché in questa posizione |
|---|---|---|---|
| 1 | L4 | Territori | Autonoma, e serve a L5. |
| 2 | L5 | Assegnazione per regola | Dipende da L1 (fatta) e L4. |
| 3 | L7 | Contratti e rinnovi | Autonoma. |
| 4 | L6 | Sequenze di follow-up | La più grande del gruppo, per ultima. |

### Da fare sulla dashboard Cloudflare

- **O1** verificare che il deploy arrivi dopo il prossimo push. Al 15 settembre il `main` locale è avanti di 8 commit rispetto al remoto.
- **O2** cifrare le sei variabili in chiaro. Da riga di comando non si può: l'API rifiuta un secret con il nome di una variabile esistente.
- **O3** ruotare subito `CRON_SECRET`, `IMPORT_API_KEY`, `ADMIN_SESSION_SECRET`; `AUTH_SECRET` e la password Neon in una finestra concordata; `PLATFORM_ENCRYPTION_KEY` seguendo la procedura in cima a `scripts/rotate-platform-key.ts`, dopo il deploy che contiene `cb8ffe3`.
- **O5** cancellare `NXTAUTH_URL`.

### In attesa di decisioni

| Decisione | Sblocca | Nota |
|---|---|---|
| D1 canale SDI e fornitore | I6 | L'unica parte della fatturazione che dipende davvero dal fornitore. |
| D2 perimetro fiscale · D3 origine della fattura | I1–I5, I7, I8 | Costruibili sul perimetro raccomandato appena confermato. |
| D4 forma dei listini | L3 | |
| D5 firma semplice o avanzata | L2 | |
| D6 provvigione su vinto o su incassato | L8 | Su incassato richiede anche I9. |
| D7 ambiti delle chiavi API | L9 | |

### Correzioni al piano sotto

- **S1** parla di dodici relazioni: erano diciassette.
- **P1** promette tre viaggi: sono sette, in parallelo.
- **P2** indica le tre schede della pagina iniziale: erano orfane, il costo era altrove.
- **I4** descrive un compare-and-swap: il contatore esiste già, `src/lib/document-counter.ts`, ed è una sola istruzione. Per le fatture il numero va assegnato all'emissione nella stessa istruzione, perché lì i buchi non sono ammessi.

---

## Stima per fase

| Fase | Giorni |
|---|---:|
| Fase 0 · Sicurezza | 1,0 |
| Fase 1 · Prestazioni | 7,25 |
| Fase 2 · Operatività | 1,5 |
| Fase 3 · Fatturazione | 17,5 |
| Fase 4 · Flusso commerciale | 25 |

Le stime includono test, migrazioni, documentazione API e Centro assistenza per ogni attività. Sono stime, non impegni.

---

## Fase 0 · Chiudere la fuga del calendario

**Subito · nessuna decisione**

Dodici query relazionali caricano l'utente intero e lo mandano al browser, compreso l'indirizzo iCal segreto con cui si legge il calendario privato di una persona. Chiunque apra un ticket, un preventivo o una chat lo riceve per ogni autore.

| ID | Attività | Fatto quando | Stima |
|---|---|---|---|
| S1 | **Colonne esplicite nelle dodici relazioni verso l'utente**<br>Sostituire `sender: true`, `owner: true`, `actor: true` e simili con `columns: { id, name, email, image }`.<br>*support.ts ×6 · quotes.ts ×2 · chat-internal.ts ×2 · targets.ts ×1 · e la dodicesima trovata dalla guardia S2* | Il payload del dettaglio ticket non contiene `externalCalendarUrl` né `password` | 0,5 g |
| S2 | **Guardia che impedisce di rifarlo**<br>Test strutturale che fallisce su qualunque relazione verso la tabella utenti caricata per intero, più mutazione che la reintroduce.<br>*src/lib/user-columns.test.ts · scripts/mutations* | Rimettere `sender: true` rende rossa la suite | 0,5 g |

## Fase 1 · Prestazioni che si vedono a ogni login

**Subito · nessuna decisione**

Prima le correzioni piccole con effetto sulla prima schermata, poi le due pagine grandi. Il dettaglio ticket è la schermata più usata dell'assistenza, quindi va rifatto per ultimo e con cura.

| ID | Attività | Fatto quando | Stima |
|---|---|---|---|
| P1 | **Cruscotto CRM da 13 viaggi a 3**<br>Un conteggio con `FILTER` per i totali, un `GROUP BY` per fase al posto di una query per fase, il resto in parallelo.<br>*src/actions/dashboard.ts · getDashboardStats* | Test con doppio che conta le istruzioni: al massimo 3 | 0,5 g |
| P2 | **Grafici caricati quando servono**<br>`next/dynamic` nei 15 componenti che importano la libreria dei grafici, iniziando dalle tre schede della pagina iniziale.<br>*crm/_components · pipeline · reports · finance · components/ui/chart.tsx* | Il pacchetto di `/dashboard/crm` nel report di build scende, con misura prima e dopo | 1 g |
| P3 | **Promemoria: utenti letti una volta**<br>Una sola query `inArray` per tutti gli utenti delle attività in scadenza.<br>*src/app/api/cron/task-reminders/route.ts* | Nessun `await` sul database dentro il ciclo | 0,25 g |
| P4 | **Numerazione ordini senza corsa**<br>`max()+1` senza transazione dà lo stesso numero a due ordini simultanei. Passa al contatore di I4.<br>*src/lib/order-number.ts* | Test con due richieste concorrenti: numeri diversi | 0,5 g |
| P5 | **Nuovo preventivo e nuovo ordine caricati dal server**<br>La pagina server legge i dati del modulo e li passa come props; la parte interattiva resta client.<br>*sales/quotes/new · sales/orders/new* | Il modulo compare popolato al primo disegno, senza spinner | 2 g |
| P6 | **Dettaglio ticket caricato dal server, thread paginato**<br>Pagina server con gli ultimi 50 messaggi e "carica precedenti"; registro delle modifiche su richiesta; le parti interattive diventano componenti client più piccoli.<br>*support/tickets/[id]/page.tsx · 1.569 righe · getTicketById* | Primo disegno con il ticket visibile; un thread da 500 messaggi ne carica 50 | 3 g |

## Fase 2 · Operatività e credenziali esposte

**Da parte tua, più una procedura da scrivere**

Le credenziali incollate in conversazione vanno considerate esposte. Tre si ruotano gratis; la chiave di cifratura della piattaforma no, perché cifra le stringhe di connessione di ogni cliente, e per ruotarla serve prima una procedura.

| ID | Attività | Chi | Stima |
|---|---|---|---|
| O1 | **Verificare che il deploy dal push sia arrivato**<br>L'ultima distribuzione registrata era un cambio di secret del 7 settembre. | tu | — |
| O2 | **Cifrare le sei variabili dalla dashboard**<br>Workers → flux → Settings → Variables and Secrets, cifratura sul posto. Da riga di comando l'API rifiuta il nome già in uso. | tu | — |
| O3 | **Ruotare subito le credenziali a costo nullo**<br>`CRON_SECRET`, `IMPORT_API_KEY`, `ADMIN_SESSION_SECRET`. Poi `AUTH_SECRET` in una finestra concordata, perché fa rifare il login a tutti, e la password Neon dentro `DATABASE_URL`. | tu | — |
| O4 | **Procedura di rotazione della chiave di cifratura**<br>Script che decifra ogni `tenants.db_url` con la chiave vecchia e lo ricifra con la nuova, con prova a secco, verifica di apertura di ogni database e ritorno indietro.<br>*scripts/rotate-platform-key.mjs* | sviluppo, poi tu | 1 g |
| O5 | **Cancellare `NXTAUTH_URL` dalla dashboard**<br>Nome sbagliato e porta 3000 nel valore. | tu | — |
| O6 | **Accesso con Google: configurarlo o nasconderlo**<br>Le due variabili sono vuote. Se il pulsante compare comunque, va mostrato solo quando sono impostate. | sviluppo | 0,5 g |

## Fase 3 · Fatturazione elettronica

**Dopo le decisioni D1, D2, D3**

Chiude la catena lead, trattativa, preventivo, ordine, pagamento. Oggi le aziende hanno `vatNumber`, `sdiCode` e l'indirizzo; mancano codice fiscale e PEC, e manca del tutto il profilo di chi emette. I totali per riga con IVA esistono già e si riusano.

| ID | Attività | Fatto quando | Stima |
|---|---|---|---|
| I1 | **Profilo emittente per workspace**<br>Denominazione, P.IVA, codice fiscale, regime fiscale RF01…RF19, sede, REA facoltativo, IBAN. Migrazione additiva.<br>*schema · settings/fatturazione* | Una fattura non si emette se il profilo è incompleto, e la schermata dice cosa manca | 1 g |
| I2 | **Dati fiscali del cliente**<br>Codice fiscale e PEC sull'azienda; validazione di P.IVA, codice fiscale e codice destinatario a 7 caratteri, con PEC come alternativa. | Emissione bloccata senza un recapito valido, con il campo indicato | 1 g |
| I3 | **Fattura e righe**<br>Tabelle `invoice` e `invoice_item`, stati da bozza a consegnata o scartata, legame con l'ordine d'origine, totali da `document-totals`. | Una fattura in bozza nasce da un ordine con le sue righe | 2 g |
| I4 | **Numerazione progressiva per anno e sezionale**<br>Contatore con compare-and-swap, la stessa tecnica dell'idempotenza, perché il driver non ha transazioni. Il numero si assegna all'emissione, mai in bozza. Riusato da P4.<br>*src/lib/document-counter.ts* | Test concorrente senza doppioni né buchi, mutazioni che rompono il CAS | 1,5 g |
| I5 | **XML FatturaPA**<br>Generazione del tracciato 1.2.x per TD01 e TD04, con Natura IVA sulle righe esenti e bollo virtuale. | Ogni fixture di test valida contro lo schema XSD ufficiale | 3 g |
| I6 | **Invio e esiti tramite il canale scelto**<br>Invio dell'XML; webhook per ricevuta di consegna, scarto, mancata consegna ed esito; stato aggiornato in modo idempotente e notifica al titolare. | Uno scarto arriva in campanella con il motivo leggibile | 3 g |
| I7 | **Copia di cortesia e archiviazione**<br>PDF leggibile per il cliente; XML e ricevute salvati su R2. | Il cliente riceve il PDF, l'XML resta scaricabile dalla fattura | 1,5 g |
| I8 | **Note di credito**<br>TD04 collegata alla fattura d'origine, totale o parziale. | Stornare una fattura aggiorna il residuo da incassare | 1,5 g |
| I9 | **Da ordine a incasso**<br>Pagamenti collegati alla fattura oltre che all'ordine; scadenzario dei crediti su finance. | Finance mostra fatture scadute e non incassate | 3 g |

## Fase 4 · Flusso commerciale completo

**Dopo le decisioni D4, D5, D6, D7**

Ordinate in modo che ciascuna trovi pronto quello da cui dipende: i territori prima delle regole di assegnazione che li usano, la fatturazione prima delle provvigioni sull'incassato.

| ID | Attività | Dipende da | Stima |
|---|---|---|---|
| L1 | **Assegnazione automatica dei lead a rotazione**<br>Nuova azione `assign_owner` del motore di automazione; il turno salvato in tabella con compare-and-swap, così due lead simultanei non vanno alla stessa persona. | — | 2 g |
| L2 | **Firma del preventivo**<br>Firma elettronica semplice sulla pagina pubblica: nome digitato, consenso, IP, data e hash SHA-256 del PDF congelato al momento della firma, nel registro del preventivo. | D5 | 2 g |
| L3 | **Listini**<br>Listino con prezzi o sconto sul prezzo base, assegnato all'azienda; il selettore prodotto di preventivo e ordine propone il prezzo del listino del cliente. | D4 | 3 g |
| L4 | **Territori**<br>Territori per paese, regione o provincia; usati in assegnazione e nei report, non nella visibilità dei record. | — | 2 g |
| L5 | **Assegnazione per regola**<br>Regole su fonte e territorio in cima alla rotazione di L1. | L1 · L4 | 1 g |
| L6 | **Sequenze di follow-up**<br>Passi con ritardo e modello; esecuzione nella coda email esistente; si fermano alla risposta del cliente usando la posta in arrivo già collegata, e all'opt-out. Guardia dei lavori ripetuti estesa. | — | 5 g |
| L7 | **Contratti e rinnovi**<br>Valore ricorrente, periodicità, scadenza e preavviso; avviso di scadenza sul lavoro giornaliero esistente; ricavo ricorrente mensile sul cruscotto. | — | 3 g |
| L8 | **Provvigioni**<br>Regole per commerciale; maturazione su trattativa vinta o su incasso; report per periodo. | D6 · I9 | 3 g |
| L9 | **API di lettura**<br>GET con cursore per contatti, lead, aziende, trattative e ordini, filtro `updatedSince` per riconciliare; ambiti lettura e scrittura sulle chiavi API, che oggi scrivono tutto con una chiave sola. | D7 | 4 g |

---

## Decisioni tue

### Cosa serve sapere prima delle fasi 3 e 4

Nessuna blocca le fasi 0, 1 e 2. Accanto a ciascuna c'è la mia raccomandazione.

- **D1 · Canale verso lo SDI.** Intermediario via API oppure accreditamento diretto presso l'Agenzia delle Entrate.
  *Consiglio un intermediario: l'accreditamento diretto richiede una procedura propria, un canale certificato e la gestione della conservazione. La scelta del fornitore e il suo costo sono tuoi.*
- **D2 · Perimetro fiscale della prima versione.**
  *Consiglio fattura e nota di credito, IVA ordinaria con Natura per le esenzioni, bollo virtuale. Split payment, ritenuta d'acconto e reverse charge in una seconda versione.*
- **D3 · Da cosa nasce una fattura.** Un ordine, più ordini dello stesso cliente, oppure acconti e saldo.
  *Consiglio un ordine per fattura all'inizio, con acconti in seguito.*
- **D4 · Forma dei listini.** Prezzi espliciti per prodotto oppure una percentuale sul prezzo base.
  *Consiglio entrambi, con la percentuale come caso comune.*
- **D5 · Valore della firma sul preventivo.** Firma elettronica semplice in casa oppure avanzata tramite un fornitore.
  *Per una conferma d'ordine fra aziende la semplice è normalmente sufficiente; l'avanzata si aggiunge dopo se un cliente la chiede.*
- **D6 · Quando matura una provvigione.** Alla trattativa vinta oppure all'incasso.
  *Consiglio all'incasso, che è il motivo per cui L8 viene dopo la fatturazione.*
- **D7 · Ambiti delle chiavi API.** Oggi una chiave sola scrive tutto.
  *Consiglio chiavi separate per lettura e scrittura prima di aprire la lettura: una chiave data a uno strumento di report non deve poter importare.*

## Sequenza consigliata

1. **S1, S2** subito: è l'unico punto con un danno in corso.
2. **O1, O3** in parallelo da parte tua, e **O4** scritta prima di toccare la chiave di cifratura.
3. **P1, P2, P3, P4**: piccole, visibili, e P4 prepara il contatore che serve alla fatturazione.
4. Le decisioni **D1, D2, D3**, mentre si lavora su **P5** e **P6**.
5. **I1 → I9** in quest'ordine: ognuna usa la precedente.
6. **L1, L2, L4, L6, L7** non dipendono da altro e possono sovrapporsi; poi **L3, L5, L9** dopo le rispettive decisioni; **L8** per ultima.

## Regole di chiusura

*Valgono per ogni attività.*

- **Migrazioni additive** — Solo tabelle e colonne nuove e aggiornamenti protetti: il driver non ha transazioni.
- **Test dove un errore costa** — Isolamento fra clienti, numerazione, importi e API, ognuno con le sue mutazioni.
- **Nessuna scrittura dentro un ciclo** — Leggere il lotto in una istruzione e scrivere a blocchi.
- **Documentazione allineata** — Ogni rotta nuova nella documentazione API, con la guardia che lo verifica.
- **Centro assistenza in italiano** — Una risposta per ogni comportamento che una persona vede cambiare.
- **Solo funzioni asincrone nei moduli server** — Le costanti vanno in `src/lib`, altrimenti la build di produzione fallisce.

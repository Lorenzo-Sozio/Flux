# Piano di chiusura Flux

*Flux CRM · piano di lavoro*

Tutti i punti emersi dall'analisi del 15 settembre 2026, ordinati per rischio e dipendenze: prima la fuga di dati attiva, poi le prestazioni che si vedono a ogni login, poi il ciclo commerciale fino alla fattura elettronica.

- **32** attività
- **7** decisioni tue prima di iniziare le fasi 3 e 4
- stima complessiva **≈ 52** giorni di lavoro
- fasi 0 e 1 avviabili subito

## Stato di avanzamento

*Aggiornato il 16 settembre 2026. Il piano originale segue sotto, invariato: questa sezione dice cosa è stato fatto davvero, dove il lavoro si è discostato dal piano e perché.*

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
| L1 | Nuova azione **Assign Owner (round robin)** per lead, contatti, aziende e deal. Non un compare-and-swap sul turno ma lo stesso contatore atomico di P4, con una sequenza per regola: due lead simultanei vanno a due persone diverse. Tre regole oltre al piano, ognuna contro un'assegnazione che sembra riuscita: riceve solo chi è **ancora membro** del workspace (letto dal registro di piattaforma, non dalla tabella utenti che sopravvive all'uscita); un record **già assegnato** resta a chi lo ha, salvo opzione esplicita, e non consuma il turno di nessuno; la scrittura è **condizionata** all'assenza di titolare, così un'assegnazione a mano arrivata un attimo prima vince. Il nuovo titolare di un lead riceve la notifica (e il push); la modifica fa scattare le regole su aggiornamento come qualunque altra. Test su un database finto che valuta davvero le condizioni; 31 test, 12 mutazioni su 12 (una sopravvissuta al primo giro: il test accettava il messaggio d'errore sbagliato). Voce nel Help Centre. | `4874636` |
| L4 | **Territori** per paese, regione o provincia e prefisso CAP, in Impostazioni → Territori (solo admin), e report **Pipeline → Per territorio**. Scelta diversa dal piano, che non la specificava: il territorio **non è salvato sui record** ma calcolato dall'indirizzo. Salvarlo avrebbe richiesto di aggiornarlo in ogni punto che scrive un indirizzo (modale, import API, conversione, fusione, ticket da email), e il primo dimenticato avrebbe lasciato record nel territorio sbagliato; così una modifica ai territori vale subito anche per i record vecchi. Gli indirizzi sono testo libero, quindi l'abbinamento normalizza: paese per codice, nome inglese o italiano; le 107 province (più le vecchie sigle sarde) per sigla o nome, ricadenti nella loro regione; una sigla è letta come italiana solo su un indirizzo italiano o senza paese (CA è Cagliari, non la California). Vince il territorio più stretto, a parità il nome. Il primo giro di test ha trovato un difetto vero: un territorio «MI» prendeva ogni record scritto «Lombardia». La schermata mostra come legge ogni voce e segnala quelle non riconosciute, e ha una prova di indirizzo. Report in tre istruzioni qualunque sia la dimensione (raggruppate per indirizzo distinto), con la riga «Nessun territorio» sempre presente; periodi su `created_at`, `converted_at`, `closed_at`, mai su `updated_at`. Migrazione `0019`, additiva. 26 test sull'abbinamento, 18 sul report, 6 di guardia sulle azioni; 24 mutazioni, tutte intercettate. Voce nel Help Centre. | `17eec55` · `7b2cc97` · `2fd5149` |
| L5 | **Instradamenti** dentro l'azione di assegnazione: elenco ordinato di territori e/o fonti, ciascuno con le proprie persone a rotazione, più la rotazione generale per il resto. Scelta diversa dal piano («regole su fonte e territorio»): le regole di automazione **girano in parallelo**, quindi più regole che assegnano lo stesso lead si sarebbero contese il record, avrebbe vinto una a caso e la perdente avrebbe consumato un turno. Un elenco ordinato in una sola azione è l'unico modo in cui «vince la prima» significa qualcosa. Ogni instradamento ha la propria sequenza; la rotazione generale mantiene quella delle regole scritte con L1, che continuano identiche. Un instradamento i cui membri sono tutti usciti passa il record al successivo; nessuna corrispondenza e nessuna rotazione generale lascia il record senza assegnatario senza consumare turni. Un territorio cancellato non allarga l'instradamento a tutti i record. Una trattativa è collocata dall'indirizzo dell'azienda o del contatto. Il finto contatore dei test di L1 condivideva un solo numero di turno tra tutte le sequenze: corretto, era lui a far fallire due test nuovi, non il codice. 11 test sull'instradamento, 11 nuovi sull'azione; 24 mutazioni su 24. Voce nel Help Centre. Migrazioni `0018` e `0019` applicate a entrambi i workspace il 15 settembre 2026 con `npm run migrate:tenants`, verificate leggendo le tabelle; le query del report territori eseguite in sola lettura sui dati reali, con i totali coerenti. | `a5d5d91` |
| L7 | **Contratti e rinnovi** in Vendite → Contratti: valore ricorrente, periodicità, inizio, fine, preavviso, rinnovo automatico. Lo stato **non è salvato**: «in vigore», «da decidere», «scaduto» cambiano col calendario e sono calcolati dalle date; si salvano solo le decisioni umane (bozza, disdetto). Date come giorni di calendario, senza fuso; un mese dopo il 31 gennaio è fine febbraio, e i rinnovi successivi ripartono dalla scadenza originale per non slittare. Correzione al piano trovata scrivendo il job: l'avviso «alla data limite del preavviso» sarebbe arrivato l'ultimo giorno utile, quando un contratto a rinnovo automatico è di fatto già rinnovato. Ora parte **un mese prima** della data limite. Avviso sul lavoro giornaliero `task-overdue-check` (nessun nuovo trigger, i cinque del piano Free sono occupati): una volta per periodo, con presa condizionale su `notice_sent_for` legata alla data di scadenza, così il periodo successivo ha il suo avviso; se la notifica fallisce la presa viene restituita. Notifica `contract_renewal`, push attivo di default. Ricavo ricorrente mensile (e annuo) sulla pagina e sul cruscotto, solo sui contratti in vigore oggi; la griglia del cruscotto passa a 4 colonne per 8 schede. **Trovato dalla guardia esistente sulle fusioni:** unendo due aziende o due contatti, i contratti del duplicato sarebbero rimasti orfani; ora vengono spostati. Migrazione `0020`, additiva, applicata a entrambi i workspace e verificata con le query della pagina e del job in sola lettura. 26 test sui termini, 9 sugli avvisi, 6 di guardia sulle azioni; 22 mutazioni, tutte intercettate. Voce nel Help Centre. | `58d3871` |
| — | **Fuori piano, trovata studiando L6: le campagne email non potevano partire.** Il link di disiscrizione era firmato con `NEXTAUTH_SECRET`, che nessun ambiente imposta (Auth.js v5 usa `AUTH_SECRET`, ed è quello presente in produzione e chiesto dal controllo delle variabili). Generare il link lanciava un'eccezione, e ogni invio si fermava al primo destinatario lasciando una riga di log «in coda» e nessuna email: una campagna che sembra ancora in invio. Ora usa gli stessi segreti, nello stesso ordine, dei link di tracciamento nella stessa email. Nessun link era mai stato firmato col vecchio nome, quindi nessuno smette di funzionare. ⚠️ Conseguenza per O3: ruotare `AUTH_SECRET` (se `TRACKING_SECRET` non è impostato) invalida i link di disiscrizione nelle email già inviate; conviene impostare prima un `TRACKING_SECRET` dedicato. 4 test, 2 mutazioni. | `a976b95` |
| — | **Fuori piano, trovata studiando L6: la coda email poteva inviare due volte.** Il worker prendeva i job con `SELECT … FOR UPDATE SKIP LOCKED` e li segnava in una seconda istruzione; sul driver HTTP non c'è transazione che tenga il blocco, quindi due esecuzioni sovrapposte leggevano e inviavano gli stessi job. Ora la presa è un'unica `UPDATE … WHERE status = 'pending' RETURNING` e si invia solo ciò che si è vinto. Prerequisito delle sequenze, che passano dalla stessa coda. ⚠️ Resta aperto: un job rimasto «processing» perché il worker si è interrotto a metà non viene mai ripreso. Riprenderlo rischia il doppio invio se l'email era partita; va deciso se preferire la perdita o il duplicato. 5 test, 2 mutazioni. | `82b2195` |
| L6 | **Sequenze di follow-up** in Marketing → Sequenze: passi con attesa in giorni, oggetto e testo (caricabile da un modello), per lead o contatti; iscrizione dalla scheda o con la nuova azione di automazione «Enroll in Sequence»; elenco iscritti con fermata manuale. Invio nella coda email esistente, dal worker di ogni minuto (nessun nuovo trigger). Si ferma alla **risposta** (dalla posta in arrivo, prima di ogni uscita anticipata), alla **disiscrizione** (link proprio `seq:` e anche da campagna), al **rimbalzo o reclamo**, alla conversione o eliminazione del lead e al cambio d'indirizzo; la fermata annulla l'email già in coda. Il titolare riceve la notifica `sequence_reply`, push attivo di default. Robustezza: una sola iscrizione attiva per sequenza e indirizzo con **indice unico parziale**; ogni passo preso con aggiornamento condizionato su `next_step` e restituito se la coda fallisce; lista di esclusione ricontrollata a ogni invio; passi salvati con upsert più cancellazione della coda, così un'interruzione non svuota mai una sequenza. **Tre difetti preesistenti trovati e chiusi per arrivarci:** la disiscrizione che impediva l'invio di ogni campagna, la coda che poteva inviare due volte (righe sopra), e il webhook dei rimbalzi che riconosceva solo le email di campagna — ora la coda salva l'id del messaggio. La guardia sulle fusioni ha imposto di spostare anche le iscrizioni, e da lì la regola «si invia solo all'indirizzo d'iscrizione». Due difetti di interfaccia corretti prima del commit: l'editor che perdeva il focus alla prima lettera e un messaggio tradotto con graffe che next-intl avrebbe rifiutato. ⚠️ **Il rilevamento delle risposte richiede la ricezione della posta configurata**: in produzione i secret relativi non risultano impostati, e la pagina lo segnala. Una risposta automatica (fuori sede) ferma la sequenza. Nessun tracciamento di aperture e clic sulle email delle sequenze. Migrazione `0021`, additiva, applicata a entrambi i workspace e verificata (tabelle, indice unico parziale, colonne della coda, query del motore e del webhook in sola lettura). 18 test sulle regole, 17 sul motore, 7 sugli agganci, 4 sull'azione di automazione, 8 di guardia sulle azioni; 29 mutazioni, tutte intercettate. Voce nel Help Centre e sezione in CLAUDE.md. | `16831fb` |
| I1 · I2 | **Profilo emittente e dati fiscali del cliente.** Impostazioni → Fatturazione elettronica (solo admin): denominazione, P.IVA, codice fiscale, regime RF01–RF19 (RF03 ritirato escluso), sede, blocco REA facoltativo ma tutto-o-niente, IBAN, contatti; si salva anche incompleto e un riquadro elenca campo per campo cosa manca. Sull'azienda codice fiscale e PEC, nel modulo, nell'API di import e nella sua documentazione; la scheda azienda dice cosa manca per fatturare a quel cliente. Controlli sui numeri reali (P.IVA di ENI e TIM, codice fiscale d'esempio, IBAN d'esempio di Banca d'Italia), non su valori generati dall'algoritmo; il limite noto del checksum della P.IVA (scambio 0↔9 non rilevabile) è annotato nel test. I controlli bloccano l'**emissione**, mai il salvataggio: import e dati storici non si perdono. Cliente italiano: P.IVA o codice fiscale, e codice destinatario o PEC se azienda; cliente estero senza identificativi italiani; provincia in sigla e CAP a 5 cifre. Migrazione `0022`, additiva, applicata e verificata. 26 test, 6 di guardia; 19 mutazioni. | `00a52b1` |
| — | **Fuori piano: le migrazioni tenant girano su un Postgres reale nei test.** PGlite (Postgres 18 in WebAssembly, dipendenza di sviluppo) applica tutte le migrazioni e poi riesegue ciascuna: la regola «ogni migrazione è rieseguibile» era solo scritta. Tutte si applicano; l'unica non rieseguibile è la `0002`, precedente alla regola e già applicata ovunque, nominata come eccezione. | `9430a30` |
| I3 · I4 | **Fatture da ordine e numerazione senza buchi.** Vendite → Fatture; dal pulsante «Fattura» sull'ordine nasce una bozza con righe e sconto (una bozza per ordine alla volta). La bozza si modifica: righe, Natura IVA sulle righe a 0%, sezionale, scadenza, sconto, modalità di pagamento, bollo virtuale suggerito sopra € 77,47 di righe senza IVA (escluse esportazioni e cessioni UE) e confermato a mano. Un riquadro elenca cosa manca: emittente, cliente, bozza. **Emissione in un'unica istruzione SQL**: blocca la bozza, fa avanzare il contatore solo se è ancora bozza alla revisione verificata, assegna numero per sezionale e anno, data italiana (non UTC: la prima fattura del 1° gennaio prende il nuovo anno) e congela emittente, cliente **e righe**; una fattura emessa si legge solo dalla fotografia. Verificata su Postgres reale (PGlite): numeri in ordine, doppio clic senza numeri consumati, bozza cambiata rifiutata senza consumare numeri, sequenze separate, indice unico che rifiuta il doppione anche aggirando il codice. Eseguita anche su Neon in produzione su un id inesistente, senza effetti, per validarne sintassi e parametri. Emettere richiede `invoice:issue` (admin), le bozze `invoice:write` (editor). Trovata e chiusa in scrittura una corsa tra salvataggio ed emissione (da cui la fotografia delle righe). La guardia sulle fusioni ha imposto di spostare le fatture con l'azienda. Il bollo non entra nel totale: è solo il dato del tracciato. Migrazione `0023`, additiva, applicata e verificata. 35 test (7 su Postgres reale), 9 di guardia; 19 mutazioni (una equivalente tolta con motivazione). | `e446642` |
| — | **Bollo automatico e professionale (richiesto il 15 settembre 2026).** Il suggerimento di I3 era sbagliato in due punti: considerava dovuti San Marino (N3.3), le assimilate (N3.4) e il regime del margine (N5), che non lo sono. Ora il bollo si **decide dalle Nature**, non da una casella: dovuto sopra € 77,47 delle sole righe senza IVA che lo richiedono, dopo lo sconto; esenti N3.1, N3.2, N3.3, N3.4; **dovuto sulla dichiarazione d'intento (N3.5)**; non applicabile al margine (N5). La bozza mostra esito e motivo; la forzatura (applica/non applicare) richiede un motivo scritto, altrimenti la fattura non si emette. **Rivalsa** configurabile sul profilo emittente: riga «Imposta di bollo assolta in modo virtuale» € 2,00 N1, esclusa dal calcolo della soglia e mai duplicata; il bollo viene ricalcolato all'emissione dalle righe congelate, non preso dalla bozza. **Riepilogo trimestrale** nella pagina Fatture: importo, codice tributo F24 2521–2524, scadenza con i rinvii sotto € 5.000 (DL 73/2022) e lo slittamento del fine settimana (festività escluse), dichiarato come stima rispetto all'importo pubblicato dall'Agenzia. Migrazione `0024`, additiva, applicata e verificata. 19 test sulle regole; 15 mutazioni sul bollo e 19 sulle fatture. Voci nel Help Centre su emissione e bollo. | `09d879f` |
| I5 | **Tracciato XML FatturaPA** (FPR12, schema 1.2.3, specifiche 1.4), scaricabile da ogni fattura emessa e costruito dai dati congelati all'emissione: lo stesso file anche tra un anno. **Validato contro lo schema ufficiale** dell'Agenzia, non contro una lettura delle specifiche: gli XSD sono nel repository con l'hash fissato nel test e la validazione gira con libxml2 compilato in WebAssembly, su sei casi reali (cliente con codice SDI, solo PEC con bollo addebitato, estero intracomunitario, privato con solo codice fiscale, aliquote miste con sconto, testi con caratteri non ammessi). ⚠️ **Correzione al calcolo, trovata qui:** SDI ricalcola l'IVA **per aliquota** e pretende che l'imponibile sia la somma dei totali di riga. Il calcolo comune a preventivi e ordini arrotonda riga per riga e distribuisce lo sconto dentro le righe: con abbastanza righe la fattura verrebbe scartata. Le fatture ora usano `invoiceTotals`, che raggruppa per aliquota e Natura, calcola l'IVA una volta per gruppo e scrive lo sconto come riga negativa per gruppo, ripartita al centesimo; lo usano bozza, emissione, soglia del bollo e XML, quindi le cifre mostrate sono quelle trasmesse. Aggiunto il regime **RF20** (franchigia transfrontaliera, 2025) presente nello schema corrente. Testo ridotto a Latin-1 (l'euro, le virgolette tipografiche e le emoji fanno scartare il file). Endpoint `/api/invoices/{id}/xml` documentato, come impone la guardia sulla documentazione. 15 test sull'XML (tutti validati contro l'XSD), 7 sui totali; 15 mutazioni. Voce nel Help Centre e sezione in CLAUDE.md. **Resta fuori l'invio (I6), che dipende dalla decisione D1.** | `a7dd802` |
| — | **Verifica di usabilità e interfacce (16 settembre 2026, su richiesta).** Il contratto si scrive in una pagina come il preventivo, con l'anteprima di fase, scadenza e data del promemoria mentre si compilano le date. Il pulsante di iscrizione alle sequenze è nascosto senza modulo marketing (apriva un dialogo le cui azioni il server rifiutava). **La fattura non si poteva creare dalla pagina Fatture**: ora «Nuova fattura» apre una pagina unica con cliente e dati fiscali, ordine facoltativo da cui copiare righe e sconto, righe dal catalogo, pagamento, bollo calcolato dal vivo, totali ed elenco di cosa manca; termina in «Salva bozza» o «Emetti». La tabella delle righe e i totali sono un componente condiviso con la pagina della bozza. Preventivo (nuovo e modifica) riallineato allo stesso schema; tolto il margine negativo che incollava la barra all'header su preventivi e ordini. **Contratti e fatture paginati** come i preventivi: le fatture leggevano le prime 500 e si fermavano, quindi dalla 501ª sparivano dall'elenco. | `866c422` · `de4bd4d` · `b1d2783` · `9cd6202` · `ee30b51` |
| I7 | **Copia di cortesia e archiviazione.** PDF leggibile dagli stessi dati congelati dell'XML (emittente con REA e regime, recapito SDI, righe con lo sconto ripartito per aliquota, riepilogo IVA, Nature, bollo virtuale, IBAN e scadenza), con la dicitura di copia priva di valore fiscale ai sensi dell'art. 21 D.P.R. 633/1972 su ogni pagina. **Archivio su R2**: dopo l'emissione, in `after()`, XML e PDF vengono scritti con chiavi casuali che non contengono nulla della fattura, e registrati con impronta SHA-256 da un aggiornamento condizionato su `xml_key IS NULL`, così due archiviazioni in parallelo lasciano una sola coppia di file e chi perde cancella i propri. L'archiviazione non fa mai fallire l'emissione: se non riesce, il download ricostruisce il file dai dati congelati e archivia, e la fattura offre «Archivia ora». Un file archiviato che non corrisponde più alla sua impronta **non viene servito**. **Invio al cliente** dal mittente del workspace, con il PDF in allegato (gli allegati email ora accettano byte, non solo testo), l'email principale dell'azienda proposta e data e destinatario registrati sulla fattura; solo fatture emesse. Endpoint `/api/invoices/{id}/pdf` documentato. Verificato generando un PDF d'esempio e leggendolo. ⚠️ **Non verificato su Cloudflare**: il rendering usa la stessa libreria del PDF del preventivo, ma non l'ho eseguito in produzione da utente autenticato. ⚠️ L'archivio non è conservazione sostitutiva a norma. Migrazione `0025`, additiva. 6 test su Postgres reale con storage in memoria, 5 di guardia; 8 mutazioni su 8. Voce nel Help Centre e sezione in CLAUDE.md. | commit successivo |
| — | **Valuta e lingua dei documenti (16 settembre 2026, su segnalazione).** Il «$» sui preventivi non veniva dal dato (il preventivo è salvato in EUR) ma da `formatAmount`, che tratta ogni importo come euro e lo **converte** nella valuta di visualizzazione dell'utente, rimasta su USD dopo una scelta fatta in inglese: simbolo e cifra erano sbagliati. Preventivi, ordini, contratti, fatture e scheda cliente ora mostrano gli importi nella valuta del documento, senza conversione; i totali di più documenti sono raggruppati per valuta (MRR, fatturato ordini). Valuta scelta alla creazione di preventivo e ordine (e ereditata dal preventivo), elenco invece di testo libero sul contratto. **Lingua del cliente**: nuovo campo sull'azienda (italiano, inglese o automatica dal paese), nel modulo, nell'API di import, nel CSV e nella documentazione; guida PDF e stampa del preventivo, pagina pubblica, email di invio e bozze di sollecito, PDF ed email della fattura (congelata all'emissione). Il venditore in testa al preventivo è la denominazione del profilo di fatturazione, non più «Flux CRM». **Difetti trovati lungo la strada:** il link «Visualizza il preventivo» nell'email puntava a un token mai salvato e non si apriva; il PDF del preventivo dal link del cliente rispondeva 500 perché cercava il workspace nella sessione; l'API pubblica mandava a chi aveva il link l'intera scheda aziendale (fatturato, punteggio, titolare, tag); il messaggio dell'email non era escapato. Migrazione `0026`, additiva, applicata e verificata. 16 test, 8 mutazioni. Verificato generando PDF di preventivo in italiano e inglese e di fattura in inglese. ⚠️ Restano in inglese fisso alcune etichette della pagina di dettaglio del preventivo nella dashboard (non rivolte al cliente). | commit successivo |

### Prossimi passi, in quest'ordine

Nessuno richiede decisioni. Ciascuno si chiude con test, mutazioni dove un errore costa, build verde e questa sezione aggiornata.

| # | ID | Attività | Perché in questa posizione |
|---|---|---|---|
| 1 | I8 | Note di credito | Dopo la fattura; il PDF e l'archivio di I7 la coprono già. |
| 2 | L3 | Listini, percentuale e prezzi espliciti | D4. |
| 3 | L9 | Ambiti delle chiavi API per entità, poi API di lettura | D7. |

### Da fare sulla dashboard Cloudflare

- ~~**O1**~~ verificato il 15 settembre 2026: il push delle 19:0x ha prodotto una nuova versione su Cloudflare, e il sito risponde. Tra il 10 e il 15 settembre non c'erano stati deploy nuovi.
- **O2** cifrare le sei variabili in chiaro. Da riga di comando non si può: l'API rifiuta un secret con il nome di una variabile esistente.
- **O3** ruotare subito `CRON_SECRET`, `IMPORT_API_KEY`, `ADMIN_SESSION_SECRET`; `AUTH_SECRET` e la password Neon in una finestra concordata; `PLATFORM_ENCRYPTION_KEY` seguendo la procedura in cima a `scripts/rotate-platform-key.ts`, dopo il deploy che contiene `cb8ffe3`.
- **O5** cancellare `NXTAUTH_URL`.

### In attesa di decisioni

| Decisione | Sblocca | Nota |
|---|---|---|
| D1 canale SDI e fornitore | I6 | Ancora da prendere. Tutto il resto della fatturazione si costruisce senza. |
| D5 firma **avanzata** tramite fornitore | L2 | Decisa il 15 settembre 2026; resta da scegliere il fornitore, senza il quale L2 non inizia. |
| D6 provvigione su vinto o su incassato | L8 | Su incassato richiede anche I9. |

**Prese il 15 settembre 2026:** D2 e D3 sul perimetro consigliato (TD01 e TD04, IVA ordinaria con Natura, bollo virtuale; una fattura per ordine). D4 listini con percentuale sul prezzo base e prezzi espliciti per prodotto che la sostituiscono. D7 chiavi API con ambiti di lettura e scrittura **per entità**.

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

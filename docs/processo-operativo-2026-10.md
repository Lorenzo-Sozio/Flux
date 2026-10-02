# Il processo dal lead all'impianto installato e alla sua manutenzione, in Flux

1 ottobre 2026. Verificato sul codice di Flux in quella data. Aggiornato a fine giornata con gli sviluppi S0, S1, S2 e S4, la manutenzione, la valutazione tra ordine e commessa, due correzioni (fattura del cliente privato, provenienza dall'API) e, il 2 ottobre, l'assistenza sugli impianti.

## In sintesi

- **Vendita e amministrazione si fanno già in Flux**: lead, coda di lavoro, trattative, preventivo firmato online, fatture di acconto e saldo, incassi, banca.
- **La prima parte della tappa 1 è fatta.** Le automazioni sono corrette (S0). La provenienza è un elenco unico (S1). La coda di lavoro mostra chiamate e lead nuovi (S2). La conversione porta tutto al cliente (S4).
- **L'installazione non si gestisce bene oggi.** La proposta è una nuova sezione **«Commesse»**: il lavoro (fasi, pratiche, squadra, appuntamenti, documenti) vive lì, mentre i soldi (acconti, saldo, incassi) restano sull'ordine collegato, che funziona già. È lo sviluppo principale; la scelta va confermata (punto 13).
- **La trattativa resta nella pipeline Vendite e diventa «Vinta» alla firma.** Non si sposta in un'altra pipeline: smetterebbe di essere vinta nei report.
- **La manutenzione è un contratto.** A fine installazione si propone la pulizia dei pannelli, una o due volte l'anno. Il contratto ha già durata, rinnovo e canone. Mancano gli interventi programmati e la fattura del canone.
- **L'assistenza su un impianto guasto parte da un ticket e finisce con un intervento.** Il ticket raccoglie la richiesta, risponde al cliente e misura i tempi, e oggi funziona. Manca l'intervento sul posto: tecnico, data, rapportino, foto, firma, e se è in garanzia o a pagamento. Lo stesso «intervento» serve anche per le pulizie della manutenzione.
- **Si parte subito** con la sola configurazione; gli sviluppi seguono per tappe.

Legenda dello stato: **Pronto** = funziona oggi · **Configurare** = si imposta, senza sviluppo · **Sviluppare** = serve codice · **Integrare** = serve un servizio esterno.

## Il processo in Flux, fase per fase

Le fasi sono in ordine cronologico, dal primo contatto alla vita dell'impianto installato. Per ognuna:
- **chi** la fa;
- **cosa fare in Flux**, con il percorso del menu;
- **cosa fa Flux da solo**;
- **cosa manca** finché non arriva lo sviluppo indicato.

I menu sono quelli della barra laterale: Lavoro, Clienti, Vendite, Fatturazione e incassi, Assistenza, Marketing e automazioni, Analisi, Amministrazione.

### Il quadro d'insieme

| # | Fase | Chi | Dove in Flux | Stato |
| --- | --- | --- | --- | --- |
| 1 | Arriva il lead | Sistema, agente | Clienti → Lead | Pronto; ADS da integrare |
| 2 | Il lead viene assegnato | Sistema | Automazioni | Configurare |
| 3 | Primo contatto | Operatore | Lavoro → Coda di lavoro | Pronto |
| 4 | Appuntamento con l'agente | Operatore, agente | Lavoro → Calendario | Pronto |
| 5 | Lead scartato | Operatore | Scheda del lead | Configurare |
| 6 | Il lead diventa cliente e trattativa | Agente | Scheda del lead → Converti lead | Pronto |
| 7 | Sopralluogo e preventivo | Agente | Vendite → Pipeline, Preventivi | Pronto |
| 8 | Firma o perdita | Cliente, agente | Preventivo online; Pipeline | Pronto |
| 9 | Avvio dei lavori e primo acconto | Agente, amministrazione | Preventivo → Converti in ordine; Ordine → Fattura d'acconto | Pronto; commessa con S7 |
| 10 | Pratiche pre-installazione | Ufficio installazioni | Attività sulla trattativa | A mano; checklist con S8, documenti con S9 |
| 11 | Pianificazione e secondo acconto | Ufficio installazioni, amministrazione | Calendario; Ordine → Fattura d'acconto | Pronto; fasi con S7 |
| 12 | Installazione | Squadra | Calendario | Pronto |
| 13 | Pratiche post-installazione | Ufficio installazioni | Attività sulla trattativa | A mano; checklist con S8 |
| 14 | Chiusura: saldo e proposta di manutenzione | Amministrazione, agente | Ordine → Fattura di saldo | Pronto |
| 15 | Incassi, banca e solleciti | Amministrazione | Fatturazione e incassi → Banca, Fatture, Finanza | Pronto; solleciti automatici con S10 |
| 16 | Manutenzione | Ufficio installazioni, squadra | Vendite → Contratti; Calendario | Pronto in parte; interventi con S13 |
| 17 | Assistenza su un impianto | Assistenza, tecnico | Assistenza → Ticket | Pronto in parte; interventi con S16 |
| — | Ogni giorno, ogni settimana | Tutti | Email del mattino, Dashboard, Analisi | Pronto |

### 1. Arriva il lead

**Chi:** il sistema (ADS e sito) o l'agente.

**In Flux:**
- **ADS Meta e Google:** il modulo della campagna invia il lead a Zapier o Make, che lo scrive in Flux attraverso l'API dei lead (Impostazioni → Chiavi API, una chiave limitata ai lead). Ogni lead deve portare la provenienza (`ads_meta` o `ads_google`) e il nome della campagna.
- **Sito:** il modulo di contatto di Flux (Impostazioni → Moduli) si incorpora nel sito; il lead arriva con provenienza «Modulo web» e con il consenso spuntato dal visitatore.
- **Agente o segnalazione:** Clienti → Lead → Nuovo (sul telefono: pulsante «Crea» in basso). Provenienza «Agente» o «Segnalazione».

**Flux da solo:**
- avvisa se la persona esiste già come lead o contatto;
- riconosce lo stesso numero scritto in modi diversi (+39 333… e 333…);
- senza titolare, il lead creato dall'agente è suo.

**Manca:** il collegamento ADS → Zapier/Make va configurato (non serve codice).

### 2. Il lead viene assegnato

**Chi:** il sistema.

**In Flux:** la regola «Lead creato senza titolare → assegna a rotazione» (Marketing e automazioni → Automazioni) sceglie il titolare per provenienza, poi per zona, poi a turno. In alternativa il lead va al gruppo («Call center»): lo vedono tutti i membri.

**Flux da solo:** avvisa il nuovo titolare, o tutti i membri del gruppo, con una notifica anche sul telefono.

### 3. Primo contatto

**Chi:** l'operatore del call center.

**In Flux:**
1. Lavoro → **Coda di lavoro**. In cima ci sono, per urgenza:
   - i lead appena arrivati («Chiamalo adesso»): i propri, quelli del gruppo e quelli senza titolare;
   - le chiamate da fare oggi o già in ritardo;
   - poi le altre cose che aspettano.
2. Si chiama dal numero mostrato (sul telefono basta toccarlo).
3. Si registra l'esito: raggiunto, nessuna risposta, segreteria, con una nota e il **prossimo passo** (es. «Richiamare» domani alle 10). Poi «Salva e avanti».
4. Se nessuno risponde, Flux propone da solo un'altra chiamata.
5. Si aggiorna lo stato del lead (In contatto, Qualificato) dalla sua scheda.

**Flux da solo:**
- la sequenza «Primo contatto» (se attiva per ADS e sito) crea le chiamate dei giorni 0, 1, 4 e 7 e invia l'email del giorno 2;
- se il cliente risponde all'email, la sequenza si ferma.

**Manca (S3):** l'esito che cambia da solo lo stato del lead e «Appuntamento fissato» che crea l'appuntamento e passa il lead all'agente.

### 4. Appuntamento con l'agente

**Chi:** l'operatore lo fissa, l'agente lo fa.

**In Flux:**
- **Fissato dall'operatore:** Lavoro → Calendario → nuovo appuntamento, organizzato dall'agente e collegato al lead, con l'invito al cliente via email e il promemoria.
- **Scelto dal cliente:** si manda al cliente il link della **pagina di prenotazione** dell'agente (Profilo), che mostra solo gli orari liberi.
- Dopo l'appuntamento, l'agente ne registra l'esito.

**Flux da solo:**
- invia l'invito con il file di calendario e il promemoria prima dell'appuntamento;
- mostra l'agenda del giorno sulla home e nell'email del mattino.

### 5. Lead scartato

**Chi:** l'operatore o l'agente.

**In Flux:** sulla scheda del lead, stato «Non qualificato» e campo «Motivo di scarto» (da creare, tappa 0).

**Manca (S5):** il motivo obbligatorio.

### 6. Il lead diventa cliente e trattativa

**Chi:** l'agente, dopo l'appuntamento.

**In Flux:** sulla scheda del lead, **Converti lead**:
- la pipeline in cui aprire la trattativa (se ce n'è più di una);
- **cliente privato** (attivo da solo se il lead non ha azienda): crea l'intestatario a nome della persona, con nome e cognome per la fattura;
- crea la trattativa (attivo).

**Flux da solo:**
- crea contatto, azienda e trattativa con lo stesso agente e la stessa provenienza;
- porta loro attività, note, appuntamenti, documenti e campi personalizzati;
- apre la trattativa nella prima fase della pipeline e fa scattare le regole.

### 7. Sopralluogo e preventivo

**Chi:** l'agente.

**In Flux:**
1. Vendite → **Pipeline**: si sposta la trattativa di fase («Sopralluogo fatto», «Preventivo inviato»), trascinandola o con la barra delle fasi nella sua scheda.
2. Sulla scheda della trattativa si allegano bollette, foto e misure del sopralluogo.
3. Dalla trattativa, **nuovo preventivo**, con le righe dai Prodotti ai prezzi del listino del cliente.
4. **Invia preventivo**: parte un'email con il link al preventivo online e il PDF.

**Flux da solo:**
- avvisa quando il cliente apre il preventivo;
- nella coda di lavoro segnala un preventivo mai aperto dopo 5 giorni e uno in scadenza entro 3;
- segnala una trattativa ferma da troppi giorni (soglia per fase).

### 8. Firma o perdita

**Chi:** il cliente firma, l'agente segue.

**In Flux:**
- **Firma:** il cliente apre il link, scrive il suo nome, spunta il consenso e accetta. Flux conserva il PDF firmato e la sua impronta.
- **Perdita:** sulla trattativa si sceglie «Persa», con il motivo e il concorrente.

**Flux da solo:**
- avvisa l'agente della firma;
- mette nella coda di lavoro «Trasformalo in ordine».

### 9. Avvio dei lavori e primo acconto

**Chi:** l'agente avvia, l'amministrazione fattura.

**In Flux:**
1. Sul preventivo accettato, **Converti in ordine**: l'ordine copia righe e importi del preventivo.
2. Sull'ordine, **Fattura d'acconto**: importo o percentuale dell'ordine (es. 30%), ripartito sulle aliquote. Si apre una bozza.
3. Sulla bozza, **Emetti**, poi **Invia allo SDI** (con l'intermediario) o scarica l'XML.
4. Le fasi del lavoro si seguono come attività sulla trattativa vinta, da una checklist, e nel Gantt (Lavoro → Attività → Gantt).

**Flux da solo:**
- segna la trattativa vinta e la sposta nella colonna «Vinta»;
- fa scattare le regole: avviso all'amministrazione, benvenuto al cliente;
- legge da SDI l'esito della fattura e avvisa se è scartata.

**Manca (S7):** la commessa, con le sue fasi e le condizioni per avanzare («acconto 1 incassato»).

### 10. Pratiche pre-installazione

**Chi:** l'ufficio installazioni.

**In Flux:**
- attività sulla trattativa vinta, una per pratica, con scadenza e responsabile;
- documenti allegati alla trattativa;
- moduli compilati a mano.

**Manca:**
- le attività create da un modello quando la commessa entra nella fase (S8);
- i documenti compilati con i dati del cliente (S9).

### 11. Pianificazione e secondo acconto

**Chi:** l'ufficio installazioni pianifica, l'amministrazione fattura.

**In Flux:**
- **Data:** si fissa la data di installazione nel calendario della squadra, con invito al cliente.
- **Acconto 2:** sull'ordine, **Fattura d'acconto**, poi Emetti e Invia allo SDI.
- **Incasso:** si controlla sull'ordine o nella fattura prima di confermare la data (decisione 4).

**Manca (S7, S10):** l'incasso che fa avanzare la commessa da solo.

### 12. Installazione

**Chi:** la squadra.

**In Flux:**
- appuntamento della squadra nel calendario: organizzatore e colleghi invitati;
- foto e verbali allegati alla trattativa.

**Flux da solo:** promemoria alla squadra e al cliente.

### 13. Pratiche post-installazione

**Chi:** l'ufficio installazioni.

**In Flux:** come per la fase 10, con le attività delle pratiche post-installazione.

**Manca (S8):** la checklist automatica.

### 14. Chiusura: saldo e proposta di manutenzione

**Chi:** l'amministrazione chiude, l'agente propone la manutenzione.

**In Flux:**
1. Sull'ordine, **Fattura di saldo**: riporta tutto l'ordine e scomputa da sola gli acconti emessi. Emetti, Invia allo SDI.
2. Ordine → stato **Completato**.
3. Preventivo di manutenzione con il prodotto «Manutenzione annuale» (vedi fase 16).

**Flux da solo:** con le regole attive, all'ordine completato:
- invia l'email di chiusura e la richiesta di recensione;
- crea per l'agente l'attività «Proponi la manutenzione».

### 15. Incassi, banca e solleciti

**Chi:** l'amministrazione, ogni settimana.

**In Flux:**
1. Fatturazione e incassi → **Banca** → **Importa estratto conto** (CAMT.053 o CSV della banca).
2. Flux propone a quale fattura va ogni movimento: si confermano quelli sicuri in blocco, gli altri uno per uno.
3. Un pagamento fuori banca si registra sulla fattura o sull'ordine.
4. Fatturazione e incassi → **Finanza**: incassato, fatturato, scaduto per anzianità, DSO.
5. Una fattura scaduta: sulla fattura, **Sollecito di pagamento** (email con l'importo scaduto e l'IBAN).

**Flux da solo:**
- tiene lo scadenzario per rata;
- tiene il credito del cliente quando paga di più;
- non lascia mai pagare una fattura oltre il dovuto.

**Manca (S10):** il sollecito automatico alla scadenza.

### 16. Manutenzione

**Chi:** l'ufficio installazioni e la squadra.

**In Flux:**
1. Il cliente firma il preventivo di manutenzione.
2. Vendite → **Contratti** → nuovo contratto:
   - durata 12 mesi, rinnovo automatico, preavviso di disdetta;
   - canone annuale;
   - titolo «Manutenzione impianto – Cognome».
3. Calendario: appuntamento ricorrente (ogni anno o ogni 6 mesi) della squadra, collegato al cliente.
4. Dopo ogni pulizia, esito e foto sull'appuntamento.
5. Canone: fattura manuale.

**Flux da solo:**
- avvisa il titolare prima del termine di disdetta;
- calcola il ricavo ricorrente.

**Manca:**
- il contratto creato dal preventivo e collegato alla commessa (S12);
- le pulizie generate dal contratto (S13);
- la fattura del canone e l'email di rinnovo al cliente (S14).

### 17. Assistenza su un impianto

**Chi:** l'operatore dell'assistenza e il tecnico.

**In Flux:**
1. Il ticket nasce:
   - da un'email all'indirizzo di assistenza, con le foto allegate;
   - dal modulo del sito;
   - dall'operatore durante una telefonata (Assistenza → Ticket → Nuovo).
2. Si imposta la priorità («impianto fermo» = urgente) e le etichette (inverter, produzione…). Si collega l'ordine dell'impianto.
3. Si risponde al cliente dal ticket, con le risposte predefinite. Le note interne restano interne.
4. Se serve un tecnico:
   - attività «Intervento del …» sul ticket, assegnata al tecnico, con data e ore;
   - appuntamento nel calendario con il cliente;
   - ticket «in attesa».
5. Dopo la visita: esito come nota interna, ore sull'attività. Se a pagamento, fattura manuale.
6. Risposta finale e ticket **risolto**.

**Flux da solo:**
- conta i tempi promessi (SLA), avvisa al 50% e all'80% e segnala il ritardo;
- dà al cliente un link per seguire la richiesta;
- riapre il ticket se il cliente risponde;
- chiede il giudizio alla chiusura, se attivo.

**Manca:**
- ticket dalla pagina del cliente e foto caricabili (S15);
- l'intervento con rapportino e firma (S16);
- garanzia e addebito (S17).

### Ogni giorno, ogni settimana

- **Ogni mattina:** un'unica email a ognuno con le attività del giorno, i ritardi, le trattative senza passo successivo, le risposte da dare e i preventivi accettati.
- **Durante il giorno:**
  - la Coda di lavoro per operatori e agenti;
  - la Dashboard per ruolo (vendite, direzione, amministrazione, assistenza);
  - le notifiche sul telefono.
- **Ogni settimana:**
  - Vendite → Pipeline (Previsione, Report pipeline, Funnel con le vinte per provenienza);
  - Analisi → Per commerciale;
  - Assistenza → Per agente;
  - Fatturazione e incassi → Finanza.

## La scelta chiave: dove vive il lavoro dopo la firma

La trattativa resta nella pipeline Vendite e diventa «Vinta» alla firma. Il lavoro che segue (pratiche, pianificazione, installazione, chiusura) ha bisogno di un posto suo. Una seconda pipeline di trattative è esclusa: la vendita sparirebbe dai report dell'agente, oppure il cliente verrebbe contato due volte. Restano quattro strade.

### Cosa c'è oggi nell'ordine

L'ordine è il **documento economico** di Flux, e a lui è legata gran parte dell'amministrazione:
- **fatture**: una sola fattura di saldo per ordine, gli acconti (TD02) divisi per aliquota sulle righe dell'ordine e mai oltre il suo totale, il saldo che scomputa gli acconti, le righe bloccate dopo la prima fattura. Questi controlli sono scritti nell'istruzione che emette la fattura;
- **incassi**: gli incassi sull'ordine, gli acconti ricevuti prima della fattura, il credito restituito all'annullamento, la riconciliazione bancaria;
- **cifre**: «ordini da fatturare» nella home, fatturato e incassato nei report;
- **integrazioni**: l'API `/api/crm/orders` (con cui VoipAI crea ordini dalle conversazioni), gli eventi `order.*`, le regole automatiche, la visibilità per titolare.

Sono più di trenta file. Dell'ordine invece **niente è pensato per un lavoro**: ha quattro stati (bozza, in lavorazione, completato, annullato), e le uniche informazioni operative sono di spedizione (data di consegna, corriere, codice di tracciamento). Non ha fasi, squadra, checklist, appuntamenti né documenti propri. E attività, appuntamenti e contratti oggi non possono nemmeno collegarsi a un ordine.

### Le quattro strade

| | A. Fasi sull'ordine | B. Commessa al posto dell'ordine | C. Sezione «Commesse» collegata all'ordine | D. Progetto nel Gantt |
| --- | --- | --- | --- | --- |
| Cos'è | Si aggiungono all'ordine fasi, squadra e checklist | Una nuova sezione che porta sia il lavoro sia i soldi | Una nuova sezione per il lavoro; ogni commessa ha il suo ordine, che resta il documento economico | Un'attività principale sotto la trattativa vinta, con sotto-attività e dipendenze |
| Fatture, acconti, incassi | Pronti | Da rifare tutti, o da duplicare | Pronti: sono quelli dell'ordine | Nessuno: restano sull'ordine, scollegati dal lavoro |
| Fasi con condizioni (acconto incassato, pratiche chiuse) | Sì | Sì | Sì | No: solo date e dipendenze |
| Squadra, appuntamenti, documenti, pratiche | Da aggiungere all'ordine | Sì | Sì, sulla commessa | In parte (attività e responsabili) |
| Contratto di manutenzione collegato | All'ordine | Alla commessa | Alla commessa | Alla trattativa |
| Effetto sugli altri usi dell'ordine | Fasi e squadra compaiono anche dove l'ordine è una vendita di merce o un ordine dall'assistente | Nessuno: l'ordine resta com'è, ma le installazioni non lo usano più | Nessuno: chi non installa non vede le commesse | Nessuno |
| Chiarezza per chi lavora | Media: «ordine» per un impianto, con un riquadro di spedizione | Alta | Alta: le commesse per l'ufficio installazioni, l'economico per l'amministrazione | Bassa: il lavoro è un elenco di attività senza soldi |
| Rischio | Medio: si tocca il modulo da cui dipendono fatture e incassi | Alto: si riscrivono le regole contabili verificate a settembre | Basso: le regole contabili non si toccano | Basso, ma non risolve il problema |
| Sviluppo | L (3–4 settimane) | Molto grande (2–3 mesi) | L (4–5 settimane) | S, ma insufficiente |

### La raccomandazione: C, una sezione «Commesse» collegata all'ordine

La commessa è il **lavoro**, l'ordine è il **conto**. Si guadagna una pagina pensata per l'installazione senza toccare le regole contabili, che sono la parte più delicata di Flux e sono state verificate con test sui soldi reali (fatture, acconti, incassi che si incrociano).

Come funziona:
- **alla firma**, «Converti in ordine» diventa **«Avvia commessa»**: un solo gesto crea l'ordine (righe e importi dal preventivo, come oggi) e la commessa collegata, e segna la trattativa vinta;
- **la pagina della commessa** è quella che apre l'ufficio installazioni:
  - le fasi in alto, con le condizioni per passare alla successiva;
  - checklist e pratiche;
  - squadra e appuntamenti;
  - documenti;
  - una scheda **Economico** che mostra righe, acconti, saldo e incassi dell'ordine, con gli stessi pulsanti di oggi;
  - il contratto di manutenzione;
- **il tabellone delle commesse** mostra una colonna per fase. L'elenco degli ordini resta all'amministrazione;
- **le fasi sono configurabili**, come le fasi di una pipeline, ciascuna con le sue condizioni, che leggono l'ordine: «acconto 1 emesso o incassato», «checklist completa», «data di installazione fissata»;
- **attività, appuntamenti, documenti e contratti** si collegano alla commessa. Così un appuntamento della squadra o una pratica sanno di quale impianto sono;
- **finita l'installazione, la commessa resta come scheda dell'impianto**: data di fine lavori, dati tecnici, garanzie. Ticket, interventi e contratto di manutenzione vi si appoggiano per tutta la vita dell'impianto;
- **la sezione si attiva per area di lavoro**, come oggi Gantt e chat: chi vende merce non la vede.

Cosa costa in più rispetto ad A: una tabella, la pagina, il tabellone, i collegamenti da attività e appuntamenti, la visibilità e la ricerca. Cosa evita: fasi e squadra su un documento che altri clienti di Flux usano per vendere merce, e qualsiasi modifica alle regole che emettono fatture e registrano incassi.

Le strade B e D si scartano. B costerebbe mesi per rifare ciò che funziona. D lascia il lavoro senza fasi né soldi, ed è quello che si fa oggi in attesa dello sviluppo.

**Da decidere** (punto 13): adottare C, e il nome della sezione («Commesse» o «Lavori»).

### Le fasi della commessa

L'ordine resta il conto, la commessa avanza per **fasi**, e le fatture sono **traguardi** che le fasi aspettano.

| Fase della commessa | Prima di passare alla fase dopo | Fattura | Cosa prepara Flux |
| --- | --- | --- | --- |
| 1. Avvio | Acconto 1 incassato | Acconto 1, alla firma | Bozza dell'acconto; attività «Raccogli i documenti del cliente» |
| 2. Pratiche pre-installazione | Pratiche approvate | — | Checklist delle pratiche; documenti compilati con i dati del cliente |
| 3. Pianificazione | Acconto 2 incassato, data fissata | Acconto 2 | Bozza dell'acconto 2; attività «Fissa la data» |
| 4. Installazione | Impianto installato | — | Appuntamento della squadra; promemoria al cliente |
| 5. Pratiche post-installazione | Pratiche chiuse | — | Checklist post-installazione |
| 6. Chiusura | Saldo incassato | Saldo | Bozza del saldo; sollecito alla scadenza; email finale; **proposta di manutenzione** |

Fino allo sviluppo, l'ordine resta «In lavorazione» e le fasi si seguono come attività sulla trattativa vinta, nel Gantt. Le attività vanno create a mano da una checklist.

## La manutenzione: un contratto con interventi programmati

A fine installazione si propone un intervento di manutenzione annuale con la pulizia dei pannelli, una o due volte l'anno.

### Perché un contratto

È un servizio che si ripete ogni anno finché il cliente non lo disdice. Il **contratto** di Flux (Vendite → Contratti) ha già quello che serve per la parte commerciale:
- **durata e rinnovo**: inizio, fine, rinnovo automatico di 12 mesi, giorni di preavviso per la disdetta;
- **canone**: importo e periodicità (annuale o semestrale), che alimentano il ricavo ricorrente mensile nell'elenco dei contratti e nella dashboard dell'amministrazione;
- **avviso di rinnovo** al titolare prima del termine di disdetta, come notifica (campanella e telefono);
- **email** con i modelli di base «Invio contratto da firmare» e «Rinnovo contratto in scadenza», che si compilano con titolo e scadenza del contratto.

Le altre strade sono peggiori:
- **un ordine** per la manutenzione si chiude una volta, mentre la manutenzione si ripete;
- **una trattativa in una seconda pipeline** conterebbe una vendita in più per lo stesso cliente ogni anno. Serve solo se sulla manutenzione si pagano provvigioni: in quel caso una pipeline «Manutenzioni», separata da Vendite, misura le proposte e le adesioni (da decidere, punto 11).

### Come funziona

| Passo | Cosa succede | Oggi, senza sviluppo | Con lo sviluppo |
| --- | --- | --- | --- |
| Proposta | Alla chiusura della commessa si propone la manutenzione | Regola «Ordine completato → attività "Proponi la manutenzione" al titolare»; preventivo con il prodotto «Manutenzione annuale», firmato online | La chiusura della commessa prepara la proposta (S12) |
| Adesione | Il cliente firma il preventivo | Si crea il contratto a mano | «Converti in contratto» dal preventivo firmato, come oggi «Converti in ordine» (S12) |
| Pianificazione | 1 o 2 pulizie l'anno, nei mesi giusti (es. aprile e settembre) | Appuntamento ricorrente (annuale o ogni 6 mesi) nel calendario della squadra, collegato al cliente | Il contratto dice quante pulizie e in quali mesi; un mese prima Flux crea l'attività «Fissa la pulizia» nella coda dell'ufficio (S13) |
| Intervento | La squadra pulisce e registra l'esito | Esito e nota sull'appuntamento; foto come documenti del cliente | Esito dell'intervento (fatto, rimandato, cliente assente); un intervento saltato resta in coda finché non è rifatto (S13) |
| Canone | Si fattura il canone | Fattura manuale | Bozza della fattura all'attivazione e a ogni rinnovo, oppure dopo ogni intervento (S14) |
| Rinnovo | Il contratto si rinnova da solo salvo disdetta | Avviso di rinnovo al titolare | Anche un'email al cliente prima del rinnovo (S14) |
| Disdetta | Il cliente disdice | Contratto annullato; l'appuntamento ricorrente va tolto a mano | Annullare il contratto toglie le pulizie non ancora fatte (S13) |

⚠️ **Il limite di oggi:** nulla lega gli appuntamenti al contratto. Se il contratto si disdice, la serie di pulizie continua nel calendario finché qualcuno non la cancella. E il contratto non porta il collegamento alla commessa né al preventivo: si scrive nelle note.

### Quando svilupparlo

- **S12 nella tappa 2**, insieme alla commessa: la proposta nasce dalla sua chiusura.
- **S13 e S14 nella tappa 3**, ma prima che arrivino le prime pulizie, cioè circa sei mesi dopo le prime installazioni gestite in Flux.

## L'assistenza: un ticket per la richiesta, un intervento per il lavoro sul posto

Un cliente ha un problema con l'impianto (inverter in errore, produzione calata, un pannello danneggiato) e chiede assistenza. A volte basta una risposta o un controllo a distanza; altre volte serve un tecnico sul posto.

### Perché il ticket, e perché non basta

Il **ticket** di Flux (Assistenza → Ticket) è fatto per la richiesta:
- **nasce da più canali**:
  - da un'email all'indirizzo di assistenza, con gli allegati (le foto del cliente arrivano così);
  - dal modulo di assistenza sul sito;
  - creato dall'operatore durante una telefonata;
- **ha tempi promessi** (SLA) per priorità, con orari di lavoro, avvisi al 50% e all'80% del tempo e segnalazione del ritardo al responsabile;
- **tiene la conversazione**: risposte al cliente, note interne, risposte predefinite;
- **dà al cliente un link** per vedere lo stato della sua richiesta, e una sua risposta riapre un ticket risolto;
- **chiede un giudizio** al cliente alla chiusura (da attivare) e avvisa chi l'ha gestito se è negativo;
- **ha già i collegamenti utili**: attività con ore, l'ordine (quindi l'impianto venduto), lo storico dei ticket dello stesso cliente, il riepilogo per il collega che subentra.

Il ticket però è un'**assistenza da scrivania**. Non sa nulla del lavoro sul posto:
- non si collega a un appuntamento;
- non ha un rapportino con esito, ore, materiali e firma;
- non si possono aggiungere foto dalla sua pagina;
- non sa se l'impianto è in garanzia o sotto contratto;
- non porta a una fattura.

Le alternative non vanno meglio:
- **gestire tutto come attività** perde i tempi promessi, la conversazione e il link per il cliente;
- **aprire una trattativa** per ogni guasto riempie la pipeline di vendite che non lo sono.

### La proposta: il ticket resta la richiesta, l'intervento è il lavoro

**Un ticket può avere uno o più interventi.** L'**intervento** è il lavoro di un tecnico presso il cliente, ed è lo stesso oggetto che serve alle pulizie della manutenzione (S13) e, più avanti, ai sopralluoghi. Un solo calendario dei tecnici, un solo rapportino, un solo modo di fatturare.

| Passo | Cosa succede | Oggi, senza sviluppo | Con lo sviluppo |
| --- | --- | --- | --- |
| Segnalazione | Il cliente chiama, scrive o compila il modulo | Ticket da email o dal modulo; per telefono l'operatore lo apre dalla sezione Assistenza | Ticket aperto anche dalla pagina del cliente o della commessa, con l'impianto già scelto; foto nel modulo (S15) |
| Classificazione | Che problema è e quanto è grave | Priorità («impianto fermo» = urgente) ed etichette (inverter, produzione, danni, monitoraggio) | Categorie configurabili e modificabili dalla pagina del ticket (S15) |
| Diagnosi | L'operatore prova a risolvere a distanza | Risposte e note sul ticket; molte richieste si chiudono qui | — |
| Pianificazione | Serve un tecnico: si fissa la visita | Attività con data per il tecnico, collegata al ticket; appuntamento nel calendario collegato al cliente; ticket «in attesa» | «Pianifica intervento» dal ticket: tecnico (o squadra), data, invito e promemoria al cliente; il ticket lo mostra (S16) |
| Sul posto | Il tecnico ripara e registra | Nota e ore sull'attività; foto per email | Dal telefono: esito (risolto, da ripassare, serve un pezzo), ore, materiali dal catalogo, foto, firma del cliente; rapportino in PDF inviato al cliente (S16) |
| Copertura | In garanzia, coperto dal contratto, o a pagamento | Deciso a mano | Flux propone la copertura dalla scheda dell'impianto (garanzie e date) e dal contratto attivo; chi chiude l'intervento conferma (S17) |
| Addebito | Se a pagamento, si fattura | Fattura manuale | Ordine (e poi fattura) creato dall'intervento con ore e materiali, ai prezzi del listino del cliente (S17) |
| Chiusura | Il ticket si risolve | Risposta finale, ticket risolto, valutazione al cliente | L'intervento risolto propone di risolvere il ticket con il rapportino allegato (S16) |

Più interventi per un ticket sono normali: un primo passaggio di diagnosi, poi il ritorno con il pezzo di ricambio.

⚠️ **Il limite di oggi:** il ticket e l'appuntamento non si vedono l'uno dall'altro, e il tecnico non può aggiungere foto dalla pagina del ticket. Finché non c'è S16 conviene tenere tutto nel ticket: un'attività «Intervento del …» assegnata al tecnico, con data e ore, e l'esito scritto come nota interna.

### Garanzia e contratto

Per decidere chi paga servono tre informazioni che oggi non ci sono:
- **le garanzie dell'impianto**: manodopera (es. 2 anni dalla fine dei lavori), prodotti (inverter, pannelli, batteria, con le loro durate) e le matricole se servono al produttore. Vanno sulla scheda dell'impianto, cioè sulla commessa chiusa (S7, S17);
- **il contratto di manutenzione attivo**: cosa copre (es. pulizie incluse, diritto di chiamata scontato o incluso);
- **le tariffe**: diritto di chiamata, ora di lavoro, trasferta, come prodotti del catalogo, così l'addebito usa i listini che esistono già.

Un guasto coperto dalla garanzia del produttore apre spesso una pratica con il produttore stesso (RMA): all'inizio basta un'attività sul ticket, con il numero della pratica nella nota.

### Quando svilupparlo

- **S15 nella tappa 2**: è piccolo e serve subito, anche per gli impianti installati prima di Flux.
- **S16 e S17 nella tappa 3, insieme a S13**: l'intervento è lo stesso oggetto per guasti e pulizie, e conviene costruirlo una volta sola.

## Cosa configurare subito (tappa 0)

La configurazione si fa in due parti:
- **con uno script**, che prepara in un colpo tutto ciò che è uguale per ogni installatore;
- **a mano**, per ciò che dipende da persone, credenziali o decisioni ancora aperte.

### 1. Con lo script

Lo script `scripts/setup-processo-operativo.ts` si lancia dalla cartella del progetto, sul workspace da configurare (il suo sottodominio). Prima mostra cosa farebbe senza scrivere nulla; si applica solo aggiungendo `--applica`:

```bash
# 1. anteprima: elenca cosa crea, cosa adatta, cosa c'è già; non scrive nulla
npx tsx scripts/setup-processo-operativo.ts <sottodominio> --rotazione=anna@azienda.it,luca@azienda.it --amministrazione=sara@azienda.it --assistenza=marco@azienda.it

# 2. se l'anteprima va bene, lo stesso comando con --applica
npx tsx scripts/setup-processo-operativo.ts <sottodominio> --rotazione=… --amministrazione=… --assistenza=… --applica
```

- `--rotazione`: gli operatori o agenti a cui i lead senza titolare vanno a turno;
- `--amministrazione`: chi riceve l'attività quando una trattativa è vinta;
- `--assistenza`: chi viene avvisato dei ticket urgenti e oltre lo SLA;
- `--valutazione` (facoltativo): attiva l'email di valutazione al cliente alla chiusura di un ticket.

Le persone si indicano con l'email con cui entrano in Flux. Senza un'opzione, le regole che ne hanno bisogno non vengono create, e l'anteprima lo dice.

**Le garanzie dello script:**
- **non cancella nulla e non cambia scelte già fatte**: crea solo ciò che manca, riconoscendolo dal nome;
- **adatta solo i valori iniziali mai toccati**: le fasi e i motivi di perdita in inglese con cui nasce ogni workspace. Vengono rinominati, e le trattative restano dove sono. Una fase già modificata a mano resta com'è;
- **crea le regole automatiche spente**: vanno lette e attivate da una persona;
- **si può rilanciare**: una seconda volta non cambia nulla.

**Cosa prepara:**

| Cosa | Dettaglio |
| --- | --- |
| Pipeline «Vendite» | Appuntamento fissato 20% · Sopralluogo fatto 40% · Preventivo inviato 60% · In negoziazione 75% · Vinta · Persa, con l'avviso di trattativa ferma dopo 7–14 giorni secondo la fase |
| Motivi di perdita | Prezzo troppo alto, Ha scelto un concorrente, Finanziamento non concesso, Tetto o impianto non idoneo, Nessun budget, Non ha deciso, Rimandato, Non risponde più |
| Campi personalizzati | Lead: Motivo di scarto (elenco), Campagna, Tipo di intervento. Trattativa: Tipo di intervento, Campagna, Data di firma, Pagamento. Azienda: Indirizzo di installazione, Potenza (kWp), Numero di pannelli. «Tipo di intervento» e «Campagna» sono uguali su lead e trattativa, così passano con la conversione |
| Gruppi | «Call center» e «Assistenza», senza membri |
| SLA | Escalation del ticket urgente al gruppo Assistenza; i tempi restano quelli attuali (decisione 17) |
| Sequenza «Primo contatto» | Chiamata il giorno 0, 1, 4 e 7, email il giorno 2, nei giorni lavorativi dalle 9 alle 18; si ferma se il lead risponde |
| Modelli email condivisi | Benvenuto, Conferma dell'appuntamento, Invio del preventivo, Sollecito del preventivo, Proposta di manutenzione |
| Macro dell'assistenza | Richiesta di foto e dati dell'inverter, Conferma della visita del tecnico, Chiusura della richiesta |
| Prodotti | Manutenzione annuale (1 o 2 pulizie), Diritto di chiamata, Ora di lavoro del tecnico, Trasferta: **spenti e a prezzo zero**, finché non si mette il prezzo |
| Regole automatiche (spente) | Vedi la tabella sotto |

| Regola | Quando | Cosa fa |
| --- | --- | --- |
| Assegna i lead senza titolare a rotazione | Lead creato senza titolare | Lo assegna al prossimo della rotazione, che riceve una notifica (serve `--rotazione`) |
| Lead da ADS o dal sito: sequenza «Primo contatto» | Lead creato con provenienza ADS Meta, ADS Google o Modulo web | Lo iscrive alla sequenza |
| Ogni mattina: lead nuovo non ancora contattato | Lead ancora «Nuovo» dopo un giorno | Avvisa il titolare |
| Ogni mattina: trattativa ferma da 10 giorni | Trattativa aperta senza attività da più di 10 giorni | Avvisa l'agente |
| Trattativa vinta: avvia la pratica | Trattativa vinta (anche dal preventivo convertito) | Attività per l'amministrazione: documenti del cliente e fattura d'acconto |
| Ordine completato: proponi la manutenzione | Ordine completato | Attività per il titolare: proporre la manutenzione |
| Ticket urgente: richiama il cliente | Ticket creato con priorità urgente | Avvisa il responsabile dell'assistenza e gli crea la chiamata per oggi (serve `--assistenza`) |
| Ticket oltre lo SLA: avvisa il responsabile | Ticket oltre il tempo promesso | Avvisa il responsabile dell'assistenza (serve `--assistenza`) |

### 2. A mano, dopo lo script

- [ ] **Utenti** (Amministrazione → Utenti):
  - operatori del call center (editor, gruppo «Call center»);
  - agenti (editor, un gruppo per zona);
  - operatori e tecnici dell'assistenza (gruppo «Assistenza»);
  - amministrazione, ufficio installazioni e responsabile commerciale come amministratori: devono vedere tutti i clienti.
- [ ] **Fasi della pipeline** (Impostazioni → Fasi pipeline): controllarle e adattarle alle fasi reali (decisione 1).
- [ ] **Provenienza** (Impostazioni → Elenchi): togliere quelle che non servono e unire i valori fuori elenco.
- [ ] **Prodotti** (Vendite → Prodotti): mettere il prezzo ai prodotti di manutenzione e assistenza e attivarli (decisione 16); per la pulizia, eventualmente un prezzo per fascia di kWp con i listini.
- [ ] **Sequenza e modelli email**: rileggere i testi e adattarli al vostro modo di scrivere (Marketing e automazioni → Sequenze; Impostazioni → Modelli email). Lì si possono aggiungere anche i 25 modelli di base di Flux.
- [ ] **Regole automatiche** (Marketing e automazioni → Automazioni): aprirle una per una, controllarle e attivarle.
  - Le email automatiche al cliente non sono create dallo script, perché scrivono ai clienti: il benvenuto alla vittoria, la chiusura e la richiesta di recensione all'ordine completato.
  - Si aggiungono dal costruttore con l'azione «Invia email» e i modelli già pronti. La richiesta di recensione ha bisogno del vostro link (Google o altro).
- [ ] **Assistenza**:
  - SLA (Assistenza → Gestione SLA): tempi per priorità, con orari di lavoro; urgente = impianto fermo (decisione 17);
  - valutazione del cliente alla chiusura, sulla stessa pagina, se non attivata con lo script;
  - etichette da usare tutti allo stesso modo: inverter, produzione, danni, monitoraggio, batteria.
- [ ] **Email in entrata**: l'indirizzo di assistenza inoltrato a Flux, perché le email diventino ticket e le risposte dei clienti arrivino alle schede. Si imposta con chi gestisce l'installazione di Flux (servizio di posta in entrata e suo segreto); senza, le sequenze non si accorgono delle risposte.
- [ ] **Moduli del sito** (Impostazioni → Moduli): attivare il modulo di contatto (lead) e quello di assistenza (ticket), con il titolare, e incorporarli nel sito.
- [ ] **Pagina di prenotazione** degli agenti (Profilo): durata e orari degli appuntamenti.
- [ ] **Clienti privati**: alla conversione Flux crea l'azienda intestataria a nome della persona, con nome e cognome nella scheda Fatturazione. Va completata con il codice fiscale prima della prima fattura; per i clienti già presenti Flux chiede nome e cognome prima di fatturare.
- [ ] **Integrazioni**:
  - ADS: una chiave API limitata ai lead (Impostazioni → Chiavi API) e lo scenario in Zapier o Make, che invii sempre la provenienza (`ads_meta`, `ads_google`) e la campagna;
  - fatturazione elettronica (Impostazioni → Fatturazione elettronica): dati dell'azienda e intermediario SDI (Aruba o Fatture in Cloud), da provare prima in ambiente di prova;
  - banca (Fatturazione e incassi → Banca): il conto e il formato dell'estratto (CAMT.053 o CSV).

Già attivo senza configurazione:
- notifiche: lead assegnato, attività in scadenza, promemoria appuntamenti, preventivo aperto o firmato, risposta del cliente, fattura scartata da SDI, contratto in scadenza di rinnovo;
- un'unica email ogni mattina con il lavoro del giorno e i ritardi.

## Cosa sviluppare

| Codice | Cosa | Perché | Taglia | Tappa |
| --- | --- | --- | --- | --- |
| S0 ✅ | Correggere le automazioni | «Crea attività» salvava un assegnatario non valido e falliva; le regole su «vinta» non scattavano dalla conversione in ordine | S | fatto |
| S1 ✅ | Provenienza strutturata | Elenco configurabile, anche sulla trattativa e nei report | S | fatto |
| S2 ✅ | Coda di lavoro completa | Richiami e chiamate del giorno; lead nuovi appena arrivano | S | fatto |
| S4 ✅ | Conversione completa | Pipeline scelta; provenienza, campi, appuntamenti e documenti copiati; cliente privato | S | fatto |
| S3 | Esiti del lead | L'esito aggiorna lo stato e crea il passo dopo. «Appuntamento fissato» crea l'appuntamento e passa il lead all'agente | M | 1 |
| S6 | Automazioni più ricche | Attività di tipo chiamata, «cambia fase», eventi su fattura e incasso; regole su date (es. «30 giorni dopo la consegna») | M | 1 |
| S7 | Sezione «Commesse» | Commessa collegata 1:1 all'ordine; «Avvia commessa» alla firma; fasi configurabili con condizioni che leggono l'ordine; tabellone; squadra; attività, appuntamenti e documenti collegati; scheda Economico con i dati dell'ordine | L | 2 |
| S8 | Checklist di fase | Attività create da un modello quando la commessa entra in una fase | M | 2 |
| S12 | Contratto di manutenzione dalla commessa | «Converti in contratto» dal preventivo firmato; contratto collegato a commessa, trattativa e preventivo; proposta preparata alla chiusura della commessa; contratti visibili sulla pagina del cliente e della commessa | M | 2 |
| S5 | Dati obbligatori | Campi richiesti per fase ed esito | M | 3 |
| S9 | Documenti da modelli | Modelli Word compilati con i dati del cliente e della commessa | M | 3 |
| S10 | Incassi e solleciti | L'incasso fa avanzare la commessa; sollecito automatico a scadenza | M | 3 |
| S11 | Report mancanti | Costo per lead per provenienza, velocità del call center, tempi di installazione, incassato per agente, adesione alla manutenzione | M | 3 |
| S13 | Interventi programmati | Pulizie per anno e mesi sul contratto, generate come interventi (S16); attività «Fissa la pulizia» in anticipo; interventi saltati in coda; disdetta che toglie quelli futuri | M | 3 |
| S14 | Canone e rinnovo | Bozza della fattura del canone all'attivazione e al rinnovo (o dopo ogni intervento); email al cliente prima del rinnovo | M | 3 |
| S15 | Ticket per l'impianto | Ticket aperto dalla pagina del cliente, dell'ordine o della commessa; collegamento a commessa e contratto; foto caricate dalla pagina del ticket e dal modulo web; tipo, categoria e gruppo modificabili; categorie configurabili; API dei ticket per VoipAI | M | 2 |
| S16 | Interventi sul posto | L'intervento: da un ticket o da un contratto di manutenzione (con S13); tecnico o squadra, appuntamento con invito e promemoria; rapportino dal telefono con esito, ore, materiali, foto e firma; PDF al cliente; più interventi per ticket | L | 3 |
| S17 | Garanzia e addebito | Garanzie e matricole sulla scheda dell'impianto; copertura proposta da garanzie e contratto; ordine e fattura dall'intervento a pagamento, con il listino del cliente | M | 3 |

Taglie: S pochi giorni, M una o due settimane, L tre o quattro settimane.

✅ = fatto il 1 ottobre 2026, con test e mutazioni. In particolare:
- la provenienza si gestisce in Impostazioni → Elenchi, la trattativa la eredita dal lead, e nel funnel c'è «Vinte per provenienza» (numero e valore);
- la conversione chiede la pipeline e, per un lead senza azienda, se è un cliente privato.

Corretto dopo:
- **fattura del cliente privato**: l'azienda intestataria porta nome e cognome della persona (scheda Fatturazione, compilati dalla conversione). La fattura elettronica scrive `<Nome>` e `<Cognome>` invece di `<Denominazione>`, e Fatture in Cloud riceve il cliente come persona;
- **provenienza dall'API**: aggiornare un lead, un contatto o un'azienda senza indicare la provenienza non la sovrascrive più con «api»;
- **contratto e trattativa**: modificare un contratto non cancella più il suo collegamento alla trattativa;
- **clienti privati già presenti**: un cliente con codice fiscale personale e senza partita IVA non può più ricevere fattura finché non ha nome e cognome. Flux lo segnala tra i dati mancanti della fattura e sulla pagina dell'azienda, così nessuno resta fatturato come azienda per dimenticanza.

Non resta aperto nessun difetto noto. Restano le decisioni elencate in fondo.

Integrazioni da valutare dopo la tappa 3:
- **open banking**: movimenti bancari senza importare file;
- **firma elettronica avanzata**: per i contratti;
- **telefonia** (VoipAI o centralino): chiamata con un clic e registrazione automatica.

## Report e KPI

**Pronti**:
- lead per provenienza;
- vinte per provenienza, con il valore;
- imbuto lead → trattativa → vinta;
- scheda per agente: vinto contro obiettivo, tasso di vittoria, ciclo medio, chiamate e appuntamenti;
- previsione;
- motivi di perdita;
- provvigioni sul vinto;
- cassa: incassato, fatturato, scaduto per anzianità, DSO, acconti da fatturare;
- contratti: attivi, in rinnovo, ricavo ricorrente mensile;
- assistenza: ticket ricevuti e risolti, tempi di prima risposta e di risoluzione, rispetto degli SLA, giudizio dei clienti, per operatore.

**Con gli sviluppi S11, S13, S14, S16 e S17**:
- costo per lead per provenienza;
- tempo al primo contatto;
- commesse per fase e tempi di installazione;
- incassato per agente;
- adesione alla manutenzione: contratti attivati sugli impianti installati;
- interventi fatti, da fissare e in ritardo;
- canoni fatturati e incassati, rinnovi e disdette;
- guasti per impianto e per categoria, interventi per ticket, risolti al primo passaggio;
- tempo dalla segnalazione all'intervento;
- interventi in garanzia, coperti dal contratto e a pagamento, con il costo della garanzia.

## Da decidere prima di partire

1. Le fasi reali della Pipeline 1 e cosa serve per passare dall'una all'altra.
2. Quali pratiche pre e post installazione, a quali enti, con quali documenti: servono i modelli per S9.
3. Percentuali e scadenze degli acconti (es. 30% alla firma, 30% prima dell'installazione, 40% saldo).
4. Si installa dopo l'incasso del secondo acconto o basta averlo emesso?
5. Squadre di installazione interne (calendario in Flux) o installatori esterni?
6. Provvigioni sul vinto, come oggi, o sull'incassato?
7. Intermediario SDI e banca: l'estratto è disponibile in CAMT.053?
8. Telefonia degli operatori: VoipAI, centralino o cellulare?
9. Manutenzione: la si propone solo a fine installazione o anche come voce facoltativa del preventivo iniziale?
10. Il canone si fattura una volta l'anno in anticipo, o dopo ogni pulizia? Durata, rinnovo tacito e preavviso di disdetta?
11. Sulla manutenzione si pagano provvigioni? Se sì, serve una pipeline «Manutenzioni».
12. Chi fa le pulizie (stesse squadre dell'installazione o esterni) e in quali mesi?
13. Commessa: si adotta la sezione «Commesse» collegata all'ordine (strada C)? Con quale nome, «Commesse» o «Lavori»?
14. Assistenza: chi fa gli interventi (le squadre di installazione, tecnici dedicati, esterni) e chi decide garanzia o addebito?
15. Garanzie: durata della garanzia sulla manodopera, garanzie dei prodotti da registrare, e se servono le matricole.
16. Tariffe dell'assistenza: diritto di chiamata, ora, trasferta; cosa include il contratto di manutenzione.
17. Tempi promessi: entro quanto si risponde e si interviene per un impianto fermo, e se i clienti con contratto hanno tempi migliori.

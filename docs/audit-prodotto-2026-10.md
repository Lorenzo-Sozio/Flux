# Audit Flux CRM — Ottobre 2026

Versione analizzata: **2.2.0** · ramo `main`
Perimetro: 73 pagine, 44 file di azioni server, 51 rotte API, 64 tabelle
Verifiche alla data dell'analisi: 91 test superati, `tsc --noEmit` pulito

66 rilievi. Nessuno è un errore di compilazione: sono comportamenti.

## Stato degli interventi

Aggiornato dopo il primo ciclo di correzioni.

| | |
|---|---|
| ✅ Risolti | 35 |
| ◐ Parziali | 4 |
| Aperti | 27 |

Verifiche dopo le correzioni: build di produzione riuscito, `tsc --noEmit` pulito,
**134 test** superati (erano 91), **86 mutazioni su 86** catturate (erano 78), zero
segnalazioni di correttezza da Biome sui file toccati. Tre nuove suite coprono il
modello dei permessi, l'aritmetica dei documenti commerciali e l'allineamento delle
traduzioni — cioè le tre aree dove un guasto somiglia a un successo.

Una migrazione tenant, `0002_odd_ulik.sql`, aggiunge le colonne mancanti (data di
chiusura e motivo di perdita sulle trattative, imponibile/imposta/valuta sugli ordini,
fasi terminali sulla pipeline, scadenza di prima risposta sui ticket) e ripopola i dati
esistenti. **Va applicata a ogni database tenant prima del deploy.**

Legenda: ✅ risolto · ◐ risolto in parte, il resto è annotato nel rimedio.

> Nessuna credenziale, chiave o stringa di connessione è riprodotta in questo
> documento. La variabile `NXTAUTH_URL` è citata solo per il refuso nel nome.

---

## Sintesi

Flux è un prodotto ambizioso e costruito con cura in molti punti: la firma HMAC dei
webhook con validazione anti-SSRF, la cifratura AES-GCM delle connessioni per tenant,
il rilevatore di cicli nel motore di automazione, la Content-Security-Policy con nonce
per richiesta, il registro di audit sui ticket e una suite di test mirata proprio sul
confine che conta.

Il problema non è la qualità dei singoli pezzi, è che **il passaggio a un'architettura
multi-tenant è stato completato solo per metà del prodotto**. Tutto ciò che sta dentro
la dashboard autenticata funziona. Tutto ciò che sta fuori da quella porta — pagine
pubbliche, email in uscita e in entrata, job schedulati, registrazione, recupero
password — cerca il tenant in un header che quelle richieste non ricevono mai.

Sopra questo si sovrappone un secondo problema: **esistono due sistemi di ruoli che non
si parlano**. Il proprietario di un workspace non riesce ad aprire le proprie
Impostazioni, mentre un suo amministratore può salire ai privilegi di piattaforma.

Questi due difetti spiegano la maggior parte dei rilievi. Sistemati quelli, il resto è
lavoro di prodotto: chiudere i cicli operativi che si interrompono, togliere le funzioni
che promettono senza mantenere, e aggiungere lo strato che fa la differenza tra un CRM
che registra e uno che suggerisce.

| Categoria | Rilievi |
|---|---|
| Blocchi in produzione | 8 |
| Permessi e ruoli | 6 |
| Funzioni inerti | 9 |
| Dati e denaro | 10 |
| Coerenza del modello | 9 |
| Esperienza d'uso | 13 |
| Opportunità | 11 |

---

## 1. Cose che in produzione non funzionano

Non sono ipotesi di degrado: sono percorsi che terminano con un'eccezione o con un dato
irrecuperabile ogni volta che vengono percorsi.

### B-01 ✅ — Tutta la superficie pubblica cerca il tenant in un header che non riceve

**Cosa.** `getDb()` legge `x-tenant-id`, iniettato dal proxy solo sulle rotte
`/dashboard` e sulle API con sessione, e lancia un'eccezione se manca. Lo chiamano
comunque: il preventivo pubblico, il tracking di apertura, il tracking di click, la
disiscrizione, l'RSVP degli appuntamenti, il webhook Resend e la creazione ticket da
email in ingresso.

**Perché è un limite.** Il cliente che apre il link del preventivo riceve un errore
server. Il tracking dei click è un redirect: se fallisce, **ogni link dentro ogni email
di campagna è morto**. Il link di disiscrizione restituisce 500, il che è un problema
anche di conformità. I rimbalzi non popolano la lista di soppressione. Le email in
ingresso non diventano ticket.

**Rimedio.** Risolvere il tenant dal dato stesso — token del preventivo, id del log di
campagna, indirizzo di destinazione — tramite un indice di lookup sul database di
piattaforma, poi aprire la connessione con `createTenantDb()`. E rendere `getDb()`
utilizzabile solo dal contesto dashboard.

### B-02 ✅ — I sette job schedulati non girano

**Cosa.** Stessa causa. Ogni rotta sotto `/api/cron/` chiama `getDb()` direttamente o
tramite le funzioni che invoca, e nessuna itera i tenant. La documentazione afferma che
i cron scorrono tutti i tenant sul database di piattaforma: il codice non lo fa. In più
`CRON_SECRET` non è impostato nell'ambiente locale e la verifica fallisce in chiusura.

**Perché è un limite.** Le email di campagna restano in coda per sempre. Nessuno SLA
viene mai valutato. I webhook falliti non vengono mai ritentati, quindi gli eventi in
uscita sono *at-most-once* e non *at-least-once* come dichiarato. Nessun promemoria. I
ticket risolti non si chiudono mai. Un job che non parte non produce log.

**Rimedio.** Un helper `forEachTenant()` che legge la tabella dei tenant e apre una
connessione per ciascuno. Una tabella di esecuzione con timestamp dell'ultimo run, e un
avviso quando un job non gira da più del suo intervallo.

### B-03 ✅ — Registrazione e recupero password sono senza via d'uscita

**Cosa.** Registrazione, richiesta reset e reset password chiamano `getDb()`, ma le
pagine di autenticazione sono pubbliche e non portano il tenant. In più il reset
scriverebbe nel database del tenant, mentre il login autentica sul database di
piattaforma.

**Perché è un limite.** Chi dimentica la password non ha alcun percorso di recupero. Il
form mostra comunque «Controlla la posta», perché il blocco di cattura è generico.

**Rimedio.** Le tre azioni devono usare il database di piattaforma. Il messaggio di
conferma va mostrato solo dopo un esito reale.

### B-04 ✅ — Ogni link dentro le email punta a localhost

**Cosa.** L'invio campagne e le email transazionali costruiscono gli URL da
`NEXTAUTH_URL`; la fatturazione e il worker Cloudflare da `NEXT_PUBLIC_APP_URL`.
Nell'ambiente attuale la prima è scritta `NXTAUTH_URL` — manca una lettera — e la
seconda non è definita. Entrambe hanno lo stesso fallback: `http://localhost:3000`.

**Perché è un limite.** Inviti, reset password, promemoria, pixel di tracking,
disiscrizione e link ai preventivi escono verso l'indirizzo locale dello sviluppatore.
Nessuna eccezione, nessun avviso.

**Rimedio.** Una sola costante `APP_URL` esportata da un unico modulo, senza fallback,
che interrompe l'avvio se la variabile manca.

### B-05 ✅ — Ventitré variabili d'ambiente usate dal codice non sono nell'esempio

**Cosa.** Tra le assenti: `PLATFORM_ENCRYPTION_KEY` (senza la quale la decifratura delle
connessioni tenant lancia e l'app non serve nemmeno una pagina), `ADMIN_SESSION_SECRET`,
`TRACKING_SECRET`, `IMPORT_API_KEY`, i segreti dei webhook in entrata e l'intera
configurazione SMTP.

**Perché è un limite.** Un nuovo ambiente configurato seguendo l'esempio fallisce con
errori che non nominano la variabile mancante.

**Rimedio.** Allineare l'esempio, raggrupparlo per funzione, e aggiungere una verifica
all'avvio che elenchi in un colpo solo tutte le variabili assenti.

### B-06 — Gli allegati vivono sul filesystem locale

**Cosa.** L'endpoint di caricamento scrive su disco con `writeFile`. Su Vercel il
filesystem è effimero e per-istanza; su Workers non esiste. La documentazione segnala
solo il secondo caso.

**Perché è un limite.** Un file può risultare illeggibile già alla richiesta successiva,
e sparisce a ogni deploy.

**Rimedio.** Object storage con URL firmati a scadenza. Estendere gli allegati a ticket,
preventivi e ordini, oggi esclusi, e contare lo spazio verso il limite di piano.

### B-07 ✅ — Nessuna delle 73 pagine ha un confine di caricamento o di errore

**Cosa.** Zero `loading.tsx`, zero `error.tsx`, zero `<Suspense>`. Ogni pagina attende
tutte le proprie query prima di produrre un pixel.

**Perché è un limite.** Alla pressione di una voce di menu l'interfaccia resta ferma
sulla pagina precedente: l'applicazione sembra bloccata. E qualsiasi eccezione produce
la schermata bianca predefinita di Next con un codice diagnostico.

**Rimedio.** Uno scheletro per gruppo di rotte, un `error.tsx` che distingua permesso
negato, limite di piano ed errore tecnico, e `<Suspense>` sui riquadri secondari.

### B-08 — Le liste caricano l'intera tabella, tutte le colonne

**Cosa.** Contatti, lead e aziende selezionano ogni colonna di ogni riga e passano il
risultato a un componente client. Nessun limite, nessuna paginazione, nessun ordinamento
lato server, nessun campo di ricerca testuale.

**Perché è un limite.** A poche migliaia di record la pagina diventa megabyte di JSON e
secondi di attesa; a decine di migliaia non si apre. Sono le tre schermate più visitate.

**Rimedio.** Paginazione a cursore lato server, selezione delle sole colonne mostrate,
ricerca e ordinamento nei parametri dell'URL.

---

## 2. Due sistemi di ruoli che non si parlano

Il difetto singolo con più conseguenze nel prodotto. Genera insieme un blocco funzionale
grave e una scalata di privilegi tra clienti diversi.

### P-01 ✅ — Il proprietario di un workspace non riesce ad aprire le proprie Impostazioni

**Cosa.** Convivono due ruoli. `users.role` vive sul database di piattaforma ed è quello
che la schermata Utenti modifica. `tenantMembers.role` è assegnato una volta
all'accettazione dell'invito ed è quello che `requireWriteAccess` e
`requireAdminAccess` leggono. Le *pagine* controllano il primo. Chi si registra o viene
invitato ha `users.role` pari a `"user"`.

**Perché è un limite.** Ogni pagina che richiede `["admin","owner"]` rimbalza l'utente
alla dashboard. **Impostazioni, Utenti, Fatturazione, Webhook, Campi personalizzati e
configurazione Pipeline sono irraggiungibili per il proprietario stesso del workspace**,
in silenzio, senza messaggio.

**Rimedio.** Un solo ruolo autorevole dentro il workspace, quello della membership, con
`users.role` ridotto a identificare lo staff di piattaforma. Un unico helper
`can(azione)` condiviso da pagine, azioni server e interfaccia.

### P-02 ✅ — Promuovere un collega ad amministratore gli apre il pannello di piattaforma

**Cosa.** La schermata Utenti scrive `users.role`. Il login del pannello di piattaforma
accetta chiunque abbia quel campo pari a `admin` o `owner`. Quel pannello governa tutti
i tenant, le loro stringhe di connessione e la fatturazione. In più le guardie trattano
il ruolo di piattaforma come bypass esplicito di ogni controllo di workspace.

**Perché è un limite.** Un'azione ordinaria dentro un workspace concede privilegi su
tutti gli altri workspace, senza alcun exploit: solo un menu a tendina.

**Rimedio.** Separare le due scale. Il ruolo assegnato dentro un workspace non deve mai
essere accettato come credenziale di piattaforma.

### P-03 ✅ — L'invito utente non ha alcun controllo d'accesso

**Cosa.** L'azione di invito non chiama `auth()` né alcuna guardia. Riceve dal client
sia il ruolo da assegnare sia l'identità di chi invita.

**Perché è un limite.** Chi raggiunge l'azione può emettere un invito con ruolo `owner`
e ottenere un account di piattaforma. Anche il mittente dell'invito è falsificabile.

**Rimedio.** Guardia di amministratore in testa, ruolo validato contro un enum chiuso,
mittente preso dalla sessione.

### P-04 ✅ — La schermata Utenti mostra gli utenti di tutti i clienti

**Cosa.** La funzione che alimenta la pagina restituisce tutti gli utenti del database
di piattaforma senza filtro sul tenant. Lo stesso per gli inviti in sospeso.

**Perché è un limite.** L'amministratore del cliente A legge nome ed email degli utenti
del cliente B.

**Rimedio.** Join sulla tabella delle membership filtrata sul tenant attivo.

### P-05 ✅ — Cancellare o promuovere colpisce qualunque utente della piattaforma

**Cosa.** Cancellazione e cambio ruolo operano sul database di piattaforma per
identificativo, senza verificare che il bersaglio appartenga al workspace del chiamante.

**Perché è un limite.** Un amministratore del cliente A può cancellare l'account di un
utente del cliente B, o promuovere sé stesso.

**Rimedio.** Verificare la membership del bersaglio nel tenant attivo prima di ogni
scrittura, e impedire l'auto-promozione.

### P-06 ✅ — Il modulo Supporto ignora del tutto le guardie del progetto

**Cosa.** 27 azioni server nel file del supporto, nessuna delle quali chiama le guardie
condivise. SLA e canali chat verificano `session.user.role === "admin"`, cioè il ruolo di
piattaforma, che per un cliente non è mai vero. Ticket, messaggi, riassegnazioni e macro
non verificano nulla oltre l'essere autenticati.

**Perché è un limite.** Il ruolo *viewer*, documentato come sola lettura ovunque, può
aprire ticket, **scrivere risposte che partono verso il cliente**, riassegnare e creare
macro. Nello stesso file, il proprietario del workspace non può creare uno SLA.

**Rimedio.** Allineare l'intero file all'helper `can()`. Aggiungere un test che
fallisca se una nuova azione server esportata non invoca una guardia.

> **Nota sulla documentazione.** `CLAUDE.md` afferma che il middleware protegge per ruolo
> le rotte Utenti, Ruoli e Impostazioni. Nel proxy attuale non esiste alcun controllo di
> ruolo: solo autenticazione e presenza del tenant.

---

## 3. Funzioni presenti nell'interfaccia, inerti nei fatti

Le più dannose per la fiducia: l'utente le configura, le vede attive, e non succede
nulla. Nessuna segnala il proprio silenzio.

### D-01 ✅ — Nessun ticket riceve mai uno SLA

**Cosa.** Alla creazione del ticket la funzione che calcola la scadenza è invocata con il
parametro cablato a `null`. Non esiste una regola che associ la priorità del ticket a uno
SLA configurato. Il campo scadenza resta sempre vuoto.

**Perché è un limite.** Pagina SLA, indicatore di conformità, badge «SLA in scadenza» e
statistiche del supporto restano vuoti per costruzione. Il cron non troverebbe nulla da
rilevare. Un modulo intero è decorativo.

**Rimedio.** Selezionare lo SLA attivo per priorità alla creazione e al cambio priorità.
Separare la scadenza di prima risposta da quella di risoluzione. Introdurre gli orari
lavorativi.

### D-02 ✅ — Le automazioni su contatti, lead e aziende non partono mai

**Cosa.** Il costruttore offre cinque entità bersaglio. Il motore è invocato solo da
trattative e ticket. Una regola su un contatto si salva, si attiva e non viene mai
eseguita.

**Perché è un limite.** È la funzione che l'utente configura con più aspettative e
verifica con meno frequenza.

**Rimedio.** Agganciare il motore alle azioni di contatti, lead e aziende, e a task,
preventivi e ordini. Nell'immediato: non offrire entità che il motore non osserva.

### D-03 ✅ — L'approvazione dei preventivi non approva niente

**Cosa.** Approvazione e rifiuto riportano entrambi il preventivo a bozza; l'unica
differenza è una nota. L'azione di aggiornamento generica permette comunque di passare
direttamente a «inviato».

**Perché è un limite.** Il controllo sui margini non esiste, e la presenza del flusso
scoraggia dall'aggiungerne uno vero.

**Rimedio.** Uno stato «approvato» distinto, invio consentito solo da lì quando la
soglia scatta, e soglia configurabile su sconto o importo.

### D-04 ✅ — Configurare le fasi della pipeline richiede di digitare l'URL a mano

**Cosa.** Le pagine di configurazione pipeline e macro non compaiono né nella barra
laterale né nell'indice delle Impostazioni.

**Perché è un limite.** Rinominare una fase è la prima cosa che fa chiunque adotti un
CRM. E un workspace nuovo non ha fasi: la prima conversione di un lead fallisce con
«No pipeline stages found».

**Rimedio.** Aggiungere le due voci a sidebar e indice, e creare le fasi predefinite alla
creazione del workspace.

### D-05 ✅ — La pagina Analytics è orfana e il suo unico pulsante porta a un 404

**Cosa.** Non è raggiungibile dalla navigazione e il suo pulsante punta a
`/dashboard/analytics/funnel`, che non esiste. I contenuti duplicano Report e i report di
pipeline.

**Rimedio.** Assorbire i riquadri utili dentro Report e rimuovere la pagina, oppure
inserirla in navigazione e correggere il link.

### D-06 — La tabella `opportunity` è morta, ma vincola gli ordini

**Cosa.** Nessuna query, nessuna azione, nessuna interfaccia la tocca. Ma la tabella
ordini ha ancora una chiave esterna verso di essa.

**Perché è un limite.** Un ordine non può essere collegato alla trattativa o al
preventivo che lo ha generato. È la causa strutturale di S-03.

**Rimedio.** Migrare il riferimento verso trattativa e preventivo, poi eliminare la
tabella.

### D-07 — I limiti di piano quasi non esistono

**Cosa.** `requirePlanModule` non è invocato da nessuna azione server.
`requirePlanLimit` è applicato solo a contatti, lead, aziende e trattative. Task,
ticket, preventivi, ordini, prodotti e documenti non contano nulla; `storageGb` non è
mai verificato.

**Perché è un limite.** I piani a pagamento non cambiano di fatto ciò che il prodotto
consente.

**Rimedio.** Un contatore d'uso aggiornato a ogni scrittura e verificato in un unico
punto, valido anche per le API.

### D-08 ✅ — Un modulo non incluso nel piano rimbalza l'utente al punto di partenza

**Cosa.** La barra laterale mostra ogni modulo senza filtro. Chi apre un modulo non
incluso viene mandato dal layout alla pagina di fatturazione, che lo rimanda alla
dashboard per il controllo di ruolo di P-01.

**Rimedio.** Voce con lucchetto e una riga che dica cosa sblocca il piano superiore.
Pagina di fatturazione sempre raggiungibile.

### D-09 ✅ — Il registro delle automazioni non distingue «non si applicava» da «è fallita»

**Cosa.** Il blocco `finally` scrive una riga anche quando le condizioni non erano
soddisfatte, marcandola come non riuscita. Ogni modifica produce una riga per ogni regola
attiva. Nessuna politica di conservazione.

**Perché è un limite.** La tabella diventa illeggibile proprio quando serve. Le regole
girano tutte in parallelo senza priorità: due regole che scrivono lo stesso campo si
sovrascrivono in ordine non deterministico.

**Rimedio.** Non registrare i mancati match, o registrarli come esito distinto.
Conservazione a scadenza e un campo di priorità che ordini l'esecuzione.

---

## 4. Correttezza dei dati e del denaro

Il CRM produce documenti che il cliente legge e numeri su cui si decide. Questi rilievi
non generano errori: generano cifre sbagliate.

### C-01 ✅ — L'IVA sui preventivi è applicata due volte

**Cosa.** `calculateLineTotal` restituisce un totale già comprensivo di imposta. Il
totale di documento somma quei valori in un campo chiamato `subtotal`, poi ci applica
sopra lo sconto di testata e infine l'IVA di testata.

**Perché è un limite.** Il documento che raggiunge il cliente riporta un totale sbagliato
e uno scorporo che non torna.

**Rimedio.** Sommare l'imponibile netto di riga, applicare lo sconto sull'imponibile,
calcolare l'imposta una sola volta e raggruppata per aliquota.

### C-02 ✅ — La valuta del preventivo viene persa alla creazione

**Cosa.** La valuta d'ingresso è usata per convertire in euro, poi il campo valuta è
scritto fisso a `EUR`. L'informazione originale non è conservata.

**Perché è un limite.** Il documento arriva al cliente sempre in euro anche se l'offerta
era in dollari. Per una trattativa internazionale è inutilizzabile.

**Rimedio.** Conservare importo e valuta d'origine come dato primario, con la conversione
come colonna derivata, e memorizzare il tasso applicato.

### C-03 ✅ — Aprire e salvare un preventivo ne cambia i totali

**Cosa.** La creazione converte in euro; l'aggiornamento no, riscrive i prezzi grezzi.

**Perché è un limite.** Modificare una riga di un preventivo non in euro ne altera
silenziosamente l'importo.

**Rimedio.** Un'unica funzione di calcolo condivisa da creazione e aggiornamento.

### C-04 ✅ — Gli ordini non hanno imposta, sconto né valuta

**Cosa.** La creazione converte in euro; aggiunta e rimozione di riga ricalcolano il
totale senza conversione e senza applicare l'aliquota del prodotto.

**Perché è un limite.** Un ordine con lo stesso contenuto di un preventivo mostra un
totale diverso.

**Rimedio.** Allineare il modello dell'ordine a quello del preventivo e generare
l'ordine dal preventivo.

### C-05 ✅ — Il numero d'ordine può collidere

**Cosa.** Prefisso con data più quattro cifre casuali su colonna unica, senza
ritentativo. Preventivi e ticket usano schemi diversi.

**Perché è un limite.** La collisione arriva come errore SQL grezzo. E una numerazione
casuale non è ciò che si aspetta da un documento commerciale.

**Rimedio.** Una sequenza per tenant e per anno, con formato configurabile, condivisa da
preventivi, ordini e ticket.

### C-06 ✅ — Trascinare una trattativa su «Vinto» non la chiude

**Cosa.** Lo spostamento di fase aggiorna `stageId` ma non `status`. La stessa funzione
sovrascrive la probabilità impostata a mano con il default della fase.

**Perché è un limite.** Il gesto più naturale della board non chiude la trattativa, che
continua a pesare sul forecast per sempre.

**Rimedio.** Marcare le fasi terminali come vinta o persa e sincronizzare lo stato.
Applicare la probabilità predefinita solo quando l'utente non l'ha modificata.

### C-07 ✅ — Non esiste una data di chiusura né un motivo di perdita

**Cosa.** Il «vinto questo mese» è calcolato su `updatedAt`. Non esiste un campo per il
motivo della perdita.

**Perché è un limite.** Riaprire una trattativa vecchia la fa rientrare nel fatturato del
mese corrente. E senza motivo di perdita non si può fare l'analisi win/loss.

**Rimedio.** Un campo `closedAt` scritto al passaggio di stato, e `lostReason`
obbligatorio con elenco configurabile.

### C-08 ✅ — Il forecast scarica nel sesto mese tutto ciò che non sa collocare

**Cosa.** Le trattative senza data attesa *e* quelle con data scaduta finiscono nello
stesso ultimo intervallo. «Impegnato» e «caso migliore» sono entrambi ponderati per
probabilità. L'etichetta di valuta è presa dalla prima trattativa dell'elenco.

**Perché è un limite.** Un mese futuro appare gonfio di pipeline morta, e le due righe
che il management guarda sono sottostimate.

**Rimedio.** Intervalli espliciti «senza data» e «scaduto», cliccabili. «Impegnato» come
somma piena, non ponderata. Valuta di presentazione unica e dichiarata.

### C-09 — Il totale dei report è il numero di righe troncate

**Cosa.** Il costruttore restituisce come totale la lunghezza dell'array già limitato a
mille righe. Il raggruppamento su una data raggruppa per timestamp esatto.

**Rimedio.** Una `COUNT` separata, e raggruppamento temporale per giorno, mese o
trimestre.

### C-10 ✅ — Il timer accetta dal client l'identità di chi registra le ore

**Cosa.** Avvio timer e registrazione manuale ricevono l'utente come parametro. Non
verificano che un timer sia già in corso, né limitano la durata.

**Perché è un limite.** Un consuntivo di ore così non è difendibile. Un timer
dimenticato registra sedici ore.

**Rimedio.** Identità dalla sessione, un solo timer attivo per utente, chiusura
automatica oltre soglia, verifica di proprietà sull'arresto.

---

## 5. Dove il prodotto si contraddice

Non difetti, biforcazioni: due modi di fare la stessa cosa, che raddoppiano il costo di
apprendimento e quello di manutenzione.

### M-01 — Tre modi diversi di fissare un incontro

Un incontro può essere un'attività di tipo `meeting` (partecipanti in stringa libera,
nessuna ora di fine), un appuntamento (tabella dedicata, invitati, RSVP, iCal) o un task
con orario. Il calendario li unisce, ma dietro ci sono tre modali e tre modelli. Il
titolo di un'attività sul calendario è il corpo della nota troncato a 50 caratteri.

**Rimedio.** L'appuntamento come unico oggetto d'agenda. L'attività torna a essere il
registro di ciò che è successo. Il task resta l'unità di lavoro.

### M-02 — Cinque entità per lo stesso arco commerciale

Lead, contatto, azienda, opportunità e trattativa, con campi ampiamente sovrapposti:
indirizzo, sorgente, punteggio e consensi marketing duplicati tra lead e contatto.

**Rimedio.** Eliminare l'opportunità. Valutare il lead come stato del contatto anziché
tabella parallela.

### M-03 — La conversione del lead non è atomica e non riconosce i duplicati

Otto scritture in sequenza senza transazione — un commento nel codice ne annuncia una
che non c'è. L'azienda è cercata per uguaglianza esatta del nome. Il contatto non è
controllato, benché `checkContactDuplicates` esista nello stesso file. La trattativa
nasce a zero, senza data attesa.

**Rimedio.** Transazione. Riusare il rilevamento duplicati con nome normalizzato e
partita IVA. Chiedere valore e data attesa nello stesso passaggio.

### M-04 — Nessuna azione usa una transazione

Preventivi, ordini e conversioni scrivono le righe in ciclo. L'aggiornamento di un
preventivo cancella tutte le righe e le reinserisce: un errore dopo la cancellazione
lascia un preventivo vuoto.

**Rimedio.** Transazione attorno a ogni scrittura multi-tabella, e inserzione in blocco.

### M-05 ◐ — Gli ordini vivono fuori dal flusso del prodotto

Nessun webhook, nessuna automazione, nessuna attività registrata, nessun collegamento a
preventivo o trattativa. `CLAUDE.md` descrive una sequenza precisa e questo modulo ne
esegue solo le prime tre voci.

**Rimedio.** Allineare il modulo al pattern documentato ed emettere gli eventi di ciclo
di vita.

### M-06 — Due sistemi di chat che non si conoscono

Canali e sessioni di chat per il visitatore da un lato, conversazioni dirette interne
dall'altro. La seconda ha una pagina; la prima solo azioni server.

**Rimedio.** Completare la chat verso il cliente come canale del supporto, o rimuoverla.

### M-07 — Due interfacce di autenticazione e tre percorsi di login

`/auth/v1/*` e `/auth/v2/*` coesistono, `/login` reindirizza. Nel codice il
reindirizzamento verso `/login` compare in 13 punti e verso il percorso completo in 3.

**Rimedio.** Una sola versione, e un'unica costante per il percorso di login.

### M-08 — Validazione a due velocità

Preventivi, ticket e SLA validano con Zod. Lead, contatti e aziende accettano
`data: any` e lo passano all'ORM.

**Rimedio.** Uno schema condiviso tra form client e azione server.

### M-09 ◐ — Due librerie di trascinamento e due lingue nei commenti

`@hello-pangea/dnd` e `@dnd-kit` sono entrambe nel bundle. I commenti alternano italiano
e inglese, a volte nello stesso file.

**Rimedio.** Una sola libreria e una sola lingua per il codice.

---

## 6. Attrito quotidiano

Chi usa il CRM otto ore al giorno paga questi rilievi ogni volta.

### U-01 ✅ — Ogni errore arriva come lo stesso messaggio generico

Il pattern in tutte le modali è `catch { toast.error(t("form.saveFailed")) }`.
`ForbiddenError` e `EntitlementError` portano già un testo utile che viene scartato.
Permesso negato, limite di piano e rete caduta sono indistinguibili.

**Rimedio.** Serializzare il tipo di errore nel risultato dell'azione e mostrarlo. Per il
limite di piano, un pulsante che porti all'upgrade.

### U-02 ✅ — Il viewer vede pulsanti che non possono funzionare

`canEdit` è calcolato su `session.user.role !== "viewer"`, cioè sul ruolo di piattaforma
che per un cliente vale sempre `"user"`. Il viewer compila l'intera scheda e riceve
l'errore generico al salvataggio.

**Rimedio.** Lo stesso helper `can()` usato dalle guardie, condiviso con l'interfaccia.

### U-03 ✅ — La scorciatoia è ⌘J, e la palette sa solo cercare

⌘J invece del ⌘K universale. Non lancia azioni, non ricorda gli ultimi record aperti, e
quando non trova nulla non propone di creare.

**Rimedio.** Si veda S-01.

### U-04 ✅ — La ricerca non trova le persone come le si cerca

Il termine è confrontato separatamente con nome e cognome, quindi «Mario Rossi» non
restituisce nulla. Telefono e cellulare non sono cercati affatto. Task, note, attività,
prodotti e campagne sono fuori dall'indice.

**Rimedio.** Ricerca sul nome completo concatenato, numeri normalizzati, indici trigram,
e una pagina «tutti i risultati».

### U-05 ✅ — La board si stringe fino a diventare illeggibile

Le colonne si dividono lo spazio senza larghezza minima e senza scorrimento orizzontale.
Il totale di fase è un numero senza simbolo di valuta. Su touch il trascinamento non
funziona e non esiste alternativa da tastiera.

**Rimedio.** Larghezza minima con scorrimento orizzontale, totali con valuta esplicita, e
un'azione «sposta in fase» dal menu della scheda.

### U-06 ◐ — Le date parlano tre lingue diverse, nessuna scelta dall'utente

La dashboard formatta con `it-IT` cablato, il forecast con `en-US`, il worker email con
`en-GB`. Il fuso orario è quello del server, in produzione UTC.

**Rimedio.** Formattazione dal locale attivo. Fuso orario per utente nel profilo.

### U-07 ✅ — 56 chiavi mancano in italiano, tutte nella finestra di lancio campagna

2384 chiavi italiane contro 2440 inglesi, concentrate in un unico dialogo. Nessun locale
di ripiego configurato: l'utente italiano legge i percorsi delle chiavi.

**Rimedio.** Completare le traduzioni, configurare il ripiego, e un test che fallisca
quando i due file divergono.

### U-08 ✅ — La lingua è un cookie, e metà del prodotto la ignora

Nessun rilevamento dal browser, nessun salvataggio nel profilo, default inglese. Intanto
sono in italiano fisso: notifiche, etichette di stato dei preventivi, messaggi del login
amministratore e documentazione API.

**Rimedio.** Preferenza nel profilo, rilevamento iniziale dall'intestazione, e le stringhe
rimaste nel codice portate nei file di traduzione.

### U-09 — I campi personalizzati non sono dove servono

Solo come pannello nella scheda di dettaglio di contatti, lead e aziende. Non nella
trattativa, benché il tipo sia previsto. Non nelle modali di creazione, non nei report,
non nelle esportazioni, non su preventivi, ticket e ordini.

**Rimedio.** Campi personalizzati nei form di creazione, come colonne opzionali nelle
liste, nei filtri, nei report e nelle esportazioni.

### U-10 ◐ — Il costruttore di report è riservato agli amministratori e legge una tabella per volta

Ogni azione, inclusa la lettura, richiede `requireAdminAccess`. Non esistono join.
Ticket e ordini non sono tra le entità disponibili.

**Rimedio.** Lettura aperta a chi ha accesso ai dati, scrittura agli amministratori.
Relazioni predefinite, invio programmato, almeno un tipo di grafico.

### U-11 — Notifiche e chat vivono di interrogazioni ripetute

Notifiche: 50 righe complete ogni minuto, senza cursore. Chat: una interrogazione ogni
5 secondi più una ogni 10. Nessuna preferenza per tipo di notifica.

**Rimedio.** Interrogazione incrementale con cursore, preferenze per tipo e canale, e un
flusso di eventi per la chat.

### U-12 — Non esiste un primo avvio

Nessuna procedura di configurazione iniziale, nessuno stato vuoto che spieghi cosa fare,
nessun dato di esempio. Senza fasi pipeline la prima conversione fallisce con un
messaggio tecnico.

**Rimedio.** Fasi, SLA e categorie predefiniti alla creazione del workspace. Una lista di
avvio in cinque passi con avanzamento visibile. Stati vuoti che propongono l'azione.

### U-13 — Il controllo duplicati arriva dopo che il modulo è stato compilato

Il rilevamento scatta al salvataggio, dopo che l'utente ha riempito tutte le schede.

**Rimedio.** Verifica alla digitazione dell'email o del nome azienda, con proposta inline
di aprire la scheda esistente.

---

## 7. Da CRM che registra a CRM che suggerisce

Tutto quanto segue è costruibile sui dati già presenti nello schema.

### S-01 — La palette come lanciatore di azioni

⌘K, e accanto ai record anche i verbi: «nuovo preventivo per Acme», «assegna a Giulia»,
«chiudi il ticket», «registra una chiamata». Con gli ultimi record visitati nello stato
di riposo e la proposta di creare quando la ricerca non trova nulla.

È l'intervento che abbassa di più la curva di apprendimento, perché sostituisce «devi
sapere dove sta» con «chiedilo».

### S-02 — Una prossima azione calcolata per ogni record

Trattativa ferma da più di N giorni; preventivo inviato e mai aperto da cinque giorni;
ticket entro il 20% dalla scadenza SLA; lead qualificato senza attività; cliente senza
contatti da tre mesi. Tutte interrogazioni sui dati presenti, presentate come elenco di
lavoro ordinato per urgenza.

La dashboard oggi elenca ciò che esiste; questa versione dice cosa fare adesso.

### S-03 — Chiudere il ciclo preventivo → ordine → trattativa

Un preventivo accettato genera l'ordine con un click — lo stato `converted` è già
previsto e non lo scrive nessuno. L'ordine porta la trattativa a «vinta» con la data di
chiusura. La trattativa vinta registra l'attività sulla scheda del cliente.

### S-04 — Una libreria di automazioni pronte all'uso

Dieci ricette installabili in un click: assegnazione a rotazione dei nuovi lead,
follow-up tre giorni dopo l'invio del preventivo, escalation SLA, benvenuto al nuovo
contatto, avviso sulla trattativa ferma, promemoria di rinnovo. Con un'anteprima che
dica «questa regola avrebbe agito su 34 record nell'ultimo mese».

### S-05 — Triage assistito sul supporto

Categoria e priorità proposte, ticket simili già risolti mostrati di fianco, bozza di
risposta dalle macro esistenti, riassunto del thread per chi subentra.

### S-06 — Composizione assistita dove il testo si scrive già

Bozza del sollecito su un preventivo, risposta al ticket, verbale della riunione
dall'attività registrata. Sempre proposta, sempre modificabile, mai spedita da sola.

### S-07 — SLA con orari lavorativi e scala di escalation

Calendario lavorativo per workspace con festività. Avvisi al 50% e all'80% del tempo
residuo, non solo alla violazione avvenuta. Escalation automatica al responsabile.

### S-08 — Segnaposto documentati, anteprima reale, disiscrizione garantita

I segnaposto sono cinque, solo in italiano, e non compaiono in nessun elenco: chi scrive
`{{firstName}}` lo spedisce così com'è. Servono il catalogo nell'editor, i campi
personalizzati come segnaposto, l'anteprima con un contatto reale, l'invio di prova, e
l'inserimento automatico del link di disiscrizione con blocco della partenza se manca.

### S-09 — Motivi di perdita e analisi win/loss

Motivo obbligatorio alla chiusura persa, con elenco configurabile, e una vista che
incroci motivo, fase di abbandono, valore e concorrente.

### S-10 — Sincronizzazione con calendario ed email

Google OAuth è già configurato per il login. Estenderlo a calendario e posta significa
appuntamenti bidirezionali e conversazioni email agganciate alla scheda del contatto. Il
doppio inserimento è la ragione principale per cui un CRM viene abbandonato.

### S-11 — Una vista «oggi» che sostituisca la barra laterale

Una sola schermata con appuntamenti della giornata, task in scadenza, ticket vicini
all'SLA e le prossime azioni di S-02, tutti azionabili sul posto. Tredici moduli in barra
laterale sono la struttura del prodotto, non il modo in cui si lavora.

---

## 8. In che ordine intervenire

L'ordine non è per gravità ma per dipendenza: ogni riga sblocca quelle successive.

| # | Intervento | Rilievi | Perché adesso |
|---|---|---|---|
| 01 | Un solo modello di ruoli | P-01 → P-06 | Le Impostazioni non si aprono per il proprietario del workspace e un suo amministratore può salire ai privilegi di piattaforma. Sblocca metà dei rilievi di esperienza. |
| 02 | Risoluzione del tenant fuori dalla dashboard | B-01, B-02, B-03 | Riporta in vita preventivi pubblici, tracking, disiscrizione, email in ingresso, recupero password e tutti e sette i job. |
| 03 | URL base unico e ambiente documentato | B-04, B-05 | Senza questo le email tornate a partire al punto 02 conterrebbero ancora link verso localhost. |
| 04 | Confini di errore e di caricamento | B-07, U-01 | Rende diagnosticabile il resto e toglie la schermata bianca. |
| 05 | Correttezza del denaro | C-01 → C-07 | IVA, valuta, totali degli ordini, collegamento fase/stato: i numeri che il cliente legge. |
| 06 | Paginazione e ricerca sulle liste | B-08, U-04 | Decide quanto può crescere un cliente prima che il prodotto smetta di essere usabile. |
| 07 | SLA reali e automazioni collegate | D-01, D-02, D-03 | Tre moduli venduti che non fanno nulla. Da rendere veri o da rimuovere. |
| 08 | Archiviazione documenti e primo avvio | B-06, U-12, D-04 | Il primo protegge dati che si perdono; il secondo decide l'adozione. |
| 09 | Lo strato intelligente | S-01 → S-11 | Dopo, e non prima: sopra un modello di dati credibile. |

---

## Cosa è già solido e va difeso

La firma HMAC dei webhook con validazione anti-SSRF e segreto separato dalla lista è
fatta bene, e così la cifratura AES-GCM delle connessioni per tenant. Il rilevatore di
cicli nel motore di automazione risolve un problema che molti prodotti maturi hanno
ancora. La Content-Security-Policy con nonce per richiesta e senza `unsafe-inline` è più
rigorosa della media. Il registro di audit sui ticket, il controllo duplicati con unione
guidata, il costruttore di filtri e il rilevamento delle dipendenze tra task sono
funzioni che i concorrenti non hanno tutte.

Anche la strategia di test è giusta: 91 test concentrati sul confine che conta — chi è il
chiamante macchina, in quale workspace può scrivere, cosa accetta l'API di importazione —
più la verifica per mutazione. Vale la pena estendere quello stesso perimetro alle
guardie di ruolo e alla risoluzione del tenant, che sono esattamente le due aree dove
questo audit ha trovato più problemi e dove un guasto assomiglia a un successo.

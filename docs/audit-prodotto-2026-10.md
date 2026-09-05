# Audit Flux CRM — Ottobre 2026

Versione analizzata: **2.2.0** · ramo `main`
Perimetro: 73 pagine, 44 file di azioni server, 51 rotte API, 64 tabelle
Verifiche alla data dell'analisi: 91 test superati, `tsc --noEmit` pulito

66 rilievi. Nessuno è un errore di compilazione: sono comportamenti.

## Stato degli interventi

Aggiornato dopo il primo ciclo di correzioni.

| | |
|---|---|
| ✅ Risolti | 61 |
| ◐ Parziali | 1 |
| ⊘ Non si fa | 1 |
| Aperti | 3 |

Verifiche dopo le correzioni: build di produzione riuscito, `tsc --noEmit` pulito,
**293 test** superati (erano 91), **152 mutazioni su 152** catturate (erano 78), zero
errori Biome sui file toccati. Le nuove suite coprono il modello dei permessi,
l'aritmetica dei documenti commerciali, l'allineamento delle traduzioni, le
migrazioni dei tenant, il confine server/client della sidebar, la corrispondenza fra
nomi di aziende e la paginazione — cioè le aree dove un guasto somiglia a un
successo.

I tre punti ancora aperti sono funzioni da costruire, non difetti: S-05, S-06 e
S-10. I primi due sono in realtà una decisione sola — mettere o no un modello
linguistico dentro il prodotto, con i dati dei clienti che ci passano e un costo
per chiamata — e S-10 è un progetto con una dipendenza esterna, la verifica di
Google sugli ambiti di calendario e posta, che decide i tempi al posto tuo.

Resta un solo parziale, M-09: una sola libreria di trascinamento ormai, e sulla
lingua dei commenti la regola sta nel `CLAUDE.md`, con i file esistenti che si
allineano quando li si tocca.

Dei due parziali ciascuna voce dice cosa le manca: M-09 ha una sola libreria di
trascinamento ormai, e sulla lingua dei commenti la regola sta nel `CLAUDE.md`;
U-11 lascia fuori le preferenze di notifica per tipo e canale, che l'audit stesso
riconosce non più giustificate ora che il polling non costa più quello che costava.

Due migrazioni tenant. `0002_odd_ulik.sql` aggiunge le colonne mancanti (data di
chiusura e motivo di perdita sulle trattative, imponibile/imposta/valuta sugli ordini,
fasi terminali sulla pipeline, scadenza di prima risposta sui ticket) e ripopola i dati
esistenti. `0003_open_jackpot.sql` rimuove la tabella `opportunity`, verificata vuota su
ogni tenant. **Vanno applicate a ogni database tenant prima del deploy.**

⚠️ Trovato durante il lavoro e non presente in questa analisi: **le viste salvate non
avevano alcun controllo d'accesso**. Ogni funzione in `src/actions/filters.ts` prendeva
l'identificativo dal chiamante e agiva, senza chiedere una capacità e senza verificare che
la riga fosse di chi stava chiedendo. Il chiamante di una server action è il browser,
quindi bastava passare l'identificativo di un collega per cancellargli o ripuntargli i
filtri, e dopo non si vedeva niente di strano. Ora servono `record:read` — non
`record:write`, perché salvarsi una vista su record che già si possono leggere non è
scrivere un record, e un viewer tiene le sue — e il proprietario nella clausola where di
ogni scrittura. I preset, che sono predefiniti di workspace, chiedono `settings:manage`.

✅ Trovato durante il lavoro e non presente in questa analisi: il corpo dei messaggi
dei ticket arriva dalle email dei clienti e veniva reso senza sanitizzazione, contenuto
dalla sola Content-Security-Policy. Ora passa da `src/lib/sanitize-email-html.ts`, che
gira senza DOM perché serve al server, al Worker e al browser, e toglie ciò su cui non
può essere sicuro.

Legenda: ✅ risolto · ◐ risolto in parte, il resto è annotato nel rimedio ·
⊘ non si fa, e la voce dice perché e a quale condizione riaprirla.

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

### B-06 — Gli allegati vivono sul filesystem locale ✅

**Cosa.** L'endpoint di caricamento scrive su disco con `writeFile`. Su Vercel il
filesystem è effimero e per-istanza; su Workers non esiste. La documentazione segnala
solo il secondo caso.

**✅ Risolto.** `src/lib/storage.ts` sceglie il deposito da ciò che l'ambiente offre
invece che da un flag: bucket R2 legato come `DOCUMENTS`, altrimenti object storage
S3-compatibile se le credenziali ci sono, altrimenti il disco locale — che in
produzione lo dice a voce alta nei log. La chiave è generata qui e non porta nulla del
nome caricato tranne un'estensione validata, quindi un nome ostile non raggiunge mai un
percorso; il percorso di lettura la ricontrolla prima di toccare il deposito. Le tre
rotte dei documenti e `ticket-from-email.ts` ci passano sopra, la quota `storageGb` del
piano è verificata al caricamento, e le righe scritte prima continuano a essere lette
dove il disco esiste ancora.

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

### B-08 ✅ — Le liste caricano l'intera tabella, tutte le colonne

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

### D-06 ✅ — La tabella `opportunity` è morta, ma vincola gli ordini

**Cosa.** Nessuna query, nessuna azione, nessuna interfaccia la tocca. Ma la tabella
ordini ha ancora una chiave esterna verso di essa.

**Perché è un limite.** Un ordine non può essere collegato alla trattativa o al
preventivo che lo ha generato. È la causa strutturale di S-03.

**Rimedio.** Migrare il riferimento verso trattativa e preventivo, poi eliminare la
tabella.

### D-07 ✅ — I limiti di piano quasi non esistono

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

### C-09 ✅ — Il totale dei report è il numero di righe troncate

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

### M-01 ✅ — Tre modi diversi di fissare un incontro

Un incontro può essere un'attività di tipo `meeting` (partecipanti in stringa libera,
nessuna ora di fine), un appuntamento (tabella dedicata, invitati, RSVP, iCal) o un task
con orario. Il calendario li unisce, ma dietro ci sono tre modali e tre modelli. Il
titolo di un'attività sul calendario è il corpo della nota troncato a 50 caratteri.

**Rimedio.** L'appuntamento come unico oggetto d'agenda. L'attività torna a essere il
registro di ciò che è successo. Il task resta l'unità di lavoro.

**✅ Risolto**, e guardando l'interfaccia viva invece dello schema il terzo modo era già
mezzo morto. Il pulsante «nuovo evento» del calendario offriva task, riunione e chiamata,
e la riunione la creava come **attività**: nessuna ora di fine, nessun invitato, nessun
invito che arrivi a qualcuno. Quel componente non era montato in nessuna pagina — il
calendario è stato riscritto e monta il dialogo dell'appuntamento — ma è rimasto nel
repository, pronto a rimettere in circolo la confusione al primo che lo rimonta. È stato
cancellato, con le sue stringhe di traduzione.

Restano due modi, e adesso significano due cose diverse. L'appuntamento è l'unico oggetto
d'agenda: è l'unico che ha un'ora di fine, gli invitati, l'RSVP e l'iCal, quindi non era
mai stata una scelta fra pari. L'attività è il registro di ciò che è successo, e le
quattro pagine che ne creano una passano tutte `date: new Date()`: registrano adesso.
Quando qualcuno mette una data futura nel modulo dell'attività, il modulo lo dice e apre la
strada al calendario, invece di rifiutare: togliere il campo avrebbe rotto la registrazione
di un incontro di stamattina per impedire quella di uno di domani.

Il titolo sul calendario non è più la nota tagliata a cinquanta caratteri a metà parola,
ma la sua prima riga, che è dove le persone scrivono l'intestazione; quando la nota è
vuota, il tipo dell'attività dice più di mezza frase.

### M-02 ⊘ — Cinque entità per lo stesso arco commerciale

Lead, contatto, azienda, opportunità e trattativa, con campi ampiamente sovrapposti:
indirizzo, sorgente, punteggio e consensi marketing duplicati tra lead e contatto.

**Rimedio.** Eliminare l'opportunità. Valutare il lead come stato del contatto anziché
tabella parallela.

**⊘ Metà fatta, metà non si fa, e il perché sta qui.** L'opportunità è stata eliminata:
le entità sono quattro, non cinque. Il lead resta una tabella a sé.

La duplicazione è reale — ventitré delle trentaquattro colonne del lead esistono anche
sul contatto — ma fondere le due tabelle tocca la spina dorsale del prodotto: liste,
filtri salvati, API di importazione, entità delle automazioni, e il flusso di conversione
che ha appena ricevuto la transazione e il rilevamento duplicati. Settantacinque file
nominano i lead. Il guadagno è concettuale.

**E la conseguenza pericolosa della duplicazione è già contenuta.** L'unica che poteva
costare qualcosa era il consenso: qualcuno che si disiscrive come contatto e continua a
ricevere posta come lead. La rotta di disiscrizione tratta **la persona**, non la riga:
raccoglie ogni lead e ogni contatto con quel recapito e spegne il consenso su tutti. Il
rischio legale non c'è, e ciò che resta è una ridondanza di schema che nessun utente vede.

Da riaprire il giorno in cui una colonna nuova va aggiunta a entrambe le tabelle e una
delle due se ne dimentica: è quello il momento in cui la duplicazione inizia a costare.

### M-03 ✅ — La conversione del lead non è atomica e non riconosce i duplicati

Otto scritture in sequenza senza transazione — un commento nel codice ne annuncia una
che non c'è. L'azienda è cercata per uguaglianza esatta del nome. Il contatto non è
controllato, benché `checkContactDuplicates` esista nello stesso file. La trattativa
nasce a zero, senza data attesa.

**Rimedio.** Transazione. Riusare il rilevamento duplicati con nome normalizzato e
partita IVA. Chiedere valore e data attesa nello stesso passaggio.

### M-04 ✅ — Nessuna azione usa una transazione

Preventivi, ordini e conversioni scrivono le righe in ciclo. L'aggiornamento di un
preventivo cancella tutte le righe e le reinserisce: un errore dopo la cancellazione
lascia un preventivo vuoto.

**Rimedio.** Transazione attorno a ogni scrittura multi-tabella, e inserzione in blocco.

**✅ Risolto**, passando in rassegna una per una le sedici funzioni che scrivono più di
una volta. Preventivi, ordini e conversione del lead erano già su `db.batch`, che sul
driver HTTP di Neon è l'unica transazione disponibile: `db.transaction()` lì solleva
un'eccezione.

Ne sono state chiuse altre sei, e la rassegna ha trovato molto peggio dell'atomicità.

**Le tre fusioni perdevano dei figli.** Fondere due schede sposta tutto ciò che puntava
alla scheda perdente e poi la cancella, e l'elenco di cosa spostare era scritto a mano al
punto di chiamata. Era rimasto indietro rispetto allo schema: `order.company_id` e
`order.contact_id` sono arrivati dopo e non erano nell'elenco, quindi fondere due clienti
lasciava indietro gli ordini del perdente, senza più un intestatario. Peggio,
`campaign_log.contact_id` cancella in cascata: fondere due contatti non spostava la storia
di marketing, **la distruggeva** — ogni invio, apertura e clic del contatto perdente se ne
andava con la riga, in silenzio, e la fusione riusciva.

L'elenco ora sta in [src/lib/merge-children.ts](src/lib/merge-children.ts), accanto a un
test che rilegge le chiavi esterne dallo schema e fallisce quando una non è nell'elenco.
Aggiungere domani una tabella con un `companyId` e dimenticare quel file è esattamente
l'errore già commesso: adesso è un test rosso invece del passato mancante di un cliente.
Quattro mutazioni lo tengono onesto.

Le altre cinque: l'appuntamento e i suoi invitati (erano un inserimento per persona, con
gli inviti spediti subito dopo a quella metà di lista che era passata), la risincronizzazione
degli invitati in modifica, la conversazione di gruppo con i suoi membri, il gruppo utenti
che si svuotava prima di riempirsi, e il filtro salvato con le sue etichette.

Restano fuori di proposito `sendMessage`, dove il secondo aggiornamento sposta solo la data
dell'ultima lettura e il messaggio successivo lo rimette a posto, e `dispatchWebhook`, le
cui tre scritture sono rami alternativi dello stesso tentativo, non una sequenza.

### M-05 ✅ — Gli ordini vivono fuori dal flusso del prodotto

Nessun webhook, nessuna automazione, nessuna attività registrata, nessun collegamento a
preventivo o trattativa. `CLAUDE.md` descrive una sequenza precisa e questo modulo ne
esegue solo le prime tre voci.

**Rimedio.** Allineare il modulo al pattern documentato ed emettere gli eventi di ciclo
di vita.

**✅ Risolto.** Il collegamento a preventivo e trattativa e il webhook erano già arrivati;
mancavano le altre due voci della sequenza. `createOrder`, `convertQuoteToOrderAction` e
`updateOrderStatus` eseguono ora le regole dentro `after()`, come ogni altro modulo, e
scrivono una riga di attività sulla scheda del cliente — azienda, contatto e trattativa —
così un ordine esiste anche per chi non apre la lista ordini. Un ordine legato a nessuno
non produce la riga: non c'è una cronologia su cui comparirebbe, e un record che nessuna
pagina raggiunge è peso, non memoria.

`order` è diventata un'entità di automazione a tutti gli effetti, perché emettere l'evento
non basta se poi nessuno può scrivere la regola che lo ascolta: compare nel costruttore
con i propri campi — stato, totale, valuta, sconto, numero, note — il dispatcher sa
aggiornarne lo stato e puntare la notifica alla pagina giusta, e lo scheduler la conosce.
Un'azione «crea task» su un ordine aggancia il task al cliente: la tabella dei task non ha
una colonna per l'ordine, e un task appeso al nulla non lo ritrova nessuno.

`updateOrderStatus` rilegge lo stato precedente prima di sovrascriverlo. Senza, una regola
su «passa a completato» non distingue un passaggio da un salvataggio.

**Resta fuori** il ricalcolo delle righe: aggiungere o togliere una riga cambia il totale
senza emettere `onUpdate`. È una modifica del documento, non un evento del suo ciclo di
vita, e farla scattare a ogni riga renderebbe inservibile qualunque regola sul totale.

### M-06 ✅ — Due sistemi di chat che non si conoscono

Canali e sessioni di chat per il visitatore da un lato, conversazioni dirette interne
dall'altro. La seconda ha una pagina; la prima solo azioni server.

**Rimedio.** Completare la chat verso il cliente come canale del supporto, o rimuoverla.

**✅ Rimossa**, perché non era una scelta fra due sistemi vivi. Cercando in tutta la
storia del repository, nessuna delle cinque azioni della chat visitatore è mai stata
chiamata da una pagina, da un widget o da una rotta, e non esisteva nemmeno una tabella
per i messaggi: la sessione puntava a un ticket, quindi la conversazione sarebbe stata
quella del ticket. Due delle cinque azioni non chiedevano nessuna capacità, il che le
rendeva un endpoint scrivibile per chiunque avesse una sessione.

Renderla vera vuol dire un widget da incorporare, un trasporto in tempo reale, una coda
per gli agenti e la presenza: è un prodotto, non un vuoto da riempire, e il cliente
raggiunge già il supporto per email e dal modulo ticket.

La migrazione tenant lascia cadere le due tabelle dentro una guardia: da qui non si può
guardare nel database di nessuno, quindi una tabella che contenga anche una sola riga
resta dov'è e resta leggibile. Sono già andate la capacità `chatChannel:manage`, che
nessuno chiedeva più, e il passaggio di cancellazione GDPR che anonimizzava i visitatori
della chat: un percorso che ripulisce righe che non possono esistere non è una tutela,
è l'apparenza di una tutela.

### M-07 ✅ — Due interfacce di autenticazione e tre percorsi di login

`/auth/v1/*` e `/auth/v2/*` coesistono, `/login` reindirizza. Nel codice il
reindirizzamento verso `/login` compare in 13 punti e verso il percorso completo in 3.

**Rimedio.** Una sola versione, e un'unica costante per il percorso di login.

### M-08 ✅ — Validazione a due velocità

Preventivi, ticket e SLA validano con Zod. Lead, contatti e aziende accettano
`data: any` e lo passano all'ORM.

**Rimedio.** Uno schema condiviso tra form client e azione server.

### M-09 ◐ — Due librerie di trascinamento e due lingue nei commenti

`@hello-pangea/dnd` e `@dnd-kit` sono entrambe nel bundle. I commenti alternano italiano
e inglese, a volte nello stesso file.

**Rimedio.** Una sola libreria e una sola lingua per il codice.

**◐ Parziale.** La libreria è una sola. `@hello-pangea/dnd` regge tutte le superfici che
si trascinano davvero — pipeline, task, kanban dei ticket, costruttore email — mentre
`@dnd-kit` reggeva una tabella sola, in quattro pacchetti, che nessuna pagina disegnava:
la pagina che la conteneva è un redirect da tempo e la riga era commentata. Tabella e
quattro pacchetti rimossi, build di produzione riuscito.

Sulla lingua la regola c'è ed è scritta nel `CLAUDE.md`: i commenti si scrivono in inglese,
che è già la maggioranza. Le 382 righe italiane rimaste, quasi tutte spiegazioni lunghe sul
confine di importazione, si traducono quando si tocca il file per un motivo vero, non in una
passata a sé: alcune sono citate parola per parola dentro `scripts/mutations/*.json`, e una
riscrittura che ne dimentica una fa fallire `npm run test:mutations` per un motivo che non
c'entra con il codice. I file dell'automazione toccati oggi sono già allineati.

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

### U-06 ✅ — Le date parlano tre lingue diverse, nessuna scelta dall'utente

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

### U-09 ✅ — I campi personalizzati non sono dove servono

Solo come pannello nella scheda di dettaglio di contatti, lead e aziende. Non nella
trattativa, benché il tipo sia previsto. Non nelle modali di creazione, non nei report,
non nelle esportazioni, non su preventivi, ticket e ordini.

**Rimedio.** Campi personalizzati nei form di creazione, come colonne opzionali nelle
liste, nei filtri, nei report e nelle esportazioni.

### U-10 ✅ — Il costruttore di report è riservato agli amministratori e legge una tabella per volta

Ogni azione, inclusa la lettura, richiede `requireAdminAccess`. Non esistono join.
Ticket e ordini non sono tra le entità disponibili.

**Rimedio.** Lettura aperta a chi ha accesso ai dati, scrittura agli amministratori.
Relazioni predefinite, invio programmato, almeno un tipo di grafico.

### U-11 ✅ — Notifiche e chat vivono di interrogazioni ripetute

Notifiche: 50 righe complete ogni minuto, senza cursore. Chat: una interrogazione ogni
5 secondi più una ogni 10. Nessuna preferenza per tipo di notifica.

**Rimedio.** Interrogazione incrementale con cursore, preferenze per tipo e canale, e un
flusso di eventi per la chat.

**◐ Parziale.** `useLivePoll` sostituisce tutti e quattro i timer fissi. Una scheda in
secondo piano non interroga: non può vedere ciò che imparerebbe. Tornare in primo piano
interroga subito, così rientrare non è un'attesa. E un giro che non trova nulla raddoppia
l'attesa fino a un tetto, mentre uno che trova qualcosa torna al ritmo veloce.

L'endpoint delle notifiche accetta `since` e restituisce solo ciò che è arrivato dopo,
più il conteggio dei non letti — che è l'unico numero che la campanella disegna, ed è
contato sul database invece che dedotto dalla pagina, altrimenti un non letto più vecchio
dei cinquanta più recenti non veniva contato. La lista messaggi della chat scriveva
`markConversationRead` a ogni giro: una scrittura sul database ogni cinque secondi per
conversazione aperta, che diceva ogni volta la stessa cosa. Ora scrive solo quando
arrivano messaggi nuovi.

Tre falle di autorizzazione trovate strada facendo: `getNotificationsAction`,
`markNotificationReadAction` e `markAllNotificationsReadAction` prendevano l'id utente
dal chiamante, e il chiamante di una server action è il browser. Chiunque avesse una
sessione poteva leggere le notifiche di un altro passando il suo id, o segnargliele tutte
lette. L'id ora viene dalla sessione e l'argomento non esiste più.

**⊘ Il resto non si fa, e questa è la decisione.** Le preferenze per tipo e canale e il
flusso di eventi restano fuori. Il polling adattivo ha già tolto il costo che li
giustificava: una scheda in secondo piano non interroga, un giro a vuoto raddoppia
l'attesa, e l'endpoint restituisce solo ciò che è arrivato dopo l'ultimo giro. Le
preferenze aggiungerebbero schema, interfaccia e superficie di assistenza per un problema
che non morde più; il flusso di eventi aggiungerebbe un trasporto da tenere in piedi.

Da riaprire quando qualcuno si lamenterà del **rumore** delle notifiche invece che del
loro costo: quella è la lamentela che le preferenze risolvono davvero.

### U-12 ✅ — Non esiste un primo avvio

Nessuna procedura di configurazione iniziale, nessuno stato vuoto che spieghi cosa fare,
nessun dato di esempio. Senza fasi pipeline la prima conversione fallisce con un
messaggio tecnico.

**◐→✅ Chiuso.** `src/db/seed-workspace.ts` riempie ciò senza cui il prodotto non parte:
sei fasi di pipeline (con «Won» e «Lost» marcate, che è ciò che fa davvero chiudere una
trattativa trascinata dentro), quattro politiche SLA per priorità, tipi e categorie
azienda. Gira su ogni percorso di migrazione e semina solo le tabelle vuote, quindi è
sicuro riapplicarlo e non resuscita ciò che il cliente ha cancellato apposta.

**Gli stati vuoti ci sono**, e la procedura guidata è stata scartata di proposito. Una
lista di avvio in cinque passi è un artefatto unico che si clicca via una volta e che poi
qualcuno deve mantenere; lo stato vuoto arriva invece nel momento in cui la domanda viene
posta davvero, sulla schermata che la pone. `EmptyState` è uno solo, e distingue due
vuoti che non devono somigliarsi: **non c'è ancora niente**, che è un invito e porta con
sé il pulsante, e **niente corrisponde al filtro**, che non porta nessun invito, perché
proporre di creare un record quando una ricerca non trova nulla è rispondere a una domanda
che nessuno ha fatto.

Sei schermate lo montano — contatti, aziende, lead, ordini, prodotti e ticket — ognuna
con l'unica azione che ha senso lì e una riga che dice a cosa serve quella schermata. I
preventivi ne avevano già uno buono ed è rimasto com'era. La pipeline no: una board vuota
mostra comunque le sue fasi e il pulsante per la trattativa, e uno stato vuoto coprirebbe
proprio la struttura che spiega la schermata.

⚠️ Distinguere i due vuoti è più sottile di quanto sembri, e la prima versione sbagliava.
Le tre liste CRM chiedevano «ci sono filtri attivi?», che conta solo le condizioni del
costruttore di filtri: una **ricerca** che non trova nulla lasciava quel numero a zero, e
la schermata rispondeva «ancora nessun contatto» offrendo di crearne uno, a chi ne stava
cercando un altro. Ora la domanda è «la lista è ristretta?», filtri **o** ricerca. Ordini,
prodotti e ticket la ponevano già nel modo giusto.

**Rimedio.** Fasi, SLA e categorie predefiniti alla creazione del workspace. Una lista di
avvio in cinque passi con avanzamento visibile. Stati vuoti che propongono l'azione.

### U-13 — Il controllo duplicati arriva dopo che il modulo è stato compilato ✅

Il rilevamento scatta al salvataggio, dopo che l'utente ha riempito tutte le schede.

**Rimedio.** Verifica alla digitazione dell'email o del nome azienda, con proposta inline
di aprire la scheda esistente.

**✅ Risolto.** `useDuplicateWatch` esegue la stessa interrogazione mentre il campo
identificante si sta ancora scrivendo: aspetta che la digitazione si fermi, e scarta una
risposta arrivata dopo che i tasti sono andati avanti, così l'avviso descrive sempre ciò
che è a schermo. `DuplicateHint` lo mostra come striscia sopra il modulo, non come
finestra: a quel punto non è stato scritto nulla da difendere, e le uniche risposte utili
sono «apri quella» o «no, è un'altra persona».

Due difetti che il controllo si portava dietro. Nessuna delle tre azioni era protetta —
erano una sonda puntabile sul workspace da chiunque avesse una sessione — e ora
richiedono `record:read` come ogni altra lettura. E il confronto sul nome azienda era una
uguaglianza esatta, che non scatta mai sul caso che conta: nessuno scrive due volte la
stessa forma giuridica. Ora la SQL restringe sulla parola più lunga del nome e la
decisione la prende `isSameCompanyName`, che conosce forme giuridiche, punteggiatura e
accenti — «Acme S.r.l.» e «Acme Srl» sono la stessa azienda.

---

## 7. Da CRM che registra a CRM che suggerisce

Tutto quanto segue è costruibile sui dati già presenti nello schema.

### S-01 — La palette come lanciatore di azioni ✅

⌘K, e accanto ai record anche i verbi: «nuovo preventivo per Acme», «assegna a Giulia»,
«chiudi il ticket», «registra una chiamata». Con gli ultimi record visitati nello stato
di riposo e la proposta di creare quando la ricerca non trova nulla.

È l'intervento che abbassa di più la curva di apprendimento, perché sostituisce «devi
sapere dove sta» con «chiedilo».

**✅ Risolto.** Le azioni stanno in `src/lib/palette-commands.ts`, elenco puro: aggiungere
un verbo è una riga lì, non una modifica alla finestra. Compaiono sopra i record mentre
si scrive, filtrate sulla capability di chi cerca — un viewer non vede verbi che non può
eseguire.

La corrispondenza guarda anche le parole che una persona usa davvero: chi vuole fatturare
scrive «invoice», non «quote»; chi arriva da un altro CRM scrive «opportunity» per una
trattativa. È a prefisso di parola e non a sottostringa, così «or» propone «New order» e
non tutto ciò che contiene «or» in mezzo.

A riposo la palette mostra prima gli ultimi record aperti da qui — nel browser, per
persona e per dispositivo, perché è una comodità e non un dato — e poi i verbi. L'elenco
delle pagine indice che c'era prima è la barra laterale in una scatola più piccola, e
serve solo a chi non è ancora stato da nessuna parte.

Quando la ricerca non trova niente, propone di creare: non trovare qualcosa è di solito
il momento in cui la si voleva creare, ed è la differenza fra un vicolo cieco e il passo
successivo.

I comandi usano `?new=true`, la convenzione che i modali di creazione già leggevano.
Dove nessuno la legge — ticket e task — il comando porta all'elenco e basta, invece di
promettere un modulo che non si aprirebbe.

### S-02 — Una prossima azione calcolata per ogni record ✅

Trattativa ferma da più di N giorni; preventivo inviato e mai aperto da cinque giorni;
ticket entro il 20% dalla scadenza SLA; lead qualificato senza attività; cliente senza
contatti da tre mesi. Tutte interrogazioni sui dati presenti, presentate come elenco di
lavoro ordinato per urgenza.

La dashboard oggi elenca ciò che esiste; questa versione dice cosa fare adesso.

**✅ Risolto.** Le soglie e l'ordinamento stanno in `src/lib/next-actions.ts`, modulo
puro: sono la parte su cui vale la pena discutere, e tenerli fuori dalle interrogazioni
significa poterli leggere in un posto solo invece di dedurli da sei clausole `WHERE`.
`getNextActions` in `src/actions/next-actions.ts` esegue le sei regole — SLA violato o
in scadenza, preventivo che scade, preventivo inviato e mai aperto, trattativa ferma o
oltre la data di chiusura, lead mai contattato, cliente silenzioso — ognuna una query
piccola con il proprio tetto, quindi il costo resta limitato comunque cresca il
workspace.

Due scelte che contano. «Toccata» per una trattativa significa che è stata registrata
un'attività, non che la riga è stata scritta: risalvare per correggere un refuso non è
contatto con il cliente. E il rischio SLA è calcolato come frazione della finestra
propria del ticket, non come numero fisso di ore: il 20% di quattro ore e il 20% di due
giorni sono entrambi «sta per scadere», e un'ora fissa sbaglierebbe su uno dei due.

L'elenco sta in cima alla dashboard, sopra tutto il resto, e se fallisce non porta giù
lo schermo con sé: torna vuoto, che si legge come «non c'è nulla in attesa».

### S-03 — Chiudere il ciclo preventivo → ordine → trattativa ✅

Un preventivo accettato genera l'ordine con un click — lo stato `converted` è già
previsto e non lo scrive nessuno. L'ordine porta la trattativa a «vinta» con la data di
chiusura. La trattativa vinta registra l'attività sulla scheda del cliente.

**✅ Risolto.** `convertQuoteToOrderAction` in `src/actions/orders.ts`: un solo commit
scrive l'ordine con le sue righe, porta il preventivo a `converted` e chiude la
trattativa a «vinta» con la data. Le righe sono copiate, non ricalcolate — il cliente
ha accettato quelle cifre, e il listino può essersi mosso da allora. Il pulsante
compare sulla scheda del preventivo solo quando è accettato, e un secondo click porta
all'ordine già esistente invece di fallire.

Serviva una migrazione (`0004_order_line_from_quote`): `order_item.product_id` era NOT
NULL mentre quella di preventivo è sempre stata nullable, quindi un preventivo con una
riga a testo libero — una personalizzazione, una giornata di consulenza — non poteva
diventare un ordine. È la forma più comune di preventivo, quindi la conversione sarebbe
fallita proprio dove serve. La riga d'ordine prende anche `description`, altrimenti una
riga senza prodotto non avrebbe modo di dire cosa sia.

### S-04 ✅ — Una libreria di automazioni pronte all'uso

Dieci ricette installabili in un click: assegnazione a rotazione dei nuovi lead,
follow-up tre giorni dopo l'invio del preventivo, escalation SLA, benvenuto al nuovo
contatto, avviso sulla trattativa ferma, promemoria di rinnovo. Con un'anteprima che
dica «questa regola avrebbe agito su 34 record nell'ultimo mese».

**✅ Risolto.** Otto ricette in [src/lib/automation-recipes.ts](src/lib/automation-recipes.ts),
che è un modulo di soli dati: installarne una scrive una regola normale, che il costruttore
poi apre e modifica come qualsiasi altra. Niente qui è una regola di tipo speciale. Il
problema che risolvono non è che il motore non sappia fare: è che il costruttore chiede
entità, evento, condizione e azione — quattro decisioni prima che succeda qualcosa — su
una lista vuota, e a nessuno viene in mente per prima cosa un albero di condizioni. Viene
in mente «avvisami quando arriva una trattativa grossa».

**Tre scelte che vale la pena dire.**

Nessuna ricetta è schedulata. I trigger a orario girano su node-cron avviato da
`src/instrumentation.ts`, che su Cloudflare Workers non parte perché lì non esiste un
processo che vive: una ricetta che su metà dei deploy non fa niente in silenzio è peggio
di una ricetta che non c'è. Per lo stesso motivo manca l'assegnazione a rotazione: non
esiste un'azione che assegni, e prometterla avrebbe voluto dire scriverne una.

L'escalation SLA non è fra le ricette perché ora è nella politica SLA stessa, dove il
gruppo si sceglie una volta invece di per regola (S-07).

**L'anteprima dice una cosa diversa da quella chiesta, e lo dichiara.** «Avrebbe agito su
34 record nell'ultimo mese» richiede la storia di ogni cambiamento, che nessuno qui
conserva. Il numero mostrato è quanti record **soddisfano la regola adesso**, calcolato
riusando il valutatore di condizioni già esistente su una lettura per tipo di entità, e
risponde alla domanda dietro la domanda: questa regola ha qualcosa su cui mordere. Le
ricette che scattano su un cambiamento — «passa a vinto» non è una proprietà di una
trattativa — lo dicono invece di mostrare uno zero che non significa niente.

Installare due volte la stessa ricetta è rifiutato. La memoria della finestra non
sopravvive a un ricaricamento, quindi il secondo clic era facile da fare, e due copie
identiche della stessa regola scattano entrambe: ogni task che crea sarebbe stato doppio.
La finestra chiede al workspace quali ci sono già invece di ricordarselo.

Il catalogo è scritto a mano e validato da Zod al momento dell'installazione, dove l'unica
risposta possibile è «non è stato possibile aggiungere la regola»: TypeScript non se ne
accorgerebbe, perché per lui una stringa è una stringa. Un test lo fa passare tutto dallo
schema vero, e controlla anche che ogni campo nominato esista nel costruttore — una regola
installata che poi non si può aprire e modificare è peggio di una che non si installa.
Quattro mutazioni lo tengono onesto.

Trovato mentre si montava il pulsante: la pagina delle automazioni decideva chi può
modificare leggendo `session.user.role`, che è il campo dello staff di piattaforma e vale
«user» per ogni cliente. Un viewer del workspace vedeva tutti i pulsanti e il server glieli
rifiutava uno per uno. Ora la domanda è la capacità, la stessa che fa l'azione.

### S-05 — Triage assistito sul supporto

Categoria e priorità proposte, ticket simili già risolti mostrati di fianco, bozza di
risposta dalle macro esistenti, riassunto del thread per chi subentra.

### S-06 — Composizione assistita dove il testo si scrive già

Bozza del sollecito su un preventivo, risposta al ticket, verbale della riunione
dall'attività registrata. Sempre proposta, sempre modificabile, mai spedita da sola.

### S-07 ✅ — SLA con orari lavorativi e scala di escalation

Calendario lavorativo per workspace con festività. Avvisi al 50% e all'80% del tempo
residuo, non solo alla violazione avvenuta. Escalation automatica al responsabile.

**◐ Parziale.** Il calendario c'è: settimana, fuso orario e giorni di chiusura, modificabili
dalla pagina SLA. L'aritmetica sta in `src/lib/business-hours.ts`, modulo puro senza
dipendenze — `date-fns` da solo non fa i fusi e il bundle è già vicino al limite di
Workers, mentre `Intl` c'è ovunque questo gira.

Il difetto che chiude: una promessa di quattro ore su un ticket arrivato venerdì alle
17:00 scadeva alle 21:00 di venerdì, quando non c'era nessuno, e lunedì la squadra
leggeva di aver mancato qualcosa che nessuno poteva rispettare. Lo stesso conto sbagliava
ogni metrica del supporto nella stessa direzione, in silenzio.

Le politiche esistenti restano sull'orologio da parete finché qualcuno non sceglie
diversamente: cambiare di nascosto il significato di una promessa già presa non è una
correzione, è una sorpresa.

Gli avvisi al 50% e all'80% ci sono, misurati sulla finestra del ticket stesso, così una
politica da quattro ore e una da due giorni avvisano allo stesso punto nei propri termini.
Il livello raggiunto è memorizzato sul ticket, altrimenti il job ripeterebbe la stessa
cosa ogni quindici minuti.

**✅ Chiusa anche l'escalation**, ma a un **gruppo**, non a un responsabile. Nello schema
non esiste una gerarchia e aggiungerne una significa mantenere un organigramma che nessuno
aggiorna; una squadra di supporto invece esiste già come gruppo utenti. La politica SLA
nomina un gruppo, e alla violazione le persone di quel gruppo ricevono l'avviso insieme a
chi ha il ticket in carico, ciascuna una volta sola. Le politiche esistenti nascono senza
gruppo, quindi chi non sceglie niente tiene esattamente il comportamento di oggi.

Due cose trovate mentre la si chiudeva, e sistemate.

**La violazione non avvisava nessuno.** Segnava una colonna ed eseguiva le regole di
automazione che il workspace avesse scritto — per quasi tutti, nessuna. La promessa
saltava e nessuno lo sapeva.

**⚠⚠ E l'interruttore degli orari lavorativi non era raggiungibile.** La prima metà di
S-07 aveva aggiunto `use_business_hours` alla politica, ma il form della pagina SLA valida
con `SlaSchema`, che non lo conteneva: l'unico schema che lo accettava stava in
`support-validation.ts`, usato da tre azioni che nessuna pagina chiama. Due modi di
scrivere la stessa riga, e quello vivo aveva perso un campo per strada. Il calendario
lavorativo c'era, l'aritmetica c'era, e l'orologio continuava a correre di notte perché
nessuno poteva accendere l'interruttore. Ora è nel form, con accanto la scelta del gruppo,
e le tre azioni irraggiungibili sono state rimosse insieme ai loro schemi.

Un ticket che non è in carico a nessuno, infine, non era avvisato da nessuno: era proprio
quello con più probabilità di sforare. Adesso l'avviso al 50% e all'80% va al gruppo
quando non c'è un incaricato.

### S-08 — Segnaposto documentati, anteprima reale, disiscrizione garantita ✅

I segnaposto sono cinque, solo in italiano, e non compaiono in nessun elenco: chi scrive
`{{firstName}}` lo spedisce così com'è. Servono il catalogo nell'editor, i campi
personalizzati come segnaposto, l'anteprima con un contatto reale, l'invio di prova, e
l'inserimento automatico del link di disiscrizione con blocco della partenza se manca.

**✅ Risolto.** `src/lib/email-placeholders.ts` è il catalogo unico: otto segnaposto, con
gli alias in entrambe le lingue, così sia «{{nome}}» sia «{{firstName}}» risolvono invece
di partire come sono scritti. Da lì prendono il menu dell'editor, la sostituzione
all'invio e l'avviso su ciò che non si risolverà.

Erano **quattro implementazioni diverse** della stessa sostituzione, ognuna con la propria
lista, e nessuna che concordasse con le altre. La spia più chiara: il piè di pagina
dell'editor dei template pubblicizzava `firstName`, `lastName`, `email`, `companyName`,
`phone` — di cui l'invio non sostituiva **nessuno**. Chi seguiva quel suggerimento li
spediva al cliente alla lettera.

Altri due difetti chiusi. L'oggetto non veniva sostituito affatto, quindi una riga «Una
domanda per {{nome}}» partiva dicendo esattamente questo. E `{{azienda}}` era offerto nel
menu delle variabili e sostituito da nessuna parte.

Il link di disiscrizione viene aggiunto quando l'autore lo dimentica: una mail marketing
senza non è un difetto di resa ma un illecito, e l'invio riusciva comunque. Il pannello
dice in anticipo che verrà aggiunto, così chi vuole deciderne la posizione può metterlo
dove preferisce.

L'anteprima usa i valori d'esempio del catalogo, non un terzo insieme di nomi come faceva
prima.

**Trovato strada facendo — e più grave di S-08.** `src/lib/sanitize-email-html.ts`: il
corpo di una mail veniva reso dentro l'applicazione in quattro punti, e l'unica difesa era
una espressione regolare per `<script>`. `<img src=x onerror=…>` e `<a
href="javascript:…">` passavano interi. Nel thread dei ticket quel testo lo scrive uno
sconosciuto e viene reso nella sessione autenticata di un operatore: era XSS persistente
tenuto a bada dalla sola CSP. Ora c'è un sanificatore che gira ovunque senza un parser
HTML — jsdom non funziona su Workers — con dieci mutazioni che tengono la linea. La CSS
resta la seconda difesa e va lasciata dov'è: un elenco di divieti vale quanto il suo
elenco.

### S-09 — Motivi di perdita e analisi win/loss ✅

Motivo obbligatorio alla chiusura persa, con elenco configurabile, e una vista che
incroci motivo, fase di abbandono, valore e concorrente.

**✅ Risolto.** Trascinare una scheda nella colonna «Persa» apre la domanda: è l'unico
momento in cui la risposta si conosce ancora. Chiesta alla riunione commerciale una
settimana dopo, non se la ricorda nessuno; chiesta al momento, costa un click. Annullare
lascia la scheda dov'era — una perdita senza motivo è esattamente ciò che si sta
correggendo.

Il motivo viene da un elenco configurabile (`deal_loss_reason`, seminato con otto voci
che valgono per chiunque venda qualcosa) e non da una casella libera, perché il testo
libero non si aggrega: «prezzo», «Prezzo» e «troppo caro» sono tre righe in qualsiasi
analisi. La casella resta sotto per il dettaglio che un elenco non può contenere, e c'è
il campo concorrente. Un motivo ritirato non viene cancellato: toglierlo dall'elenco non
deve cancellarlo dalle trattative già chiuse sotto di esso.

Serviva anche `lost_at_stage_id`, che non è ricavabile da `stage_id`: spostando la
scheda nella colonna «Persa», la fase in cui la conversazione si è davvero fermata viene
sovrascritta.

La vista `/dashboard/pipeline/win-loss` taglia i dati nei tre modi in cui la domanda
viene posta davvero: per motivo, che mostra lo schema; per fase di abbandono, che dice se
il problema è la qualifica o la chiusura; e per concorrente. Ogni taglio porta il valore
oltre al conteggio, perché dieci perdite piccole e una grande sono problemi diversi. Il
tasso di vittoria è calcolato su ciò che ha chiuso: una trattativa aperta non è una
perdita, e contarla come tale è il modo in cui quel numero smette di significare qualcosa.

Trovato strada facendo: `getPipelineData` seminava cinque fasi proprie, nessuna marcata
vinta o persa, quindi un workspace che arrivava alla pipeline da lì otteneva una lavagna
senza modo di chiudere nulla. Ora usa gli stessi valori predefiniti di ogni altro
percorso.

### S-10 — Sincronizzazione con calendario ed email

Google OAuth è già configurato per il login. Estenderlo a calendario e posta significa
appuntamenti bidirezionali e conversazioni email agganciate alla scheda del contatto. Il
doppio inserimento è la ragione principale per cui un CRM viene abbandonato.

### S-11 — Una vista «oggi» che sostituisca la barra laterale ✅

Una sola schermata con appuntamenti della giornata, task in scadenza, ticket vicini
all'SLA e le prossime azioni di S-02, tutti azionabili sul posto. Tredici moduli in barra
laterale sono la struttura del prodotto, non il modo in cui si lavora.

**✅ Risolto.** `/dashboard/today`, prima voce del menu, perché è da lì che comincia la
giornata: la dashboard sotto risponde a «come stiamo andando», questa a «cosa sto
facendo». Tre cose e nient'altro — l'agenda del giorno sulla griglia oraria, l'elenco di
S-02 con ciò che aspetta una risposta, e la coda dei propri ticket ordinata per quando
smettono di essere puntuali, con quanto tempo resta detto come lo direbbe una persona.

Nessun dato nuovo. L'agenda era centotrenta righe dentro la pagina della dashboard: tre
interrogazioni e la mappatura che le unisce. Ora sta in `getTodayView()` e la disegnano
entrambe le pagine, perché due copie sarebbero divergute nel giro di un mese — e la
dashboard smette di eseguire tre interrogazioni che ora fa il modulo condiviso.

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

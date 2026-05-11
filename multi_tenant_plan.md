Sei un esperto sviluppatore Next.js 16 incaricato di trasformare un progetto Next.js 16 esistente in una piattaforma multi-tenant basata sul pattern del template ufficiale Vercel Platforms (https://github.com/vercel/platforms). Il progetto attuale si connette a un singolo database ed è pensato per una sola istanza; l'obiettivo è renderlo multi-tenant per servire più clienti, ciascuno con il proprio sottodominio e, fondamentale, con il proprio database isolato. Questa è una modifica critica e invasiva che richiede attenzione a ogni dettaglio.
**Contesto tecnico e differenze rispetto al template Vercel Platforms (Next.js 15):**
- In Next.js 16 il middleware si chiama proxy e va collocato nel file `proxy.ts` nella root del progetto.
- La funzione esportata deve chiamarsi `proxy` e non `middleware`.
- Il proxy in Next.js 16 supporta solo il runtime Node.js (non Edge).
- Il matcher rimane lo stesso ma va riesportato con la sintassi `export const config = { matcher: [...] }`.
- Tutti i riferimenti a `middleware.ts` nel codice esistente vanno rinominati e adattati di conseguenza.
**Istruzioni dettagliate per l'implementazione:**
1. Analisi iniziale: esamina l'intera codebase (pagine, API, modelli dati, connessione al database) e identifica ogni query o operazione che accede al database. Queste dovranno essere rese dinamiche per connettersi al database del tenant corretto.

2. Strategia multi-tenant (database separati per tenant):
   - Adotta un approccio a **database dedicati**: ogni tenant avrà il proprio database completamente isolato. Non si aggiunge alcuna colonna `tenant_id` alle tabelle esistenti.
   - Crea un database principale condiviso (ad esempio `platform_db`) che contiene una tabella `tenants` con almeno i campi: `id`, `name`, `subdomain`, `db_name`, `db_host`, `db_port`, `db_user`, `db_password` (criptata), `created_at`, `settings` (JSON per emoji, logo, configurazioni, ecc.). Questo database funge da registro delle connessioni.
   - Ogni database tenant avrà la stessa struttura (stesse tabelle, viste, ecc.) del database attuale dell'applicazione. Le migrazioni dovranno essere applicate a ogni database tenant individualmente.
   - Motiva brevemente la scelta: l'isolamento completo semplifica la sicurezza e la scalabilità, evita il rischio di data leakage accidentale tra tenant, e permette backup/restore indipendenti.
   - Prepara le migrazioni per il database principale (tabella `tenants`) e definisci un processo per creare un nuovo database tenant e applicargli le migrazioni esistenti.

3. Implementa il file `proxy.ts` prendendo come base il `middleware.ts` del template Vercel Platforms ma adattato a Next.js 16. La logica deve:
   - Estrarre il sottodominio dall'host della richiesta, gestendo tre casi: sviluppo locale (es. `tenant1.localhost:3000` o `tenant1.localhost`), anteprime Vercel (es. `tenant1---progetto.vercel.app`) e produzione (es. `tenant1.dominio.com`). In locale, tieni conto che la porta potrebbe essere assente e che l’host potrebbe contenere `localhost` o `127.0.0.1`.
   - Utilizzare una variabile d'ambiente `NEXT_PUBLIC_ROOT_DOMAIN` per determinare il dominio radice.
   - Se viene rilevato un sottodominio, riscrivere la richiesta internamente verso la rotta dinamica `/tenant/[subdomain]` utilizzando `NextResponse.rewrite`.
   - Bloccare l'accesso alle pagine sotto `/admin` dai sottodomini reindirizzando alla home del dominio principale.
   - Il matcher deve escludere i percorsi che iniziano con `/api`, `/_next`, e qualsiasi richiesta a file statici (es. immagini, font, script). Non utilizzare matcher negativi complessi; un'espressione regolare come `/((?!api|_next|.*\\..*).*)` è accettabile ma va testata.
   - Esportare la funzione `proxy` e il `config` con il matcher.

4. Accesso ai dati e connessione dinamica ai database tenant:
   - Crea una funzione helper asincrona `getTenantBySubdomain(subdomain: string)` che interroghi la tabella `tenants` nel database principale e restituisca l'oggetto tenant con tutte le credenziali di connessione. Implementa una cache in memoria (o Redis se già disponibile) per evitare query ripetute a ogni richiesta.
   - Modifica la logica di connessione al database: attualmente il progetto si connette a un unico database. Dovrai trasformare la connessione in una funzione dinamica che, dato un oggetto tenant, crei (o recuperi da un pool) una connessione al database del tenant. Per Next.js 16, considera di utilizzare un pattern con `AsyncLocalStorage` per associare la connessione del tenant alla richiesta corrente, senza propagate manualmente il tenant in ogni funzione.
   - Non devi aggiungere alcun filtro `tenant_id` nelle query; l'isolamento è garantito dal fatto che ogni query viene eseguita sul database corretto.
   - Assicurati che le API route e le server actions ottengano il tenant dal sottodominio e utilizzino la connessione appropriata.

5. Pagine e layout multi-tenant:
   - Crea la cartella dinamica `app/tenant/[subdomain]/` con un `page.tsx` che: recupera il tenant (dal database principale) tramite l'helper, passa i dati al componente di pagina, e se il tenant non esiste restituisce un 404 con `notFound()`.
   - La pagina deve visualizzare un'interfaccia personalizzata con il nome e l'eventuale logo/emoji del tenant presi dai `settings`. Se il progetto ha un header o un layout pubblici, questi devono adattarsi dinamicamente al tenant corrente.
   - Le pagine pubbliche (landing page, login, registrazione, ecc.) devono rimanere accessibili solo dal dominio principale, non dai sottodomini. Questa distinzione può essere gestita nel layout principale verificando la presenza del sottodominio e scegliendo il layout appropriato.

6. Interfaccia di amministrazione `/admin`:
   - Accessibile solo dal dominio principale. Verifica nel layout o in un middleware lato server che non ci sia un sottodominio, altrimenti redirect.
   - Implementa server actions per:
     * Creare un tenant: riceve nome, sottodominio, emoji/logo e impostazioni di default (opzionali). Deve anche creare un nuovo database per il tenant (con un nome univoco) ed eseguire automaticamente le migrazioni esistenti su quel database. Memorizza le credenziali di connessione nel database principale (con password cifrata, se possibile usando variabili d'ambiente per la crittografia o servizi di secret management).
     * Eliminare un tenant: elimina il database del tenant e la riga corrispondente nella tabella `tenants`. Gestisci la cancellazione in modo sicuro, prevenendo eliminazioni accidentali.
     * Listare tutti i tenant dal database principale, mostrando nome, sottodominio e data di creazione.
   - Crea una semplice UI amministrativa con le form per la creazione e la lista dei tenant esistenti.

7. Configurazione per lo sviluppo locale:
   - Imposta `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000` nel file `.env.local`.
   - Fornisci istruzioni per configurare il sistema affinché i sottodomini locali funzionino. La soluzione più semplice è modificare il file `/etc/hosts` aggiungendo righe come `127.0.0.1 tenant1.localhost tenant2.localhost`. In alternativa, suggerisci l'uso di un proxy inverso locale.
   - Per i database tenant in sviluppo, puoi creare database separati nello stesso server PostgreSQL/MySQL locale. I nomi possono seguire un pattern come `app_tenant1`, `app_tenant2`, ecc. Il database principale potrebbe chiamarsi `app_platform`. Prevedi un'istruzione per creare rapidamente un database tenant tramite un comando o uno script di seed.

8. Preparazione per il deploy su Vercel:
   - Spiega che in produzione `NEXT_PUBLIC_ROOT_DOMAIN` dovrà essere il dominio principale reale.
   - La piattaforma Vercel gestisce automaticamente i sottodomini wildcard quando si aggiunge un dominio wildcard (`*.miodominio.com`).
   - Per i database in produzione, ogni tenant avrà un database dedicato su un servizio di database (es. Neon, Supabase, PlanetScale, RDS). Il database principale (con la tabella `tenants`) può risiedere sullo stesso server o su un'istanza separata. Le credenziali di connessione ai database tenant devono essere generate e gestite in modo sicuro: valuta l'uso di variabili d'ambiente per il database principale e di un secret manager per le password dei tenant, ma per iniziare puoi memorizzarle cifrate nella tabella `tenants`.
   - Assicurati che la funzione `createTenant` possa creare database su un host condiviso; fornire esempi per PostgreSQL (con `CREATE DATABASE`) o per provider serverless che permettono la creazione dinamica di database via API (ad esempio Neon API, PlanetScale API, ecc.). Se il provider non supporta la creazione programmatica, spiega come gestire la pre-creazione manuale e poi registrare il tenant.

9. Sicurezza e isolamento:
   - L'isolamento dei dati è garantito dal fatto che ogni tenant ha il proprio database. Nessuna query cross-tenant è possibile se la connessione dinamica viene selezionata correttamente.
   - L'autenticazione, se presente, va estesa per supportare il multi-tenant: i cookie di sessione dovrebbero essere impostati con dominio wildcard (es. `.miodominio.com`) per consentire SSO tra il dominio principale e i sottodomini. In Next.js 16, i cookie possono essere configurati con l'opzione `domain` nelle API route o server actions.
   - Implementa controlli di autorizzazione: un utente autenticato deve poter accedere solo ai dati del tenant a cui appartiene. Questo può essere gestito a livello di applicazione verificando che il sottodominio della richiesta corrisponda al tenant dell'utente, evitando che un utente di un tenant possa accedere ai dati di un altro tenant anche se condividono la stessa applicazione.
   - Non includere mai le credenziali del database nel codice client; tutta la logica di connessione deve rimanere lato server.

10. Test e validazione:
    - Scrivi test che verificano:
      * L'estrazione del sottodominio in scenari di localhost, produzione e anteprima Vercel.
      * La riscrittura delle richieste verso `/tenant/[subdomain]` tramite il proxy.
      * L'isolamento dei dati: crea due tenant, ciascuno con il proprio database, inserisci dati distinti e verifica che un tenant non possa mai leggere o scrivere nel database dell'altro attraverso l'applicazione.
      * Le operazioni di amministrazione: creazione tenant con sottodominio duplicato (deve fallire), eliminazione tenant e verifica della cancellazione del database associato e della rimozione dalla lista.
    - Utilizza strumenti come Jest e Testing Library, mockando il proxy e il database principale/tenant secondo necessità.

11. Documentazione:
    - Aggiorna o crea un `README.md` che descrive l'architettura multi-tenant a database separati (database principale per il registro tenant, database dedicati per ciascun tenant, proxy, dynamic routing).
    - Spiega come avviare il progetto in locale con più tenant (configurazione degli host, creazione dei database tenant di sviluppo).
    - Elenca le variabili d'ambiente obbligatorie e opzionali, come quelle per la connessione al database principale.
    - Fornisce istruzioni per il deploy su Vercel e per la configurazione del dominio wildcard e della creazione dinamica dei database, con esempi per provider specifici.
    - Includi una guida rapida su come aggiungere un nuovo tenant (via admin UI o tramite script).

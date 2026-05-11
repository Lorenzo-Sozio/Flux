# Documentazione Multi-Tenant - Flux CRM

## Introduzione

Flux CRM è stato configurato per funzionare come una **piattaforma multi-tenant** con database completamente isolati per ogni cliente. Questa architettura garantisce massima sicurezza, isolamento dei dati e scalabilità.

### Architettura

```
┌─────────────────────────────────────────────────────────────────┐
│                       Proxy (proxy.ts)                          │
│          Estrae sottodominio e indirizzi la richiesta           │
└──────────────────────┬──────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
    ┌───▼────┐    ┌────▼────┐   ┌────▼────┐
    │ Tenant │    │ Tenant  │   │  Admin  │
    │ Alice  │    │  Bob    │   │ Domain  │
    └────────┘    └─────────┘   └─────────┘
        │              │              │
    ┌───▼────┐    ┌────▼────┐   ┌────▼────────┐
    │DB Alice│    │ DB Bob  │   │ Platform DB │
    │        │    │         │   │  (Tenants)  │
    └────────┘    └─────────┘   └─────────────┘
```

**Componenti principali:**

1. **Proxy** (`src/proxy.ts`) — Estrae il sottodominio dalla richiesta e indirizza il traffico
2. **Tenant Context** (`src/lib/tenant-context.ts`) — Fornisce la connessione al database corretto
3. **Platform DB** — Database principale con registro dei tenant
4. **Tenant DB** — Database dedicato per ogni tenant, completamente isolato

---

## 1. Come Funziona il Sistema

### 1.1 Estrazione del Sottodominio

Il proxy estrae il sottodominio da diverse forme di host:

| Ambiente | Esempio Host | Sottodominio | Dominio Radice |
|----------|-------------|-------------|-----------------|
| Locale | `alice.localhost:3000` | `alice` | `localhost:3000` |
| Locale | `bob.127.0.0.1:3000` | `bob` | `127.0.0.1:3000` |
| Vercel (anteprima) | `alice---project.vercel.app` | `alice` | `project.vercel.app` |
| Produzione | `alice.dominio.com` | `alice` | `dominio.com` |

### 1.2 Routing delle Richieste

```
Richiesta entrante
        │
        ▼
   ┌────────────┐
   │ Proxy      │
   │ (proxy.ts) │
   └────┬───────┘
        │
   Ha sottodominio?
        │
   ┌────┴─────┐
   │           │
  SI          NO
   │           │
   ▼           ▼
Rewrite      Main Domain
/tenant/[s]  (API + Admin)
   │
   ▼
Layout dinamico
   │
   ▼
Query al Platform DB
per recuperare tenant
   │
   ▼
Crea connessione a
Tenant DB
   │
   ▼
Serve la pagina
```

### 1.3 Accesso al Database

Quando una Server Action o Server Component ha bisogno di dati:

```javascript
// In una server action o server component
const db = await getDb();
const contacts = await db.query.contacts.findMany();
```

La funzione `getDb()` fa questo:

1. Tenta di leggere il sottodominio da `headers()`
2. Se siamo in request context (richiesta HTTP):
   - Estrae il sottodominio
   - Cerca il tenant nel Platform DB
   - Crea una connessione al Tenant DB
   - Ritorna l'istanza del Tenant DB
3. Se siamo fuori request context (startup del server):
   - Ritorna il Platform DB (fallback sicuro)

### 1.4 Isolamento dei Dati

**Non viene usato un campo `tenant_id` sulle tabelle.** Invece:

- Ogni tenant ha il suo **database completamente separato**
- La connessione è selezionata al runtime in base al sottodominio
- È impossibile leggere o scrivere dati di un altro tenant perché la connessione è completamente diversa

---

## 2. Configurazione per lo Sviluppo Locale

### 2.1 Prerequisiti

- Node.js 18+
- PostgreSQL (locale o remoto)
- npm

### 2.2 Setup della Configurazione

#### Passo 1: Configura il file `.env.local`

```bash
# Database principale (Platform)
DATABASE_URL="postgresql://user:password@localhost:5432/flux_platform"

# Dominio radice per lo sviluppo
NEXT_PUBLIC_ROOT_DOMAIN="localhost:3000"

# Chiave AES-256-GCM per cifrare le connection string dei tenant (OBBLIGATORIA)
# Genera con: openssl rand -hex 32
PLATFORM_ENCRYPTION_KEY="64-hex-chars-qui"

# NextAuth
AUTH_SECRET="genera-una-stringa-casuale-lunga"
AUTH_GOOGLE_ID="optional"
AUTH_GOOGLE_SECRET="optional"

# Email (Resend)
RESEND_API_KEY="optional"
```

#### Passo 2: Configura `/etc/hosts` (Windows)

Modificare il file `C:\Windows\System32\drivers\etc\hosts` e aggiungere:

```
127.0.0.1 localhost
127.0.0.1 alice.localhost
127.0.0.1 bob.localhost
127.0.0.1 charlie.localhost
```

Su macOS/Linux, modificare `/etc/hosts` con le stesse righe.

#### Passo 3: Crea i Database

```bash
# Accedi a PostgreSQL
psql -U postgres

# Crea il database principale
CREATE DATABASE flux_platform ENCODING 'UTF8';

# Crea database tenant di esempio
CREATE DATABASE flux_tenant_alice ENCODING 'UTF8';
CREATE DATABASE flux_tenant_bob ENCODING 'UTF8';

# Esci da psql
\q
```

#### Passo 4: Applica le Migrazioni

```bash
# Applica migrazioni al database principale
npx drizzle-kit push

# Se vuoi applicare anche ai tenant (opzionale per lo sviluppo)
# dovrai modificare DATABASE_URL e eseguire di nuovo
```

#### Passo 5: Popola la Tabella `tenants`

Accedi al database principale e inserisci i tenant:

```sql
-- Connettiti al database principale
psql -U postgres -d flux_platform

-- Inserisci i tenant
INSERT INTO tenants (id, name, subdomain, db_url, created_at) VALUES
  ('tenant-alice-id', 'Alice Corp', 'alice', 'postgresql://user:password@localhost:5432/flux_tenant_alice', NOW()),
  ('tenant-bob-id', 'Bob Inc', 'bob', 'postgresql://user:password@localhost:5432/flux_tenant_bob', NOW());
```

**Nota:** Se le password sono sensibili, considera di usare variabili d'ambiente per la crittografia. Per ora puoi memorizzarle in chiaro nel database di sviluppo.

#### Passo 6: Avvia il Server di Sviluppo

```bash
npm run dev
```

Il server partirà su `http://localhost:3000`.

### 2.3 Accedi ai Tenant in Locale

| URL | Scopo |
|-----|-------|
| `http://localhost:3000` | Home / Admin (dominio principale) |
| `http://alice.localhost:3000` | Dashboard di Alice |
| `http://bob.localhost:3000` | Dashboard di Bob |
| `http://charlie.localhost:3000` | Restituisce 404 (tenant non registrato) |

---

## 3. Creazione di un Nuovo Tenant

### 3.1 Via Admin UI (Consigliato)

Accedi come admin (ruolo `admin` o `owner`) a `http://localhost:3000/admin/tenants`:

1. Clicca su "Create New Tenant"
2. Inserisci:
   - **Nome**: es. "Acme Corp"
   - **Sottodominio**: es. "acme" (univoco, lowercase, 3-63 caratteri)
   - **Database URL**: connection string PostgreSQL del DB tenant (pre-creato su Neon/Postgres)
   - **Emoji** (opzionale): es. 🚀
3. Clicca "Crea Tenant" → il tenant viene registrato nel Platform DB con DB URL cifrato

**Dopo la creazione:**

4. Nella lista tenant, clicca **"Migrate DB"** per lo stesso tenant
   - Esegue `pushSchema` dal tenant-only schema sul DB tenant
   - Crea tutte le tabelle CRM (contacts, leads, deals, ecc.) ma non quelle platform
   - Sicuro da eseguire più volte (idempotente)

5. Clicca **"Members"** per aggiungere utenti al tenant (`/admin/tenants/acme`)
   - Cerca utente per email (deve essere già registrato sul platform)
   - Assegna ruolo: owner / admin / editor / viewer

**Nota:** La creazione del database PostgreSQL deve essere fatta manualmente su Neon/Supabase/RDS.
L'admin UI non crea database automaticamente — inserisce solo la connection string e applica il schema.

### 3.2 Via Script di Seed (Alternativa)

Se preferisci uno script per il setup batch:

```bash
# Non implementato ancora, ma puoi creare:
npm run seed:tenant -- --name "Acme Corp" --subdomain "acme"
```

### 3.3 Via Query SQL (Per Esperti)

```sql
-- 1. Crea il database tenant
CREATE DATABASE flux_tenant_acme ENCODING 'UTF8';

-- 2. Applica le migrazioni a quel database
-- (da fare via Drizzle o script custom)

-- 3. Registra nel Platform DB
INSERT INTO tenants (id, name, subdomain, db_url, created_at, settings) VALUES
  (
    'tenant-acme-id',
    'Acme Corp',
    'acme',
    'postgresql://user:password@localhost:5432/flux_tenant_acme',
    NOW(),
    '{"emoji": "🚀", "theme": "light"}'
  );
```

---

## 4. Gestione dei Tenant

### 4.1 Listare Tutti i Tenant

```bash
# Via SQL
psql -U postgres -d flux_platform -c "SELECT id, name, subdomain, created_at FROM tenants ORDER BY created_at DESC;"
```

### 4.2 Eliminare un Tenant

⚠️ **Attenzione: questa operazione è irreversibile.**

```bash
# 1. Ritira il tenant dal Platform DB
psql -U postgres -d flux_platform -c "DELETE FROM tenants WHERE subdomain = 'acme';"

# 2. Elimina il database tenant
psql -U postgres -c "DROP DATABASE IF EXISTS flux_tenant_acme;"
```

Oppure via admin UI (quando implementato):
- Accedi a `http://localhost:3000/admin/tenants`
- Trova il tenant
- Clicca "Elimina" (richiede conferma doppia)

### 4.3 Modificare un Tenant

```sql
-- Aggiorna il nome
UPDATE tenants SET name = 'Acme Corporation' WHERE subdomain = 'acme';

-- Aggiorna i settings (emoji, tema, ecc.)
UPDATE tenants SET settings = '{"emoji": "🎯", "theme": "dark"}' WHERE subdomain = 'acme';
```

---

## 5. Struttura del Database

### 5.1 Platform DB

Contiene il registro centralizzato di tutti i tenant e la tabella `users` condivisa per l'auth:

```sql
TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subdomain TEXT NOT NULL UNIQUE,
  db_url TEXT NOT NULL,  -- Connection string cifrata AES-256-GCM
  settings TEXT,         -- JSON: {"emoji": "🚀", "primaryColor": "#...", ...}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

TABLE tenant_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',  -- owner | admin | editor | viewer
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);
```

Le tabelle `user`, `account`, `session`, `verificationToken` vivono anch'esse sul platform DB (gestite da NextAuth DrizzleAdapter).

### 5.2 Tenant DB (uno per tenant, es. `flux_tenant_alice`)

Contiene la copia completa dello schema dell'applicazione:

- `contacts` — Contatti del tenant
- `companies` — Aziende del tenant
- `deals` — Opportunità di vendita
- `leads` — Lead acquisiti
- `tickets` — Ticket di supporto
- `automationRules` — Regole di automazione custom
- ... (tutte le altre tabelle dell'app)

**Non ha campo `tenant_id`.** L'isolamento è garantito dal fatto che è un database completamente separato.

---

## 6. Sicurezza e Isolamento

### 6.1 Principi

1. **Isolamento del Database**: ogni tenant ha il suo database completamente separato
2. **No Cross-Tenant Queries**: una query non può accedere dati di un altro tenant perché la connessione è a un database diverso
3. **No Data Leakage**: anche con un bug nell'applicazione, è impossibile leggere dati di un altro tenant
4. **Crittografia delle Credenziali**: le connection string sono cifrate AES-256-GCM nel Platform DB tramite `PLATFORM_ENCRYPTION_KEY`
5. **Membership check**: il dashboard layout verifica che l'utente sia un membro del tenant (`tenant_members`) a ogni richiesta

### 6.2 Autenticazione Multi-Tenant

L'autenticazione è **centralizzata sul Platform DB** (non sul DB tenant):

1. Utente accede a `alice.localhost:3000/auth/v1/login`
2. Inserisce email e password
3. NextAuth verifica le credenziali nel **Platform DB** (tabella `user`)
4. La sessione JWT viene impostata con **cookie wildcard** (`domain: .localhost` in dev, `.dominio.com` in prod)  
   → lo stesso cookie funziona su `localhost:3000` e su tutti i sottodomini
5. Dopo il login, `router.push("/dashboard/crm")` porta al CRM del tenant corrente
6. Il dashboard layout:
   - Verifica la membership in `tenant_members` (platform DB)
   - Fa upsert dell'utente nel tenant DB per soddisfare i FK constraint
   - Imposta `getDb()` → tenant DB per tutte le query CRM

**Nota importante:** un utente esiste una sola volta nel Platform DB. Può essere membro di più tenant con ruoli diversi. Non esistono account duplicati per tenant.

### 6.3 Protezione delle Rotte Admin

Le rotte sensibili (`/admin`, `/admin/tenants`, `/admin/settings`) sono protette da:

1. **Verifica del dominio**: il proxy blocca l'accesso ai `/admin` dai sottodomini
2. **Middleware di autenticazione**: solo il dominio principale consente l'accesso all'admin
3. **RBAC**: solo utenti con ruolo `admin` o `owner` possono accedere

---

## 7. Deployment su Vercel

### 7.1 Prerequisiti

- Account Vercel
- Dominio registrato (es. `flux.com`)
- Database PostgreSQL remoto (es. Neon, Supabase, PlanetScale)

### 7.2 Configurazione del Dominio

1. **Aggiungi il dominio a Vercel:**
   - Accedi a Vercel
   - Seleziona il progetto
   - Settings → Domains
   - Aggiungi `flux.com`

2. **Configura il DNS per i sottodomini wildcard:**
   - Nel registrar del dominio, aggiungi un record:
     ```
     *.flux.com  CNAME  cname.vercel.app
     ```
   - Vercel gestisce automaticamente tutti i sottodomini

3. **Variabili d'ambiente su Vercel:**
   ```
   DATABASE_URL=postgresql://user:password@neon.tech/flux_platform
   NEXT_PUBLIC_ROOT_DOMAIN=flux.com
   AUTH_SECRET=<gen-secret>
   AUTH_GOOGLE_ID=<optional>
   AUTH_GOOGLE_SECRET=<optional>
   RESEND_API_KEY=<optional>
   ```

### 7.3 Variabili d'ambiente su Vercel (complete)

```
DATABASE_URL=postgresql://user:password@neon.tech/flux_platform
NEXT_PUBLIC_ROOT_DOMAIN=flux.com
PLATFORM_ENCRYPTION_KEY=<64-hex-chars>
AUTH_SECRET=<gen-secret>
AUTH_GOOGLE_ID=<optional>
AUTH_GOOGLE_SECRET=<optional>
RESEND_API_KEY=<optional>
```

### 7.4 Database Tenant in Produzione

Ogni tenant ha il suo database Neon/Postgres separato:
```
Platform DB:  DATABASE_URL → flux_platform (tenant registry + auth)
Tenant DB:    creato manualmente su Neon, URL inserito nell'admin UI
```

Flusso per un nuovo tenant in produzione:
1. Crea un nuovo DB su Neon (es. `flux_tenant_acme`)
2. Copia la connection string
3. Vai su `https://flux.com/admin/tenants`
4. Crea il tenant con la connection string → viene cifrata e salvata
5. Clicca "Migrate DB" → applica lo schema al DB tenant
6. Aggiungi i membri via "Members"
7. Il tenant è live su `https://acme.flux.com`

CLI alternativo:
```bash
npx tsx src/scripts/migrate-tenant.ts "postgresql://user:password@neon.tech/flux_tenant_acme"
```

---

## 8. Troubleshooting

### Errore: "Tenant not found"

**Causa:** Il sottodominio non è registrato nel Platform DB.

**Soluzione:**
1. Verifica che il sottodominio sia scritto correttamente
2. Controlla che sia stato aggiunto alla tabella `tenants`:
   ```sql
   SELECT * FROM tenants WHERE subdomain = 'alice';
   ```
3. Se non c'è, aggiungi il tenant (vedi sezione 3)

### Errore: "Connection refused" al database tenant

**Causa:** La connection string memorizzata nel Platform DB è errata o il database non esiste.

**Soluzione:**
1. Controlla la connection string nel Platform DB:
   ```sql
   SELECT subdomain, db_url FROM tenants WHERE subdomain = 'alice';
   ```
2. Testa la connessione manualmente:
   ```bash
   psql $(echo "dbname=flux_tenant_alice host=localhost user=postgres")
   ```
3. Assicurati che il database esista:
   ```sql
   \l
   ```

### Errore: "headers outside request context"

**Causa:** Durante il startup del server, la funzione `getDb()` veniva chiamata senza request context.

**Soluzione:** Aggiornata in versione recente. Se persiste:
1. Verifica di aver aggiornato `src/lib/tenant-context.ts`
2. Assicurati che il try-catch attorno a `headers()` sia presente

### Dati di un tenant visibili a un altro

**Causa:** Problema di sicurezza gravissimo — non dovrebbe accadere.

**Soluzione:**
1. Verifica che `getDb()` stia ritornando il database corretto
2. Controlla i log del proxy per verificare che il sottodominio sia estratto correttamente
3. Contatta il team di sicurezza

---

## 9. Comandi Utili

### Sviluppo

```bash
# Avvia il server di sviluppo
npm run dev

# Verifica linting e formattazione
npm run check

# Applica fix automatici
npm run check:fix

# Apri Drizzle Studio per visualizzare/modificare i dati
npx drizzle-kit studio

# Genera migrazioni nuove
npx drizzle-kit generate
```

### Database

```bash
# Accedi al Platform DB
psql -U postgres -d flux_platform

# Accedi a un Tenant DB
psql -U postgres -d flux_tenant_alice

# Elenca tutti i database
psql -U postgres -l

# Esegui uno script SQL
psql -U postgres -d flux_platform -f script.sql
```

---

## 10. Checklist di Setup Iniziale

- [ ] Crea il file `.env.local` con le variabili d'ambiente
- [ ] Configura `/etc/hosts` con i sottodomini locali
- [ ] Crea il database principale (`flux_platform`)
- [ ] Crea almeno un database tenant (`flux_tenant_alice`)
- [ ] Applica le migrazioni: `npx drizzle-kit push`
- [ ] Popola la tabella `tenants` con almeno un tenant
- [ ] Avvia il server: `npm run dev`
- [ ] Accedi a `http://localhost:3000` per verificare
- [ ] Accedi a `http://alice.localhost:3000` per verificare il tenant
- [ ] Verifica i log del server per eventuali errori

---

## 11. Prossimi Passi

### Funzionalità già implementate ✅
- Admin UI per creazione/eliminazione/gestione tenant (`/admin/tenants`)
- Crittografia AES-256-GCM per connection string (`PLATFORM_ENCRYPTION_KEY`)
- Membership check per isolamento accessi (`tenant_members`)
- Cookie wildcard per SSO tra main domain e sottodomini
- Script CLI per migrare schema su tenant DB esistente
- Schema separato per tenant (`schema-tenant.ts`) → nessuna tabella platform sui DB tenant

### Roadmap futura
- [ ] **Invite by email**: invito tenant via email token (senza che l'utente debba già registrarsi)
- [ ] **Tenant branding**: usare `settings.primaryColor` nel dashboard UI per branding per-tenant
- [ ] **Cron jobs per-tenant**: i cron attuali girano solo su platform DB
- [ ] **Tenant self-registration**: utenti si registrano direttamente su sottodominio
- [ ] **Backup automatico**: script backup per DB tenant
- [ ] **Metriche utilizzo**: storage, API calls, utenti per tenant

---

**Per domande o problemi, consulta la sezione Troubleshooting o contatta il team di sviluppo.**

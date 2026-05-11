# Admin Tenants Management Page

## Panoramica

La pagina `/admin/tenants` consente agli amministratori della piattaforma di gestire i tenant (clienti) nel sistema multi-tenant. È accessibile solo da amministratori connessi dal dominio principale (non dai sottodomini).

## Accesso

**URL:** `http://localhost:3000/admin/tenants` (o `https://dominio.com/admin/tenants` in produzione)

**Requisiti di accesso:**
- Utente loggato
- Ruolo `admin` o `owner`
- Connesso dal **dominio principale** (non da un sottodominio tenant)

Se i requisiti non sono soddisfatti, l'utente viene reindirizzato a `/unauthorized`.

## Protezioni di Sicurezza

### 1. Autenticazione e Autorizzazione

```typescript
// src/lib/auth-guard.ts
await requireAdminAccess();
await requireMainDomain();
```

- **`requireAdminAccess()`**: Verifica che l'utente abbia il ruolo `admin` o `owner`
- **`requireMainDomain()`**: Verifica che la richiesta non provenga da un sottodominio tenant

### 2. Validazione degli Input

Tutte le azioni di creazione/aggiornamento validano gli input:

**Nome Tenant:**
- 1-255 caratteri
- Non può essere vuoto

**Subdomain:**
- 3-63 caratteri
- Lowercase, alfanumerico + trattini
- Pattern: `/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/`
- Deve essere univoco (nessun duplicato)

**Database URL:**
- Deve essere una connessione PostgreSQL valida
- Deve iniziare con `postgresql://` o `postgres://`
- Non viene mai mostrata nell'UI (visualizzata come password)

**Settings (JSON):**
- Facoltativo
- Accetta solo chiavi specifiche: `emoji`, `primaryColor`, `theme`, `logo`
- Tutto il resto viene scartato

### 3. Protezioni Specifiche per Operazione

#### Creazione Tenant

✅ **Validazioni:**
- Verifica unicità del subdomain
- Valida tutti i campi obbligatori
- Controlla il formato della connection string
- Valida il formato dei settings

❌ **Cosa è impedito:**
- Subdomain già esistenti
- Campi vuoti o non validi
- URL di database non PostgreSQL

#### Aggiornamento Tenant

✅ **Ammesso:**
- Aggiornare il nome
- Aggiornare i settings (emoji, colori, tema)

❌ **Impedito:**
- Non puoi cambiare il subdomain (per evitare confusione)
- Non puoi cambiare la connection string (per sicurezza)

#### Eliminazione Tenant

⚠️ **Protezioni:**
- Richiede doppia conferma (dialog esplicito)
- Impedisce eliminazione di subdomain riservati (`admin`, `www`)
- **Non elimina il database** - è intenzionale per prevenire perdita accidentale
- Il database deve essere eliminato manualmente tramite PostgreSQL

**Flusso di eliminazione:**
1. Admin clicca "Delete"
2. Si apre un dialog di conferma con avvertimenti
3. Admin deve cliccare nuovamente per confermare
4. Viene rimosso solo dal registro Platform DB
5. Manualmente: `DROP DATABASE flux_tenant_acme;`

### 4. Crittografia delle Credenziali

**Attuale (sviluppo):**
- Le connection string sono memorizzate in chiaro nel database Platform DB

**Produzione (TODO):**
- Implementare AES-256-GCM per la crittografia delle connection string
- Usare una chiave di crittografia memorizzata in variabili d'ambiente
- Mai esporre le password nelle risposte API

### 5. CSRF Protection

- Usa Server Actions di Next.js che includono automaticamente token CSRF
- I form POST sono protetti dal middleware di Next.js

### 6. Isolamento dei Dati

- Un admin di un tenant **non può** accedere a `/admin/tenants`
- Solo admin del dominio principale possono gestire i tenant
- Il proxy verifica che non ci sia sottodominio prima di permettere l'accesso

## Componenti della Pagina

### Layout Admin (`src/app/(main)/admin/layout.tsx`)

```
┌─────────────────────────────────────────┐
│          Administration                 │
│  Manage platform settings and tenants   │
└─────────────────────────────────────────┘
            ↓
        {children}
            ↓
    (Pagina dei tenant)
```

**Responsabilità:**
- Verifica autenticazione e ruolo
- Blocca l'accesso dai sottodomini
- Imposta layout comune per tutte le pagine admin

### Pagina Tenants (`src/app/(main)/admin/tenants/page.tsx`)

```
┌────────────────────────────────────────────┐
│           Create New Tenant                │
│  ┌──────────────────────────────────────┐  │
│  │  Form per creare nuovo tenant        │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│      Existing Tenants (N)                  │
│  ┌──────────────────────────────────────┐  │
│  │  Tabella con lista dei tenant        │  │
│  │  - Nome, subdomain, data creazione   │  │
│  │  - Bottoni: Copy URL, Delete         │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### Form Creazione (`src/app/(main)/admin/tenants/_components/create-tenant-form.tsx`)

**Campi:**
- `name` — Nome del tenant (required)
- `subdomain` — Sottodominio univoco (required, 3-63 chars)
- `dbUrl` — Connection string PostgreSQL (required, mostrata come password)
- `emoji` — Emoji facoltativo (max 2 char)

**Feedback:**
- Errori di validazione mostrati in Alert rosso
- Successo mostrato in Alert verde
- Form si resetta dopo creazione riuscita

### Lista Tenant (`src/app/(main)/admin/tenants/_components/tenants-list.tsx`)

**Colonne tabella:**
- Tenant (nome + emoji + ID)
- Subdomain (in monospaced)
- Data creazione
- Azioni (Copy URL, Delete)

**Funzionalità:**
- Copia l'URL del tenant negli appunti
- Mostra conferma con popup
- Delete richiede doppia conferma

## Server Actions (`src/actions/tenants.ts`)

### `listTenants()`
```typescript
await listTenants() // → Tenant[]
```
- Richiede admin access + main domain
- Ritorna lista di tutti i tenant con campi sanitizzati

### `getTenant(subdomain)`
```typescript
await getTenant("alice") // → Tenant
```
- Richiede admin access + main domain
- Ritorna un singolo tenant

### `createTenant(name, subdomain, dbUrl, settings?)`
```typescript
await createTenant(
  "Acme Corp",
  "acme",
  "postgresql://...",
  { emoji: "🚀" }
);
```
- Validazione completa degli input
- Controlla unicità subdomain
- Ritorna `{ id, name, subdomain }`
- Revalida cache della pagina

### `updateTenant(subdomain, updates)`
```typescript
await updateTenant("acme", {
  name: "Acme Corporation",
  settings: { emoji: "🎯" }
});
```
- Aggiorna solo nome e settings
- Non consente cambio subdomain o dbUrl

### `deleteTenant(subdomain)`
```typescript
await deleteTenant("acme");
```
- Verifica tenant esiste
- Blocca subdomain riservati
- Ritorna `{ success: true }`
- **Non elimina il database**

## Flow di Utilizzo

### Scenario 1: Creare un Nuovo Tenant

1. **Admin accede** a `http://localhost:3000/admin/tenants`
2. **Compila form:**
   - Name: "Acme Corporation"
   - Subdomain: "acme"
   - DB URL: `postgresql://user:pass@localhost:5432/flux_tenant_acme`
   - Emoji: "🚀"
3. **Sistema valida:**
   - ✅ Nome è valido (1-255 chars)
   - ✅ Subdomain è valido (3-63, lowercase)
   - ✅ Subdomain non esiste (unico)
   - ✅ URL è PostgreSQL
4. **Tenant registrato** nel Platform DB
5. **Messaggio di successo** → "Tenant created successfully!"
6. **Admin sa che deve:**
   - Creare il database: `CREATE DATABASE flux_tenant_acme;`
   - Applicare migrazioni
   - Il tenant sarà live a `http://acme.localhost:3000`

### Scenario 2: Eliminare un Tenant

1. **Admin clicca** "Delete" su un tenant
2. **Si apre dialog** con avvertimenti:
   - "This will remove **Acme Corp** from the registry"
   - "⚠️ The database will NOT be deleted"
   - "This action cannot be undone"
3. **Admin conferma** cliccando di nuovo "Delete Tenant"
4. **Sistema cancella** da Platform DB
5. **Admin sa che deve:**
   - Manualmente: `DROP DATABASE flux_tenant_acme;`

## Logging e Audit

**Attualmente:** Non implementato

**TODO in produzione:**
```typescript
// Aggiungere audit log
await logAuditEvent({
  action: "TENANT_CREATED",
  actor: session.user.email,
  tenantId: newTenant.id,
  timestamp: new Date(),
});
```

## Test di Sicurezza

### Test 1: Accesso senza autenticazione
```bash
curl http://localhost:3000/admin/tenants
# → Redirect a /unauthorized
```

### Test 2: Accesso come viewer (read-only)
- Login come utente con ruolo `viewer`
- Accedi a `/admin/tenants`
- → Redirect a /unauthorized ✅

### Test 3: Accesso da sottodominio tenant
```bash
# Accedi come admin di Alice
curl http://alice.localhost:3000/admin/tenants
# → Redirect a / ✅
```

### Test 4: Validazione subdomain
```typescript
// API POST con subdomain invalido
const response = await createTenant(
  "Test",
  "UPPERCASE",  // ❌ Deve essere lowercase
  "postgresql://..."
);
// → Errore: "Invalid subdomain format"
```

### Test 5: Protezione subdomain duplicato
```typescript
// Prova a creare due tenant con lo stesso subdomain
await createTenant("First", "acme", "postgresql://...");
await createTenant("Second", "acme", "postgresql://..."); 
// → Errore: "Subdomain 'acme' is already taken"
```

## Prossimi Step

- [ ] Aggiungere crittografia AES-256-GCM per connection string
- [ ] Implementare audit logging
- [ ] Aggiungere integrazione con Neon API per creazione automatica database
- [ ] Aggiungere bulk operations (delete multipli)
- [ ] Aggiungere import/export tenant configuration
- [ ] Aggiungere metriche di utilizzo per tenant (storage, API calls)
- [ ] Aggiungere feature flag per abilitare/disabilitare tenant
- [ ] Implementare soft-delete con recovery window

## Troubleshooting

### Errore: "You don't have permission to access this page"

**Causa:** Ruolo non è `admin` o `owner`, oppure sei su un sottodominio.

**Soluzione:**
1. Verifica il tuo ruolo nel database users
2. Accedi dal dominio principale, non da un sottodominio

### Errore: "Subdomain 'acme' is already taken"

**Causa:** Il sottodominio è già stato registrato.

**Soluzione:**
1. Scegli un sottodominio diverso
2. O elimina il tenant esistente (se necessario)

### La pagina dice "No tenants yet"

**Causa:** Il Platform DB è vuoto.

**Soluzione:**
1. Crea il primo tenant via form
2. Assicurati che il Platform DB sia stato inizializzato con migrazioni

---

**Accesso rapido:** `/admin/tenants` (dal dominio principale, come admin/owner)

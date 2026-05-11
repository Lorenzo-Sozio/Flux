# Architettura di Sicurezza - Pagina Admin Tenants

## Layers di Protezione

```
┌─────────────────────────────────────────────────────────────────┐
│  1. PROXY (proxy.ts)                                            │
│     • Estrae sottodominio da ogni richiesta                     │
│     • Blocca /admin dai sottodomini (redirect a /)              │
│     • Indirizz a /tenant/[subdomain] i sottodomini              │
└─────────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. MIDDLEWARE AUTENTICAZIONE (auth.ts)                         │
│     • Verifica sessione utente (cookie NextAuth)                │
│     • Estrae il ruolo dalla sessione                            │
│     • Ritorna 401 se non autenticato                            │
└─────────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. LAYOUT ADMIN (admin/layout.tsx)                             │
│     • Verifica role (admin/owner)                               │
│     • Verifica main domain (no subdomain)                       │
│     • Redirect a /unauthorized se no match                      │
└─────────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. SERVER ACTIONS (actions/tenants.ts)                         │
│     • Richiama requireAdminAccess()                             │
│     • Richiama requireMainDomain()                              │
│     • Valida tutti gli input                                    │
│     • Escono i dati sensibili                                   │
└─────────────────────────────────────────────────────────────────┘
              ↓
         Database Operazione
```

## Matrice di Controllo di Accesso

| Utente | Ruolo | Dominio | Accesso | Motivo |
|--------|-------|---------|--------|--------|
| Alice | owner | principale | ✅ ALLOW | Admin + Main domain |
| Bob | admin | principale | ✅ ALLOW | Admin + Main domain |
| Charlie | editor | principale | ❌ DENY | Non admin |
| David | viewer | principale | ❌ DENY | Non admin (read-only) |
| Eve | owner | subdomain | ❌ DENY | Su subdomain |
| Frank | admin | subdomain | ❌ DENY | Su subdomain |
| Logged Out | - | principale | ❌ DENY | Non autenticato |

## Validazione degli Input

```
┌──────────────────────────┐
│  Richiesta createTenant  │
└────────────┬─────────────┘
             │
      ┌──────▼──────┐
      │ name valido?│
      │ 1-255 chars │
      │ non vuoto   │  NO ────→ ❌ Errore
      └──────┬──────┘
             │ YES
      ┌──────▼──────────────┐
      │ subdomain valido?   │
      │ 3-63, lowercase     │  NO ────→ ❌ Errore
      │ /^[a-z0-9]...$/ │
      └──────┬──────────────┘
             │ YES
      ┌──────▼──────────────┐
      │ subdomain univoco?  │
      │ (no duplicati)      │  NO ────→ ❌ Errore
      └──────┬──────────────┘
             │ YES
      ┌──────▼──────────────┐
      │ dbUrl è PostgreSQL? │
      │ postgresql://...    │  NO ────→ ❌ Errore
      └──────┬──────────────┘
             │ YES
      ┌──────▼──────────────┐
      │ settings JSON OK?   │
      │ (emoji, color, etc)│  NO ────→ ❌ Errore
      └──────┬──────────────┘
             │ YES
             │
         ✅ Insert
```

## Protezione CSRF

```
┌─ Client (Browser) ──────────────────────────────────────────┐
│                                                             │
│  Form submit                                                │
│  POST /create-tenant                                        │
│  ├─ Hidden: NextAuth CSRF token (auto-incluso)             │
│  ├─ Content-Type: application/x-www-form-urlencoded       │
│  └─ Cookie: sessionId (httpOnly, secure)                   │
│                                                             │
└────────────────┬─────────────────────────────────────────────┘
                 │
                 ▼
┌─ Server (Next.js) ──────────────────────────────────────────┐
│                                                             │
│  Server Action riceve richiesta                            │
│  ├─ NextAuth middleware verifica CSRF token                │
│  ├─ Se token invalido: ❌ 403 Forbidden                    │
│  ├─ Se valido: continua                                    │
│  └─ Estrae dati da request body                            │
│                                                             │
└──────────────────────────────────────────────────────────────┘
```

## Rate Limiting (Proxy)

```
Endpoint: POST /api/auth/callback/credentials (login)
Limite: 10 tentativi / 60 secondi per IP

┌────────────────────────────────┐
│ Richiesta login fallita        │
│ IP: 192.168.1.100              │
└────────┬───────────────────────┘
         │
    Counter[IP] = 1
         │
    ┌────▼─────────────────┐
    │ Retry entro 60s?     │
    │ Counter < 10?        │
    └────┬─────────────────┘
         │
    Counter = 2 → 9 ✅ Allow
         │
    Counter = 10 ❌ Block
         │  Rate limited!
         │  429 Too Many Requests
         │  Retry-After: 60
         │
         └─ Dopo 60s: Counter reset
```

## Crittografia della Connection String

**Attuale (sviluppo):**
```sql
-- Memorizzato in chiaro (non sicuro!)
INSERT INTO tenants (name, subdomain, db_url) VALUES
  ('Acme Corp', 'acme', 'postgresql://user:password@host:5432/db');
```

**Produzione (TODO):**
```typescript
// Crittografare prima di salvare
const encrypted = encryptAES256GCM(
  dbUrl,
  process.env.ENCRYPTION_KEY,
  process.env.ENCRYPTION_IV
);

await platformDb.insert(tenants).values({
  dbUrl: encrypted, // AES-256-GCM ciphertext
});
```

**Decriptazione a runtime:**
```typescript
const encrypted = tenant.dbUrl;
const decrypted = decryptAES256GCM(
  encrypted,
  process.env.ENCRYPTION_KEY,
  process.env.ENCRYPTION_IV
);
return createTenantDb(tenant.id, decrypted);
```

## Protezione da SQL Injection

**Drizzle ORM (parametrized queries):**
```typescript
// ✅ SAFE - Parametrized
const result = await db
  .select()
  .from(tenants)
  .where(eq(tenants.subdomain, userInput)); // userInput è parametro

// Drizzle genera: SELECT * FROM tenants WHERE subdomain = $1
// Con userInput come valore separato dal SQL
```

**Input validation aggiuntiva:**
```typescript
function validateSubdomain(subdomain: string): boolean {
  // Whitelist di caratteri permessi
  const regex = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
  return regex.test(subdomain);
}

if (!validateSubdomain(input)) {
  throw new Error("Invalid subdomain");
}
```

## Protezione da XSS (Cross-Site Scripting)

```typescript
// ❌ UNSAFE - In un render component
<div dangerouslySetInnerHTML={{ __html: tenant.name }} />

// ✅ SAFE - React auto-escape
<div>{tenant.name}</div>
```

**Implementazione nostra:**
```tsx
// src/app/(main)/admin/tenants/_components/tenants-list.tsx
<div className="font-medium text-gray-900">
  {tenant.name}  {/* React auto-escapes HTML */}
</div>
```

## Protezione da Data Leakage

**Sensitive data che NON viene mai esposto:**

```typescript
// ❌ NEVER in API response
{
  id: "...",
  name: "Acme",
  subdomain: "acme",
  dbUrl: "postgresql://user:PASSWORD@host:5432/db"  // ❌ LEAK!
}

// ✅ SAFE - Sanitized response
{
  id: "...",
  name: "Acme",
  subdomain: "acme"
  // dbUrl omesso!
}
```

**Nel nostro codice:**
```typescript
// src/actions/tenants.ts listTenants()
await platformDb
  .select({
    id: tenants.id,
    name: tenants.name,
    subdomain: tenants.subdomain,
    settings: tenants.settings,
    createdAt: tenants.createdAt,
    updatedAt: tenants.updatedAt,
    // ✅ dbUrl NON incluso!
  })
  .from(tenants);
```

## Protezione da Privilege Escalation

```
┌─ Tenant Alice User ──────────────────────────────┐
│  Tenta di accedere a /admin/tenants              │
│  Header: Cookie: sessionId=alice_token           │
└─────────────────┬────────────────────────────────┘
                  │
              ▼ Server
         
    await requireAdminAccess()
    ├─ Estrae session da cookie
    ├─ Legge: role = "editor" (non admin)
    └─ ❌ Throw ForbiddenError
    
    Utente viene reindirizzato a /unauthorized
```

**Impossibile:**
- Cambiare il proprio ruolo in `admin` via URL
- Forgiare un cookie con ruolo admin (JWT/session signature checking)
- Accedere direttamente al database per auto-promozione

## Audit Trail (TODO)

```typescript
// Proposal per future implementazione

interface AuditLog {
  id: string;
  action: "TENANT_CREATED" | "TENANT_UPDATED" | "TENANT_DELETED";
  actor: string; // email dell'admin
  actorId: string; // user.id
  tenantId: string;
  changes: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

// Ogni operazione registra:
await logAudit({
  action: "TENANT_CREATED",
  actor: session.user.email,
  actorId: session.user.id,
  tenantId: newTenant.id,
  changes: { name, subdomain, emoji },
  ipAddress: req.headers.get("x-forwarded-for"),
  userAgent: req.headers.get("user-agent"),
});
```

## Incident Response

### Scenario: Subdomain leak

**Problema:** Un admin accidentalmente espone i dettagli di un tenant a un client concorrente.

**Azione:**
1. Elimina il tenant da `/admin/tenants`
2. Crea nuovo tenant con subdomain diverso
3. Il vecchio tenant diventa inaccessibile
4. Revisiona i log audit per scoprire se c'è stato accesso non autorizzato

### Scenario: Connection string compromessa

**Problema:** La password PostgreSQL di un tenant è stata leakdata.

**Azione:**
1. SSH nel server PostgreSQL
2. `ALTER USER tenant_user WITH PASSWORD 'newpassword';`
3. Aggiorna la connection string nel Platform DB
4. Verifica se ci sono stati accessi non autorizzati ai dati

## Checklist di Sicurezza

- [x] Autenticazione obbligatoria
- [x] Autorizzazione basata su ruolo (RBAC)
- [x] Protetto dal accesso da sottodomini
- [x] Validazione rigida degli input
- [x] Protezione CSRF (NextAuth)
- [x] Rate limiting
- [x] SQL injection protected (Drizzle ORM)
- [x] XSS protected (React auto-escape)
- [x] Dati sensibili non esposti
- [x] Privilege escalation impedito
- [ ] Crittografia connection string (TODO)
- [ ] Audit logging (TODO)
- [ ] Rate limiting per API pubbliche (TODO)
- [ ] WAF (Web Application Firewall) in produzione
- [ ] Regular penetration testing

---

**Tutti i layer di protezione devono essere superati per accedere ai dati sensibili.**

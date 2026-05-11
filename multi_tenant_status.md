# Multi-Tenant Implementation — Stato Attuale

*Aggiornato: 2026-05-11*

---

## Legenda

| Simbolo | Significato |
|---------|-------------|
| ✅ | Completo |
| ⚠️ | Parziale / da correggere |
| ❌ | Mancante |

---

## BLOCCO 1 — Infrastruttura base

| File | Stato | Note |
|------|-------|------|
| `src/db/index.ts` | ✅ | `platformDb` + `createTenantDb()` factory con cache in-memory; alias `db` rimosso |
| `src/db/schema.ts` | ✅ | Tabella `tenants`: id, name, subdomain (unique), dbUrl (cifrata), settings (JSON), timestamps |
| `src/db/migrations/0030_platform_tenants.sql` | ✅ | Migrazione creata manualmente |
| `src/lib/subdomain.ts` | ✅ | `extractSubdomainFromHost()` pura, edge-safe; gestisce localhost, Vercel preview, produzione |
| `src/lib/tenant-db.ts` | ✅ | `encryptDbUrl()` / `decryptDbUrl()` con AES-256-GCM; chiave da `PLATFORM_ENCRYPTION_KEY` (64 hex chars) |
| `src/lib/get-tenant.ts` | ✅ | `getTenantBySubdomain()` con cache TTL 5 min; `invalidateTenantCache()` esposta |
| `src/lib/tenant-context.ts` | ✅ | `getDb()` e `getCurrentSubdomain()` avvolti in `React.cache()`; fallback su `platformDb` fuori request context |
| `src/auth.config.ts` | ✅ | Callback `authorized` lascia passare le richieste da sottodominio senza RBAC |
| `src/proxy.ts` | ✅ | Proxy registrato correttamente con `export const proxy` (fix TurboPack manifest); rewrite usa `req.nextUrl.clone()` per evitare loop esterno; guard `/api/*` e `/tenant/*` presenti |
| `.env` | ✅ | `NEXT_PUBLIC_ROOT_DOMAIN` e `PLATFORM_ENCRYPTION_KEY` configurati |

---

## BLOCCO 2 — Migrazione `getDb()`

| Cosa | Stato | Note |
|------|-------|------|
| `src/actions/*.ts` | ✅ | Tutti i file usano `const db = await getDb()` per funzione |
| `src/app/api/**/*` | ✅ | Tutti i route handler migrati |
| `src/lib/*.ts` | ✅ | Inclusi `activity-logger.ts`, `campaign-send.ts`, `ticket-from-email.ts` |
| `src/components/crm/automation/*.ts` | ✅ | `action-dispatcher`, `email-service`, `loop-detector`, `rule-engine`, `scheduler` tutti migrati |
| `src/auth.ts` | ✅ | Usa `platformDb` direttamente (corretto — tabelle auth sul platform DB) |
| Import stale `{ db } from "@/db"` | ✅ | Zero occorrenze in tutto `src/` |

---

## BLOCCO 3 — Admin UI + Tenant pages

| File | Stato | Note |
|------|-------|------|
| `src/actions/tenants.ts` | ✅ | `listTenants`, `getTenant`, `createTenant` (con `encryptDbUrl`), `updateTenant`, `deleteTenant`; `invalidateTenantCache` chiamata su ogni mutazione |
| `src/app/(main)/admin/layout.tsx` | ✅ | Guard: `requireAdminAccess()` + `getCurrentSubdomain()` → redirect se sottodominio |
| `src/app/(main)/admin/tenants/page.tsx` | ✅ | SSR: carica lista tenant, mostra form creazione + tabella |
| `src/app/(main)/admin/tenants/_components/create-tenant-form.tsx` | ✅ | Client form: name, subdomain, dbUrl (mascherato), emoji; validazione + feedback |
| `src/app/(main)/admin/tenants/_components/tenants-list.tsx` | ✅ | Tabella con Copy URL e Delete; fix `AlertDialogTrigger` corretto (era `<Button>` nudo dentro `<AlertDialog>`) |
| `src/app/tenant/[subdomain]/page.tsx` | ✅ | Entry point CRM del tenant: branding, sign-in CTA verso main domain, feature grid |
| `src/app/tenant/[subdomain]/not-found.tsx` | ✅ | Pagina 404 con link a `/admin/tenants` |
| `src/app/tenant/[subdomain]/error.tsx` | ✅ | Error boundary client con messaggio dettagliato |
| Sidebar `/admin/tenants` | ✅ | Entry presente in `sidebar-items.ts` (sezione Administration, icona Shield) |

---

## BUG RISOLTI IN QUESTA SESSIONE

| Bug | File | Fix applicato |
|-----|------|---------------|
| Proxy non registrato nel middleware-manifest.json | `src/proxy.ts` | Aggiunto `export const proxy = auth(...)` (named export richiesto da TurboPack) + `export default proxy` |
| Rewrite URL esterno → loop doppio percorso | `src/proxy.ts` | Sostituito `new URL(..., req.url)` con `req.nextUrl.clone()` (NextURL = interno a Next.js) |
| `params` non awaited nella tenant page | `src/app/tenant/[subdomain]/page.tsx` | `const { subdomain } = await params` |
| Delete dialog non si apriva | `tenants-list.tsx` | Aggiunto `<AlertDialogTrigger asChild>` attorno al `<Button>` |

---

## BLOCCO 4 — Auth multi-tenant ✅

| Fix | Stato |
|-----|-------|
| Cookie wildcard domain in `src/auth.ts` | ✅ `.localhost` in dev, `.dominio.com` in prod |
| Tenant-user binding (`tenantMembers` + dashboard layout upsert) | ✅ |
| Tenant page redirect per utenti già autenticati | ✅ Redirect a `/dashboard/crm` se membro |
| Cross-tenant isolation | ✅ Dashboard layout verifica membership su `tenantMembers` |

**`src/auth.ts` — wildcard cookie config aggiunta:**
```ts
cookies: {
  sessionToken: {
    options: {
      domain: ".localhost",   // ".dominio.com" in prod
      sameSite: "lax",
      httpOnly: true,
      secure: false,          // true in prod
      path: "/",
    },
  },
}
```

---

## BLOCCO 5 — Setup DB tenant ✅

| Fix | Stato |
|-----|-------|
| `migrateTenantDb()` action in `src/actions/tenants.ts` | ✅ Usa `pushSchema` da `drizzle-kit/api` |
| CLI script `src/scripts/migrate-tenant.ts` | ✅ `npx tsx src/scripts/migrate-tenant.ts <url>` |
| UI "Migrate DB" button in admin tenants list | ✅ |

---

## BLOCCO 6 — Separazione schema platform / tenant ✅

| Fix | Stato |
|-----|-------|
| `src/db/schema-tenant.ts` | ✅ Re-esporta tutto tranne `tenants` e `tenantMembers` |
| `migrateTenantDb()` usa `schema-tenant` | ✅ Le tabelle platform non vengono pushate ai DB tenant |
| CLI script usa `schema-tenant` | ✅ |

**Nota:** `schema.ts` rimane il barrel principale usato da `platformDb` e da tutti i file
che importano tabelle CRM. `schema-tenant.ts` è usato solo per le migration ai tenant DB.

---

## BLOCCO 7 — Deploy Vercel ❌

1. **Dominio wildcard** su Vercel: aggiungere `*.dominio.com` nelle impostazioni dominio
2. **`NEXT_PUBLIC_ROOT_DOMAIN`** → `dominio.com` in produzione (env var su Vercel)
3. **Cookie sicuri** — la config wildcard del Blocco 4 funziona automaticamente in prod
   (`secure: true` quando `NODE_ENV === "production"`)
4. **`PLATFORM_ENCRYPTION_KEY`** → env var su Vercel (mai nel repo)
5. **`vercel.json`** → nessuna configurazione extra necessaria se il proxy è corretto

---

## REFACTORING MINORI (non bloccanti)

| Cosa | Dove | Priorità |
|------|------|----------|
| Spostare `requireMainDomain()` in `auth-guard.ts` | `src/actions/tenants.ts` → `src/lib/auth-guard.ts` | Bassa |
| Separare schema platform da schema tenant | `src/db/schema.ts` | Media (parte di Blocco 6) |
| Aggiungere audit log per operazioni tenant | `src/actions/tenants.ts` | Bassa |
| Route CRM sotto `/tenant/[subdomain]/dashboard/` | Nuovi file | Alta (necessario per Blocco 4) |

---

## ORDINE DI ESECUZIONE CONSIGLIATO

```
1. Blocco 4 → Cookie wildcard (auth.ts) + tenant-user binding model
2. Blocco 4 → Route CRM tenant (/tenant/[subdomain]/dashboard/) + redirect post-login
3. Blocco 5 → Script provisioning DB tenant
4. Blocco 6 → Separazione schema platform/tenant
5. Blocco 7 → Deploy Vercel con wildcard domain
```

---

## STIMA COMPLETAMENTO RIMANENTE

| Blocco | Stimato |
|--------|---------|
| Blocco 4 (cookie wildcard + binding) | 2–3 h |
| Blocco 4 (route CRM sotto tenant) | 2–4 h |
| Blocco 5 (provisioning script) | 1–2 h |
| Blocco 6 (schema separation) | 1 h |
| Blocco 7 (Vercel deploy) | 30 min |
| **Totale** | **~7–10 h** |

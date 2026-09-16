/**
 * entities.ts — every kind of record a person can open, in one list.
 *
 * ⚠️⚠️ **One registry, three consumers.** Global search, quick create and the
 * recents list each kept their own hardcoded list of entities, so every new
 * section had to be remembered in three places and was remembered in none:
 * invoices, contracts and credit notes existed for weeks without being findable,
 * creatable from the menu, or listed among recents. They all read this now, and
 * `entities.test.ts` fails when an entity has no search provider, no translation,
 * or a detail page that does not record visits.
 *
 * Pure data, no JSX: the search route runs on the server and icons are mapped by
 * name on the client (src/components/crm/entity-icon.tsx).
 */

import type { PlanModule } from "@/lib/billing/plans-config";
import type { Capability } from "@/lib/permissions";

/** The sections the menus are grouped by, in the order they are shown. */
export const ENTITY_GROUPS = ["crm", "sales", "documents", "support", "work", "marketing"] as const;
export type EntityGroup = (typeof ENTITY_GROUPS)[number];

export const ENTITY_TYPES = [
  "lead",
  "contact",
  "company",
  "deal",
  "product",
  "quote",
  "order",
  "contract",
  "invoice",
  "creditNote",
  "ticket",
  "task",
  "appointment",
  "campaign",
  "sequence",
  "template",
  "document",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EntityDef {
  type: EntityType;
  group: EntityGroup;
  /** A lucide icon name; see entity-icon.tsx. */
  icon: string;
  /** The plan module it belongs to. Absent means every plan has it. */
  module?: PlanModule;
  /** What reading it needs. */
  read: Capability;
  /**
   * Where a new one is made, and what that needs. Absent when it is only ever made
   * from another record (a credit note from an invoice, a document by uploading).
   */
  create?: { href: string; capability: Capability };
  /**
   * The page of one record, with `{id}` to fill. Absent when there is none and a
   * search result opens the list instead (products, templates).
   */
  detail?: string;
  /** The list page, for "see all" and for entities without a detail page. */
  list: string;
  /** Words that should find the create command in the palette, in both languages. */
  keywords: string[];
}

export const ENTITIES: readonly EntityDef[] = [
  {
    type: "lead",
    group: "crm",
    icon: "Target",
    read: "record:read",
    create: { href: "/dashboard/leads?new=true", capability: "record:write" },
    detail: "/dashboard/leads/{id}",
    list: "/dashboard/leads",
    keywords: ["lead", "prospect", "potenziale", "contatto commerciale"],
  },
  {
    type: "contact",
    group: "crm",
    icon: "User",
    read: "record:read",
    create: { href: "/dashboard/contacts?new=true", capability: "record:write" },
    detail: "/dashboard/contacts/{id}",
    list: "/dashboard/contacts",
    keywords: ["contact", "person", "contatto", "persona", "referente"],
  },
  {
    type: "company",
    group: "crm",
    icon: "Building2",
    read: "record:read",
    create: { href: "/dashboard/companies?new=true", capability: "record:write" },
    detail: "/dashboard/companies/{id}",
    list: "/dashboard/companies",
    keywords: ["company", "account", "customer", "azienda", "cliente", "società"],
  },
  {
    type: "deal",
    group: "sales",
    icon: "Handshake",
    module: "sales",
    read: "record:read",
    create: { href: "/dashboard/pipeline?new=true", capability: "record:write" },
    detail: "/dashboard/pipeline/{id}",
    list: "/dashboard/pipeline",
    keywords: ["deal", "opportunity", "trattativa", "opportunità"],
  },
  {
    type: "product",
    group: "sales",
    icon: "Package",
    module: "sales",
    read: "record:read",
    create: { href: "/dashboard/sales/products?new=true", capability: "product:manage" },
    list: "/dashboard/sales/products",
    keywords: ["product", "item", "sku", "prodotto", "articolo", "listino"],
  },
  {
    type: "quote",
    group: "documents",
    icon: "FileText",
    module: "sales",
    read: "record:read",
    create: { href: "/dashboard/sales/quotes/new", capability: "quote:write" },
    detail: "/dashboard/sales/quotes/{id}",
    list: "/dashboard/sales/quotes",
    keywords: ["quote", "estimate", "proposal", "offer", "preventivo", "offerta"],
  },
  {
    type: "order",
    group: "documents",
    icon: "ShoppingCart",
    module: "sales",
    read: "record:read",
    create: { href: "/dashboard/sales/orders/new", capability: "order:write" },
    detail: "/dashboard/sales/orders/{id}",
    list: "/dashboard/sales/orders",
    keywords: ["order", "sale", "ordine", "vendita"],
  },
  {
    type: "contract",
    group: "documents",
    icon: "ScrollText",
    module: "sales",
    read: "record:read",
    create: { href: "/dashboard/sales/contracts/new", capability: "contract:write" },
    detail: "/dashboard/sales/contracts/{id}",
    list: "/dashboard/sales/contracts",
    keywords: ["contract", "subscription", "renewal", "contratto", "abbonamento", "rinnovo"],
  },
  {
    type: "invoice",
    group: "documents",
    icon: "Receipt",
    module: "sales",
    read: "record:read",
    create: { href: "/dashboard/sales/invoices/new", capability: "invoice:write" },
    detail: "/dashboard/sales/invoices/{id}",
    list: "/dashboard/sales/invoices",
    keywords: ["invoice", "bill", "fattura", "fatturazione"],
  },
  {
    // Made from an issued invoice, never from nothing.
    type: "creditNote",
    group: "documents",
    icon: "Undo2",
    module: "sales",
    read: "record:read",
    detail: "/dashboard/sales/invoices/{id}",
    list: "/dashboard/sales/invoices",
    keywords: ["credit note", "refund", "nota di credito", "storno"],
  },
  {
    type: "ticket",
    group: "support",
    icon: "LifeBuoy",
    module: "support",
    read: "ticket:read",
    create: { href: "/dashboard/support/tickets?new=true", capability: "ticket:write" },
    detail: "/dashboard/support/tickets/{id}",
    list: "/dashboard/support/tickets",
    keywords: ["ticket", "case", "issue", "support", "richiesta", "assistenza", "segnalazione"],
  },
  {
    type: "task",
    group: "work",
    icon: "CheckSquare",
    read: "record:read",
    create: { href: "/dashboard/tasks?new=true", capability: "record:write" },
    detail: "/dashboard/tasks?task={id}",
    list: "/dashboard/tasks",
    keywords: ["task", "todo", "attività", "compito", "promemoria"],
  },
  {
    type: "appointment",
    group: "work",
    icon: "CalendarDays",
    read: "record:read",
    create: { href: "/dashboard/calendar?new=true", capability: "record:write" },
    detail: "/dashboard/calendar?appointment={id}",
    list: "/dashboard/calendar",
    keywords: ["appointment", "meeting", "event", "call", "appuntamento", "riunione", "evento"],
  },
  {
    type: "campaign",
    group: "marketing",
    icon: "Megaphone",
    module: "marketing",
    read: "record:read",
    create: { href: "/dashboard/marketing/campaigns?new=true", capability: "record:write" },
    detail: "/dashboard/marketing/campaigns/{id}",
    list: "/dashboard/marketing/campaigns",
    keywords: ["campaign", "newsletter", "mailing", "campagna"],
  },
  {
    type: "sequence",
    group: "marketing",
    icon: "Workflow",
    module: "marketing",
    read: "record:read",
    create: { href: "/dashboard/marketing/sequences/new", capability: "sequence:manage" },
    detail: "/dashboard/marketing/sequences/{id}",
    list: "/dashboard/marketing/sequences",
    keywords: ["sequence", "follow-up", "cadence", "sequenza", "sollecito"],
  },
  {
    type: "template",
    group: "marketing",
    icon: "Mail",
    module: "marketing",
    read: "record:read",
    list: "/dashboard/marketing/templates",
    keywords: ["template", "email template", "modello"],
  },
  {
    // Opened on the record it is attached to; the search result links there.
    type: "document",
    group: "work",
    icon: "Paperclip",
    read: "record:read",
    list: "/dashboard",
    keywords: ["document", "file", "attachment", "documento", "allegato"],
  },
];

const BY_TYPE = new Map(ENTITIES.map((e) => [e.type, e]));

export function entityDef(type: string): EntityDef | undefined {
  return BY_TYPE.get(type as EntityType);
}

/** The page of one record, or the list when the entity has no detail page. */
export function entityHref(type: string, id: string, fallbackQuery?: string): string {
  const def = entityDef(type);
  if (!def) return "/dashboard";
  if (def.detail) return def.detail.replace("{id}", encodeURIComponent(id));
  return fallbackQuery ? `${def.list}?q=${encodeURIComponent(fallbackQuery)}` : def.list;
}

/**
 * Whether the plan includes it. `enabledModules` null means "not known here" — the
 * route guards still apply — so nothing is hidden on a guess.
 */
export function entityInPlan(def: EntityDef, enabledModules: readonly string[] | null | undefined): boolean {
  if (!def.module || !enabledModules) return true;
  return enabledModules.includes(def.module);
}

/** Where a record of each kind is opened, for the parent a document is attached to. */
export const DOCUMENT_PARENT_TYPES: Record<string, EntityType> = {
  contact: "contact",
  lead: "lead",
  company: "company",
  deal: "deal",
  quote: "quote",
  ticket: "ticket",
  order: "order",
  invoice: "invoice",
  contract: "contract",
};

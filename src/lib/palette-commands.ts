/**
 * palette-commands.ts — the verbs the palette can run.
 *
 * ⌘K could only ever find nouns: type a name, open the record. Everything a
 * person does with the product still meant knowing which of thirteen modules it
 * lives in and going there first (audit rilievo S-01). The palette is the one
 * place that can replace "you have to know where it is" with "ask for it", and
 * it is the single change that most lowers the learning curve.
 *
 * Pure, and a plain list on purpose: adding a verb should be one line here, not a
 * change to the dialog.
 */

import type { Capability } from "@/lib/permissions";

export interface PaletteCommand {
  id: string;
  /**
   * Key under `search.commands` for what the user reads, phrased as the thing
   * they want rather than as a route.
   *
   * ⚠️ A key, not the words. These were English literals and the palette is the
   * first thing an Italian workspace opens: it read "New quote" under a heading
   * that said ACCESSO RAPIDO.
   */
  labelKey: string;
  /** Key under `search.commandGroups` for the module it belongs to. */
  groupKey: string;
  /**
   * Where it goes. `?new=true` is the convention the create modals already read,
   * so a command can land on a list page with its form already open.
   */
  href: string;
  /**
   * Extra words that should find this command.
   *
   * Somebody looking to invoice types "invoice", not "quote"; somebody who has
   * used another CRM types "opportunity" for a deal. Matching only the label is
   * how a launcher ends up feeling like it does not know its own product.
   */
  keywords: string[];
  /** Which capability the command needs. Absent means anyone who can read. */
  capability?: Capability;
  /** Names a lucide icon the dialog maps; keeps this module free of JSX. */
  icon: string;
}

export const PALETTE_COMMANDS: PaletteCommand[] = [
  {
    id: "new-quote",
    labelKey: "new-quote",
    groupKey: "sales",
    href: "/dashboard/sales/quotes/new",
    keywords: ["quote", "estimate", "proposal", "offer", "preventivo", "offerta"],
    capability: "quote:write",
    icon: "FileText",
  },
  {
    id: "new-order",
    labelKey: "new-order",
    groupKey: "sales",
    href: "/dashboard/sales/orders/new",
    keywords: ["order", "sale", "sell", "invoice", "ordine", "vendita"],
    capability: "order:write",
    icon: "ShoppingCart",
  },
  {
    id: "new-contact",
    labelKey: "new-contact",
    groupKey: "crm",
    href: "/dashboard/contacts?new=true",
    keywords: ["contact", "person", "customer", "contatto", "persona"],
    capability: "record:write",
    icon: "Contact",
  },
  {
    id: "new-lead",
    labelKey: "new-lead",
    groupKey: "crm",
    href: "/dashboard/leads?new=true",
    keywords: ["lead", "prospect", "enquiry", "inquiry", "opportunit"],
    capability: "record:write",
    icon: "Users",
  },
  {
    id: "new-company",
    labelKey: "new-company",
    groupKey: "crm",
    href: "/dashboard/companies?new=true",
    keywords: ["company", "account", "organisation", "organization", "azienda", "cliente"],
    capability: "record:write",
    icon: "Building2",
  },
  {
    id: "new-deal",
    labelKey: "new-deal",
    groupKey: "sales",
    href: "/dashboard/pipeline?new=true",
    keywords: ["deal", "opportunity", "pipeline", "trattativa"],
    capability: "record:write",
    icon: "Kanban",
  },
  {
    // No `?new=true` handler on these two: the command opens the list, where the
    // button is. Sending a parameter nothing reads would look like a broken
    // promise rather than a shortcut.
    id: "new-ticket",
    labelKey: "new-ticket",
    groupKey: "support",
    href: "/dashboard/support/tickets",
    keywords: ["ticket", "issue", "support", "problem", "complaint", "assistenza"],
    capability: "ticket:write",
    icon: "Headphones",
  },
  {
    id: "new-task",
    labelKey: "new-task",
    groupKey: "work",
    href: "/dashboard/tasks",
    keywords: ["task", "todo", "reminder", "attività", "promemoria"],
    capability: "record:write",
    icon: "CheckSquare",
  },
  {
    id: "dashboard",
    labelKey: "go-to-dashboard",
    groupKey: "work",
    href: "/dashboard/crm",
    keywords: ["dashboard", "home", "today", "agenda", "day", "oggi", "giornata"],
    icon: "ChartBar",
  },
  {
    id: "win-loss",
    labelKey: "win-loss",
    groupKey: "sales",
    href: "/dashboard/pipeline/win-loss",
    keywords: ["win", "loss", "lost", "why", "analysis", "vinte", "perse"],
    capability: "report:read",
    icon: "Swords",
  },
];

/** Everything the palette can offer this person, in menu order. */
function availableCommands(allow: (capability?: Capability) => boolean): PaletteCommand[] {
  return PALETTE_COMMANDS.filter((c) => allow(c.capability));
}

/**
 * Commands matching what has been typed.
 *
 * Matched on the label and on the keywords, so the words a person actually
 * reaches for find the thing. Word-prefix rather than substring: "or" should
 * offer "New order", and should not also offer everything with "or" in the
 * middle of a word.
 */
export function matchCommands(
  query: string,
  allow: (capability?: Capability) => boolean,
  /**
   * ⚠️ The words the person is actually reading, so typing them finds the
   * command. The labels are keys now, and matching a key means an Italian
   * workspace can find "New quote" by typing "quote" and not by typing
   * "preventivo" — which is the word on their screen.
   */
  labelOf: (command: PaletteCommand) => string = (command) => command.labelKey.replace(/-/g, " "),
  limit = 5,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const terms = q.split(/\s+/).filter(Boolean);

  const scored = availableCommands(allow)
    .map((command) => {
      const label = labelOf(command).toLowerCase();
      const haystack = [label, ...command.keywords.map((k) => k.toLowerCase())];
      // Every term has to land somewhere, so "new ord" narrows rather than widens.
      const matchesAll = terms.every((term) =>
        haystack.some((word) => word.split(/\s+/).some((part: string) => part.startsWith(term))),
      );
      if (!matchesAll) return null;
      // A hit on the label itself outranks one on a synonym.
      const onLabel = terms.every((term) => label.split(/\s+/).some((part: string) => part.startsWith(term)));
      return { command, score: onLabel ? 0 : 1 };
    })
    .filter((x): x is { command: PaletteCommand; score: number } => x !== null)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map((x) => x.command);
}

/**
 * palette-commands.ts — the verbs the palette can run.
 *
 * ⌘K could only ever find nouns: type a name, open the record. The palette is
 * the one place that can replace "you have to know where it is" with "ask for
 * it", and it is the single change that most lowers the learning curve.
 *
 * ⚠️ The "New …" commands are not written here any more: they come from
 * src/lib/entities.ts, the same list quick create and search read. They were a
 * hand-kept copy that never learnt about contracts or invoices.
 */

import { ENTITIES, type EntityGroup, type EntityType } from "@/lib/entities";
import type { Capability } from "@/lib/permissions";

export interface PaletteCommand {
  id: string;
  /** The entity it creates, whose `entities.types.<type>.new` is the label. */
  entity?: EntityType;
  /** Otherwise a section of the menu: its key under `nav.items`, and its group's under `nav.groups`. */
  navTitleKey?: string;
  navGroupKey?: string;
  group: EntityGroup;
  href: string;
  /** Extra words that should find this command, in both languages. */
  keywords: string[];
  capability?: Capability;
  /** The plan module it needs, when it needs one. */
  module?: string;
}

const CREATE_COMMANDS: PaletteCommand[] = ENTITIES.flatMap((e) =>
  e.create
    ? [
        {
          id: `new-${e.type}`,
          entity: e.type,
          group: e.group,
          href: e.create.href,
          keywords: ["new", "create", "add", "nuovo", "nuova", "crea", "aggiungi", ...e.keywords],
          capability: e.create.capability,
          module: e.module,
        },
      ]
    : [],
);

/**
 * Words that should find a section besides its own name — the ones people type for it.
 * The name itself, in the reader's language, always matches.
 */
const NAV_KEYWORDS: Record<string, string[]> = {
  "/dashboard/crm": ["dashboard", "home", "today", "agenda", "day", "oggi", "giornata"],
  "/dashboard/calendar": ["calendar", "calendario", "appointments", "appuntamenti"],
  "/dashboard/pipeline": ["board", "deals", "trattative", "opportunità"],
  "/dashboard/pipeline/win-loss": ["win", "loss", "lost", "why", "vinte", "perse"],
  "/dashboard/pipeline/forecast": ["forecast", "previsione"],
  "/dashboard/reports/scorecard": ["scorecard", "rep", "commerciale", "salesperson"],
  "/dashboard/queue": ["queue", "coda", "calls", "chiamate"],
};

interface NavEntry {
  titleKey: string;
  url: string;
  locked?: boolean;
  subItems?: readonly NavEntry[];
}

/**
 * "Go to …" for every section this person's menu holds — generated from the menu already
 * filtered for role, plan and workspace (§4.3), never written here: two lists of
 * destinations are two lists that disagree. What the menu leaves out as secondary is
 * included — the palette is where somebody finds what their menu does not list.
 *
 * ⚠️ Locked sections are left out: the menu shows them as the upgrade prompt, and a
 * palette row that opens the billing page would read as a broken link.
 */
export function navigationCommands(
  groups: readonly { labelKey?: string; items: readonly NavEntry[] }[],
): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const seen = new Set<string>();
  const add = (entry: NavEntry, groupKey: string | undefined) => {
    if (!entry.url || entry.locked || seen.has(entry.url)) return;
    seen.add(entry.url);
    out.push({
      id: `nav:${entry.url}`,
      navTitleKey: entry.titleKey,
      navGroupKey: groupKey,
      group: "work",
      href: entry.url,
      keywords: ["go", "open", "vai", "apri", entry.titleKey, ...(NAV_KEYWORDS[entry.url] ?? [])],
    });
  };
  for (const group of groups) {
    for (const item of group.items) {
      add(item, group.labelKey);
      for (const sub of item.subItems ?? []) if (!item.locked) add(sub, group.labelKey);
    }
  }
  return out;
}

export const PALETTE_COMMANDS: PaletteCommand[] = CREATE_COMMANDS;

export type CommandFilter = (command: PaletteCommand) => boolean;

/**
 * Commands matching what has been typed.
 *
 * Matched on the label the person reads and on the keywords, word-prefix rather
 * than substring: "or" should offer "New order", and not everything with "or" in
 * the middle of a word. Every term has to land somewhere, so "new ord" narrows.
 */
export function matchCommands(
  query: string,
  allow: CommandFilter,
  labelOf: (command: PaletteCommand) => string,
  limit = 5,
  commands: readonly PaletteCommand[] = PALETTE_COMMANDS,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = commands
    .filter(allow)
    .map((command) => {
      const label = labelOf(command).toLowerCase();
      const haystack = [label, ...command.keywords.map((k) => k.toLowerCase())];
      const matchesAll = terms.every((term) =>
        haystack.some((word) => word.split(/\s+/).some((part) => part.startsWith(term))),
      );
      if (!matchesAll) return null;
      const onLabel = terms.every((term) => label.split(/\s+/).some((part) => part.startsWith(term)));
      return { command, score: onLabel ? 0 : 1 };
    })
    .filter((x): x is { command: PaletteCommand; score: number } => x !== null)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map((x) => x.command);
}

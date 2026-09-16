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
  /** Otherwise, a key under `search.commands`. */
  labelKey?: string;
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

const NAVIGATION_COMMANDS: PaletteCommand[] = [
  {
    id: "dashboard",
    labelKey: "go-to-dashboard",
    group: "work",
    href: "/dashboard/crm",
    keywords: ["dashboard", "home", "today", "agenda", "day", "oggi", "giornata"],
  },
  {
    id: "win-loss",
    labelKey: "win-loss",
    group: "sales",
    href: "/dashboard/pipeline/win-loss",
    keywords: ["win", "loss", "lost", "why", "analysis", "vinte", "perse"],
    capability: "report:read",
    module: "sales",
  },
];

export const PALETTE_COMMANDS: PaletteCommand[] = [...CREATE_COMMANDS, ...NAVIGATION_COMMANDS];

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
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = PALETTE_COMMANDS.filter(allow)
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

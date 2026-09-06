/**
 * The mobile hazards that can be found by reading, rather than by looking.
 *
 * ⚠️ This is **not** a substitute for opening the app on a phone. It cannot see
 * a cramped layout, a bad line length or a control that is technically reachable
 * and horrible to use. What it does catch is the class of defect that is exact,
 * mechanical, and invisible on a desktop until somebody complains:
 *
 *   • a fixed width wider than the narrowest phone, with no escape;
 *   • a child that refuses to shrink, and so pushes its siblings off the screen;
 *   • `vh` where `dvh` was meant, which on iOS Safari measures a viewport taller
 *     than what is on screen;
 *   • a row of tabs that neither scrolls nor wraps, so the last ones cannot be
 *     reached at all;
 *   • a hand-rolled table with nothing to scroll it;
 *   • a grid of form controls that never narrows;
 *   • a popover wider than the screen it opens on;
 *   • a page that pads itself on top of the layout wrapper that already does.
 *
 * Run: node scripts/mobile-audit.mjs
 * Exits non-zero when anything is found, so it can be a gate rather than a note.
 */
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

/** The narrowest screen worth supporting: an iPhone SE, minus the page padding. */
const NARROWEST_CONTENT = 343;

/**
 * What a *nested* element may insist on.
 *
 * By the time a control is inside a card inside a two-column grid there is
 * nothing like 343px left, so a minimum width above this is a promise the
 * layout cannot keep.
 */
const RIGID_CHILD = 200;

const NEWLINE = /\r?\n/;

// ⚠️⚠️ The checker checks itself first.
//
// Five of the regexes below once held a literal 0x08, because a backslash-b in
// a Python string is a backspace and not a word boundary — and the scripts that
// edit this file are written in Python. Two rules therefore matched nothing,
// reported nothing, and the run said "clean". A checker that cannot fail is
// worse than no checker, because the green gets believed.
//
// Counted by code point rather than matched by a character class: a check for
// mangled escapes is the last place to put an escape that can be mangled.
{
  const self = readFileSync("scripts/mobile-audit.mjs", "utf8");
  const control = [...self].filter((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
  if (control.length > 0) {
    console.error(
      `mobile-audit: ${control.length} control character(s) in this file's own source — a regex escape was mangled, so its rule is not running.`,
    );
    process.exit(2);
  }
}

const findings = [];

function report(rule, file, line, detail) {
  findings.push({ rule, file: file.replace(/\\/g, "/"), line, detail });
}

/** The lines following a JSX tag, joined — enough to see what it contains. */
function blockAfter(source, line, count) {
  return source
    .split(NEWLINE)
    .slice(line - 1, line - 1 + count)
    .join(" ");
}

/** The lines before one, joined — enough to see what contains it. */
function blockBefore(source, line, count) {
  return source
    .split(NEWLINE)
    .slice(Math.max(0, line - 1 - count), line - 1)
    .join(" ");
}

/** One line, for deciding what a class is attached to. */
function lineOf(source, line) {
  return source.split(NEWLINE)[line - 1] ?? "";
}

/** Class attributes, with the line they sit on. */
function* classAttributes(source) {
  const lines = source.split(NEWLINE);
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(/className=\{?["'`]([^"'`]*)["'`]/g)) {
      yield { line: i + 1, classes: match[1].split(/\s+/).filter(Boolean) };
    }
  }
}

/** A Tailwind class with a responsive prefix is already conditional. */
const hasBreakpoint = (cls) => /^(sm|md|lg|xl|2xl|max-sm|max-md|max-lg|@[a-z0-9]+):/.test(cls);

const files = [];
for await (const entry of glob("src/**/*.tsx")) files.push(entry);

for (const file of files.sort()) {
  const source = readFileSync(file, "utf8");
  const isUiPrimitive = /components[\\/]ui[\\/]/.test(file);

  for (const { line, classes } of classAttributes(source)) {
    for (const cls of classes) {
      // ── A width wider than the narrowest phone, unconditionally ────────────
      const width = cls.match(/^w-\[(\d+)px\]$/);
      if (width && Number(width[1]) > NARROWEST_CONTENT && !hasBreakpoint(cls)) {
        report("fixed-width", file, line, `${cls} is wider than a ${NARROWEST_CONTENT}px content column`);
      }

      // ⚠️ `min-w` is judged far more harshly than `w`. A width is a hint the
      // browser overrides under pressure; a minimum is a refusal to shrink, and
      // one refusing child pushes every sibling out of the viewport. Almost
      // nothing nested inside a phone's column may insist on 200px — unless it
      // sits in something that scrolls sideways, which is what a kanban is.
      const minWidth = cls.match(/^min-w-\[(\d+)px\]$/);
      if (minWidth && Number(minWidth[1]) > RIGID_CHILD && !hasBreakpoint(cls)) {
        const scrolls = /overflow-x-auto|overflow-auto/.test(blockBefore(source, line, 10));
        if (!scrolls) {
          report("rigid-min-width", file, line, `${cls} refuses to shrink inside a ${NARROWEST_CONTENT}px column`);
        }
      }

      // ── vh, where the browser and the screen disagree ──────────────────────
      //
      // ⚠️ `h-screen` and `min-h-screen` are `100vh` spelled differently, and
      // they were the majority of the offenders — eight full-page shells whose
      // last row sat under the iOS toolbar.
      if (/^(min-h|max-h|h)-\[[\d.]+vh\]$/.test(cls) || /^(min-h|max-h|h)-screen$/.test(cls)) {
        report("vh-unit", file, line, `${cls} — iOS Safari's vh excludes the address bar; use dvh`);
      }

      // ── A grid of form fields that never narrows ──────────────────────────
      //
      // ⚠️ Only grids that hold **controls**. Three short numbers across a
      // phone is a good layout, not a defect, and a rule that flagged those too
      // would be noise — which is a rule nobody reads. A select or a text field
      // at 110px, on the other hand, truncates whatever is in it.
      const cols = cls.match(/^grid-cols-(\d+)$/);
      if (cols && Number(cols[1]) >= 3 && !isUiPrimitive) {
        const narrower = classes.some((c) => /^(grid-cols-1|grid-cols-2)$/.test(c));
        const holdsControls = /<(Input|Textarea|SelectTrigger|SearchableSelect|Combobox)/.test(
          blockAfter(source, line + 1, 14),
        );
        if (!narrower && holdsControls) {
          report("rigid-grid", file, line, `${cls} of form controls, with no narrower fallback`);
        }
      }

      // ── Two columns of form fields ────────────────────────────────────────
      //
      // 160px a field on a phone: labels wrap onto two lines, placeholders are
      // cut off mid-word, and a date input has no room for the picker its own
      // browser draws. One field per row below sm.
      //
      // ⚠️ A `col-span-2` inside a one-column grid makes the browser invent a
      // second column, which is exactly the overlap this rule exists to
      // prevent — so the span has to carry the same breakpoint.
      if (cls === "grid-cols-2" && !isUiPrimitive && !classes.some((c) => /^(sm|md|lg|xl):grid-cols-/.test(c))) {
        const block = blockAfter(source, line + 1, 22);
        const fields = (block.match(/<Input\b|<SelectTrigger|<Textarea|<FormField/g) ?? []).length;
        if (fields >= 2) {
          report("two-column-form", file, line, `${fields} form fields two-across, with no single-column fallback`);
        }
      }

      if (cls === "col-span-2" && !isUiPrimitive) {
        const grid = blockBefore(source, line, 40).match(/grid-cols-(\d+)(?![\s\S]*grid-cols-)/);
        if (grid && grid[1] === "1") {
          report("orphan-span", file, line, "col-span-2 under a one-column grid invents a second column");
        }
      }

      // ── Two columns of *selects* ──────────────────────────────────────────
      // Two text fields across 343px is 160px each, which is tight but honest.
      // Two selects is 160px each minus a chevron and the padding, and every
      // label longer than a word is cut in half.
      if (cls === "grid-cols-2" && !isUiPrimitive && !classes.some((c) => /^(sm|md):grid-cols-/.test(c))) {
        const block = blockAfter(source, line, 18);
        if ((block.match(/<SelectTrigger|<SearchableSelect/g) ?? []).length >= 2) {
          report("two-selects", file, line, "grid-cols-2 of selects — 160px each cuts most labels in half");
        }
      }

      // ── A popover wider than the screen it opens on ───────────────────────
      const popoverWidth = cls.match(/^w-(\d+)$/);
      if (popoverWidth && Number(popoverWidth[1]) * 4 > NARROWEST_CONTENT && !hasBreakpoint(cls)) {
        if (/(Popover|DropdownMenu|Select|Command|HoverCard|Tooltip)Content/.test(lineOf(source, line))) {
          const px = Number(popoverWidth[1]) * 4;
          report("wide-popover", file, line, `${cls} (${px}px) on a ${NARROWEST_CONTENT}px screen`);
        }
      }
    }
  }

  // ── A header whose title refuses to shrink ────────────────────────────────
  //
  // ⚠️⚠️ This is the one that actually pushes content off a phone, and it is
  // invisible in the class list: a flex child's default `min-width: auto` means
  // it will not shrink below its own content. So a long title in a
  // `justify-between` row does not elide — it grows, and the buttons beside it
  // go past the edge of the screen. Twelve headers in this product did that.
  //
  // The fix is always the same: `min-w-0` on the text block, so it may shrink,
  // and a gap so the two do not touch when it does.
  for (const { line, classes } of classAttributes(source)) {
    const cls = classes.join(" ");
    const isRow = classes.includes("flex") && classes.includes("justify-between");
    if (!isRow || classes.includes("flex-col") || /flex-col/.test(cls)) continue;

    const next = lineOf(source, line + 1);
    const isPlainBlock = /^\s*<div(\s+className="[^"]*")?>\s*$/.test(next);
    if (!isPlainBlock || /min-w-0|flex-1|truncate/.test(next)) continue;

    const holdsTitle = /<h[123]\b|CardTitle/.test(blockAfter(source, line + 1, 5));
    const holdsControl = /<Button|DropdownMenuTrigger/.test(blockAfter(source, line + 1, 22));
    if (holdsTitle && holdsControl) {
      report("no-shrink-header", file, line, "title block has no min-w-0, so it pushes the buttons off the screen");
    }
  }

  // ── A row of tabs that cannot be reached ──────────────────────────────────
  //
  // Handled at the root: the TabsList primitive wraps below sm and scrolls
  // above it, so no usage needs its own rule. What is checked instead is that
  // the primitive still does — see the `missing-rule` block at the bottom.
  // A usage that *overrides* the wrap is worth knowing about, though.
  for (const match of source.matchAll(/<TabsList([^>]*)>/g)) {
    const line = source.slice(0, match.index).split(NEWLINE).length;
    const triggers = (blockAfter(source, line, 40).match(/<TabsTrigger/g) ?? []).length;
    if (triggers >= 4 && /\bh-\d|\boverflow-hidden|\bflex-nowrap/.test(match[1])) {
      report("tabs-overflow", file, line, `${triggers} tabs, and this usage overrides the wrap`);
    }
  }

  // ── A table with nothing to scroll it ─────────────────────────────────────
  // Lowercase only: the `Table` primitive wraps itself in a scroll container,
  // so a `<Table>` is never the finding — a hand-rolled `<table>` is.
  // The `^\s*` anchor keeps a `<table>` inside a placeholder string out of it.
  for (const match of source.matchAll(/^\s*<table[\s>]/gm)) {
    const line = source.slice(0, match.index ?? 0).split(NEWLINE).length + 1;
    if (!/overflow-x-auto|overflow-auto/.test(blockBefore(source, line, 6))) {
      report("unscrollable-table", file, line, "a hand-rolled table with no horizontally scrollable parent");
    }
  }

  // ── A viewport height in an inline style ──────────────────────────────────
  //
  // ⚠️ The class rules above read `className` only, so `style={{ maxHeight:
  // "calc(100vh - 280px)" }}` walked straight past them — and the calendar had
  // two of them, holding the height of the week and day grids.
  // ⚠️ Any `vh`, not only `100vh`: `maxHeight: "85vh"` is the same iOS defect at
  // 85% of it. And an inline style beats every class a primitive sets, so a
  // dialog sizing itself here silently opts out of the responsive layout the
  // primitive was given.
  for (const match of source.matchAll(/style=\{\{[^}]*[0-9]vh/g)) {
    const line = source.slice(0, match.index ?? 0).split(NEWLINE).length;
    report("vh-unit", file, line, "a vh height in an inline style — use dvh, and prefer a class");
  }

  // ── Hover-only controls ─────────────────────────────────────────────────
  // Covered globally by a `(hover: none)` rule in globals.css; this counts them
  // so the rule cannot be deleted without the number moving.
  const hoverOnly = source.match(/group-hover:opacity-100/g);
  if (hoverOnly) report("hover-only", file, 0, `${hoverOnly.length} hover-revealed control(s)`);
}

// ── The layout wrapper is the only owner of page padding ────────────────────
for await (const entry of glob("src/app/(main)/dashboard/**/page.tsx")) {
  const source = readFileSync(entry, "utf8");
  const root = source.match(/\n {2}return \(\n {4}<\w+[^>]*className=\{?["'`]([^"'`]*)["'`]/);
  if (root && /\bp-\d|\bpx-\d/.test(root[1])) {
    report("double-padding", entry, 0, `page root sets ${root[1]} on top of the layout wrapper`);
  }
}

// ── The rules everything above depends on ───────────────────────────────────
const css = readFileSync("src/app/globals.css", "utf8");
const required = [
  ["--safe-bottom", "safe-area variables"],
  ["--mobile-nav-height", "the bottom bar's height, referenced by the chat button and the install offer"],
  ["@media (hover: none)", "the rule that reveals hover-only controls on touch"],
  ["pointer: coarse", "the 44px touch targets"],
];
const tabs = readFileSync("src/components/ui/tabs.tsx", "utf8");
if (!/max-sm:flex-wrap/.test(tabs)) {
  report(
    "missing-rule",
    "src/components/ui/tabs.tsx",
    0,
    "tab rows no longer wrap on a phone; the last tabs become unreachable",
  );
}
for (const [needle, what] of required) {
  if (!css.includes(needle)) report("missing-rule", "src/app/globals.css", 0, `${what} is gone (${needle})`);
}

// ── Report ──────────────────────────────────────────────────────────────────
const byRule = new Map();
for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);

// Hover-only sites are handled globally; they are counted, not failed on.
const blocking = findings.filter((f) => f.rule !== "hover-only");

for (const [rule, items] of [...byRule].sort()) {
  console.log(`\n${rule}  (${items.length})`);
  for (const item of items.slice(0, 24)) {
    console.log(`  ${item.file}${item.line ? `:${item.line}` : ""}  ${item.detail}`);
  }
  if (items.length > 24) console.log(`  … and ${items.length - 24} more`);
}

console.log(`\n${blocking.length === 0 ? "clean" : `${blocking.length} to fix`} — ${files.length} components read\n`);
process.exit(blocking.length === 0 ? 0 : 1);

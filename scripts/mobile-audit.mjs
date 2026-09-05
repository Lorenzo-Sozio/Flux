/**
 * The mobile hazards that can be found by reading, rather than by looking.
 *
 * ⚠️ This is **not** a substitute for opening the app on a phone. It cannot see
 * a cramped layout, a bad line length or a control that is technically reachable
 * and horrible to use. What it does catch is the class of defect that is exact,
 * mechanical, and invisible on a desktop until somebody complains:
 *
 *   • a fixed width wider than the narrowest phone, with no escape;
 *   • `vh` where `dvh` was meant, which on iOS Safari measures a viewport that
 *     is taller than what is on screen;
 *   • a control revealed only by hover, on a device that has none;
 *   • a grid that never falls back to one or two columns;
 *   • a page that pads itself on top of the layout wrapper that already does.
 *
 * Run: node scripts/mobile-audit.mjs
 * Exits non-zero when anything is found, so it can be a gate rather than a note.
 */
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

/** The narrowest screen worth supporting: an iPhone SE, minus the page padding. */
const NARROWEST_CONTENT = 343;

const findings = [];

function report(rule, file, line, detail) {
  findings.push({ rule, file: file.replace(/\\/g, "/"), line, detail });
}

/** Class attributes, with the line they sit on. */
function* classAttributes(source) {
  const lines = source.split("\n");
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
  const isUiPrimitive = file.includes("components/ui/") || file.includes("components\\ui\\");

  for (const { line, classes } of classAttributes(source)) {
    for (const cls of classes) {
      // ── A width wider than the narrowest phone, unconditionally ────────────
      const width = cls.match(/^w-\[(\d+)px\]$/);
      if (width && Number(width[1]) > NARROWEST_CONTENT && !hasBreakpoint(cls)) {
        report("fixed-width", file, line, `${cls} is wider than a ${NARROWEST_CONTENT}px content column`);
      }

      const minWidth = cls.match(/^min-w-\[(\d+)px\]$/);
      if (minWidth && Number(minWidth[1]) > NARROWEST_CONTENT && !hasBreakpoint(cls)) {
        report("fixed-width", file, line, `${cls} cannot shrink below a phone's width`);
      }

      // ── vh, where the browser and the screen disagree ──────────────────────
      if (/^(min-h|max-h|h)-\[[\d.]+vh\]$/.test(cls)) {
        report("vh-unit", file, line, `${cls} — iOS Safari's vh excludes the address bar; use dvh`);
      }

      // ── A grid of form fields that never narrows ──────────────────────────
      //
      // ⚠️ Only grids that hold **controls**. Three short numbers across a
      // phone is a good layout, not a defect, and a rule that flagged those
      // too would be noise — which is a rule nobody reads. A select or a text
      // field at 110px, on the other hand, truncates whatever is in it.
      const cols = cls.match(/^grid-cols-(\d+)$/);
      if (cols && Number(cols[1]) >= 3 && !isUiPrimitive) {
        const narrower = classes.some((c) => /^(grid-cols-1|grid-cols-2)$/.test(c));
        const holdsControls = /<(Input|Textarea|SelectTrigger|SearchableSelect|Combobox)/.test(
          source
            .split(/\r?\n/)
            .slice(line, line + 14)
            .join(" "),
        );
        if (!narrower && holdsControls) {
          report("rigid-grid", file, line, `${cls} of form controls, with no narrower fallback`);
        }
      }
    }
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
  for (const item of items.slice(0, 20)) {
    console.log(`  ${item.file}${item.line ? `:${item.line}` : ""}  ${item.detail}`);
  }
  if (items.length > 20) console.log(`  … and ${items.length - 20} more`);
}

console.log(
  `\n${blocking.length === 0 ? "clean" : `${blocking.length} to fix`} — ${files.length} components read\n`,
);
process.exit(blocking.length === 0 ? 0 : 1);

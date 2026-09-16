#!/usr/bin/env node

/**
 * i18n-audit — text a person reads that does not go through next-intl.
 *
 * The dashboard is offered in Italian and English. A string typed straight into
 * JSX shows in that one language to everybody, and nothing fails: the page renders,
 * the build is green, and a customer on the other language reads a sentence they
 * did not choose. This reads every component with the TypeScript parser and lists
 *
 *   - JSX text with letters in it,
 *   - string literals given to attributes people read (placeholder, title,
 *     aria-label, alt, label, description, emptyText, searchPlaceholder, …),
 *   - string literals passed to toast.success / toast.error / toast.info / toast,
 *   - `confirm("…")`,
 *   - string literals in object properties with those same names, or `header` /
 *     `message`: column definitions, option lists and label maps, which render
 *     just as visibly as JSX does.
 *
 * Usage:
 *   node scripts/i18n-audit.mjs            # report, exit 1 when anything is found
 *   node scripts/i18n-audit.mjs --summary  # counts per file only
 *
 * What is deliberately not counted: text that is not language (numbers, symbols,
 * "—", "·", a lone "%"), product and brand names listed in ALLOWED, and anything
 * inside the documents a customer receives (src/lib/document-language.ts owns
 * those, in both languages, checked by its own test).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

const ROOTS = ["src/app/(main)/dashboard", "src/app/(main)/auth", "src/app/q", "src/components"];
const SKIP_DIRS = new Set(["node_modules", ".next"]);
const SKIP_FILES = [/\.test\.tsx?$/, /\.d\.ts$/, /components\/ui\//];

const READ_ATTRIBUTES = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "label",
  "description",
  "emptyText",
  "searchPlaceholder",
  "tooltip",
  "helperText",
  "confirmLabel",
  "cancelLabel",
  "submitLabel",
  "subtitle",
  "heading",
]);

/** Text that is the same in every language. */
const ALLOWED = new Set([
  "Flux",
  "Flux CRM",
  "CRM",
  "API",
  "SDI",
  "PEC",
  "IBAN",
  "CSV",
  "PDF",
  "XML",
  "URL",
  "ID",
  "OK",
  "Email",
  "Google",
  "Microsoft",
  "Outlook",
  "Gmail",
  "WhatsApp",
  "LinkedIn",
  "Resend",
  "SMTP",
  "Stripe",
  "Webhook",
  "Webhooks",
  "iCal",
  "Italiano",
  "English",
  "EUR",
  "USD",
  "N/A",
  "SendGrid",
  "Amazon SES",
  "Outlook / Microsoft 365",
  "resend.com",
  "Georgia",
  "Trebuchet",
  "Verdana",
  "esc",
  "DELETE",
]);

function isLanguage(text) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (ALLOWED.has(t)) return false;
  // Needs at least two consecutive letters to be a word in any language.
  if (!/\p{L}{2,}/u.test(t)) return false;
  // Codes and identifiers: ORD-2026, snake_case, a lone lowercase token like "px".
  if (/^[A-Z0-9_-]+$/.test(t) && t.length <= 5) return false;
  if (/^[a-z]+(_[a-z]+)+$/.test(t)) return false;
  // HTML entities, URLs, email addresses, domains, markup and currency codes are the
  // same in every language.
  if (/^(&[a-z]+;)+$/.test(t)) return false;
  if (/^(https?:\/\/|www\.)\S*$/.test(t)) return false;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(t)) return false;
  if (/^[\w-]+(\.[\w-]+)+$/.test(t)) return false;
  if (/^<[a-z]+>.*<\/[a-z]+>$/.test(t)) return false;
  if (/^[A-Z]{3} \(.{1,3}\)$/.test(t)) return false;
  return true;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

function audit(file) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const lines = source.split("\n");
  // An example value that reads the same in both languages ("Acme Corp") is marked
  // with `i18n-ignore` on its line or up to four lines above (the opening of the
  // element whose attribute it is).
  const ignored = (node) => {
    const line = at(node);
    return lines.slice(Math.max(0, line - 6), line).some((l) => /i18n-ignore/.test(l));
  };

  function literalText(node) {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isJsxExpression(node) && node.expression) return literalText(node.expression);
    if (ts.isTemplateExpression(node)) {
      return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
    }
    return null;
  }

  function visit(node) {
    if (ignored(node)) {
      // skip
    } else if (ts.isJsxText(node)) {
      const text = node.getText(sf);
      if (isLanguage(text)) found.push({ line: at(node), kind: "text", text: text.trim() });
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (READ_ATTRIBUTES.has(name)) {
        const text = literalText(node.initializer);
        if (text && isLanguage(text)) found.push({ line: at(node), kind: name, text });
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sf).replace(/^["']|["']$/g, "");
      if (READ_ATTRIBUTES.has(name) || name === "header" || name === "message") {
        const text = literalText(node.initializer);
        if (text && isLanguage(text)) found.push({ line: at(node), kind: `${name}:`, text });
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (
        /^(toast(\.(success|error|info|warning|message))?|confirm|window\.confirm|alert|window\.alert)$/.test(callee)
      ) {
        const text = literalText(node.arguments[0]);
        if (text && isLanguage(text)) found.push({ line: at(node), kind: callee, text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

const summary = process.argv.includes("--summary");
const files = ROOTS.flatMap((r) => {
  try {
    return walk(r, []);
  } catch {
    return [];
  }
})
  .map((f) => f.split("\\").join("/"))
  .filter((f) => !SKIP_FILES.some((re) => re.test(f)));

let total = 0;
const perFile = [];
for (const file of files) {
  const found = audit(file);
  if (found.length === 0) continue;
  total += found.length;
  perFile.push({ file: relative(process.cwd(), file).split("\\").join("/"), found });
}
perFile.sort((a, b) => b.found.length - a.found.length);

for (const { file, found } of perFile) {
  if (summary) {
    console.log(`${String(found.length).padStart(4)}  ${file}`);
    continue;
  }
  console.log(`\n${file}`);
  for (const f of found) console.log(`  ${String(f.line).padStart(5)}  ${f.kind.padEnd(12)} ${f.text.slice(0, 90)}`);
}
console.log(`\n${total} untranslated string(s) in ${perFile.length} file(s) — ${files.length} components read`);
process.exit(total > 0 ? 1 : 0);

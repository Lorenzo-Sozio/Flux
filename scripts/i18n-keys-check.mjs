#!/usr/bin/env node

/**
 * i18n-keys-check — every literal key a component asks next-intl for exists, in both languages.
 *
 * A missing key renders the key itself ("quotes.detail.backToQuotes") in
 * production, and next-intl only logs it in development. This reads each
 * component, maps the variables bound to `useTranslations("ns")` /
 * `getTranslations("ns")` (or `{ namespace: "ns" }`) to their namespace, and
 * checks every `t("literal")` / `t.rich("literal")` / `t.raw("literal")` call
 * against messages/it.json and messages/en.json.
 *
 * Keys built at runtime (`t(\`statuses.${s}\`)`) cannot be checked this way and
 * are skipped; `t.has` guards are respected by skipping `t.has(...)` itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

const it = JSON.parse(readFileSync("messages/it.json", "utf8"));
const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const has = (obj, path) =>
  path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj) !== undefined;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const missing = [];
for (const file of walk("src", [])) {
  const text = readFileSync(file, "utf8");
  if (!/Translations|getTranslations/.test(text)) continue;
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const ns = new Map();

  const namespaceOf = (call) => {
    const arg = call.arguments[0];
    if (!arg) return "";
    if (ts.isStringLiteral(arg)) return arg.text;
    if (ts.isObjectLiteralExpression(arg)) {
      const p = arg.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText(sf) === "namespace");
      if (p && ts.isStringLiteral(p.initializer)) return p.initializer.text;
      return p ? null : "";
    }
    return null;
  };

  function collect(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      let init = node.initializer;
      if (ts.isAwaitExpression(init)) init = init.expression;
      if (ts.isCallExpression(init) && /^(useTranslations|getTranslations)$/.test(init.expression.getText(sf))) {
        const n = namespaceOf(init);
        if (n !== null) ns.set(node.name.text, n);
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(sf);
  if (ns.size === 0) continue;

  function check(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name = null;
      if (ts.isIdentifier(callee)) name = callee.text;
      else if (
        ts.isPropertyAccessExpression(callee) &&
        ["rich", "raw", "markup"].includes(callee.name.text) &&
        ts.isIdentifier(callee.expression)
      ) {
        name = callee.expression.text;
      }
      const arg = node.arguments[0];
      if (name && ns.has(name) && arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        const key = ns.get(name) ? `${ns.get(name)}.${arg.text}` : arg.text;
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if (!has(it, key)) missing.push(`${file}:${line}  it  ${key}`);
        if (!has(en, key)) missing.push(`${file}:${line}  en  ${key}`);
      }
    }
    ts.forEachChild(node, check);
  }
  check(sf);
}

for (const m of missing) console.log(m.split("\\").join("/"));
console.log(`\n${missing.length} missing key reference(s)`);
process.exit(missing.length ? 1 : 0);

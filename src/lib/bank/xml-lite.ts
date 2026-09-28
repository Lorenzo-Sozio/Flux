/**
 * Just enough XML to read a bank statement, the same in the browser, on the server and in tests.
 *
 * ⚠️ Not `DOMParser`: it exists in the browser only, and the server re-reads nothing from the
 * file — but the tests have to parse the same bytes the browser does, and a library for it would
 * land in the Worker's bundle, which has no room to spare. A CAMT file is element-only XML with
 * no mixed content worth keeping, so a small reader is the whole requirement: elements,
 * attributes, text, CDATA, comments and processing instructions, the five named entities and
 * numeric ones. Namespace prefixes are dropped: a bank writes `<Ntry>` or `<camt:Ntry>` as it likes.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[e.toLowerCase()] ?? whole;
  });
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);

/** Parses a document into its root element. Throws on markup that does not close. */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const lt = source.indexOf("<", i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) stack[stack.length - 1].text += decodeEntities(source.slice(i, textEnd));
    if (lt === -1) break;
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end === -1) throw new Error("xml: unterminated comment");
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end === -1) throw new Error("xml: unterminated CDATA");
      stack[stack.length - 1].text += source.slice(lt + 9, end);
      i = end + 3;
    } else if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      if (end === -1) throw new Error("xml: unterminated processing instruction");
      i = end + 2;
    } else if (source.startsWith("<!", lt)) {
      // A DOCTYPE: skipped whole, internal subset included.
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j++) {
        if (source[j] === "[") depth++;
        else if (source[j] === "]") depth--;
        else if (source[j] === ">" && depth <= 0) break;
      }
      i = j + 1;
    } else if (source[lt + 1] === "/") {
      const end = source.indexOf(">", lt);
      if (end === -1) throw new Error("xml: unterminated end tag");
      const name = local(source.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new Error(`xml: unexpected </${name}>`);
      i = end + 1;
    } else {
      // A start tag: attribute values may hold ">", so it is read quote-aware.
      let j = lt + 1;
      let quote = "";
      for (; j < n; j++) {
        const c = source[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= n) throw new Error("xml: unterminated start tag");
      let body = source.slice(lt + 1, j);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const nameMatch = /^\s*([^\s/>]+)/.exec(body);
      if (!nameMatch) throw new Error("xml: tag without a name");
      const node: XmlNode = { name: local(nameMatch[1]), attrs: {}, children: [], text: "" };
      const rest = body.slice(nameMatch[0].length);
      for (const m of rest.matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
        node.attrs[local(m[1])] = decodeEntities(m[3] ?? m[4] ?? "");
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error(`xml: <${stack[stack.length - 1].name}> is never closed`);
  const top = root.children[0];
  if (!top) throw new Error("xml: no root element");
  return top;
}

/** The first descendant along a path of element names: `child(ntry, "Amt")`, `child(n, "BookgDt", "Dt")`. */
export function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let at = node;
  for (const name of path) {
    at = at?.children.find((c) => c.name === name);
    if (!at) return undefined;
  }
  return at;
}

/** Every direct child with this name. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** The trimmed text at a path, or null. */
export function textAt(node: XmlNode | undefined, ...path: string[]): string | null {
  const t = child(node, ...path)?.text.trim();
  return t ? t : null;
}

/** Every element with this name anywhere below `node`, in document order. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

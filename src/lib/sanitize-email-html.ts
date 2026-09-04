/**
 * sanitize-email-html.ts — email HTML that is about to be rendered in the app.
 *
 * An email body is authored as raw HTML: that is what an email is, and it cannot
 * be escaped away without making the editor useless. But the product renders that
 * HTML back into its own pages — the template preview, the ticket thread, the
 * send dialog — and at that point it is markup from one user running inside
 * another user's session.
 *
 * The guard that existed removed `<script>` and nothing else, which is the least
 * of it: `<img src=x onerror=…>` and `<a href="javascript:…">` both survived, and
 * an inbound ticket email is written by a stranger.
 *
 * This runs without a DOM on purpose — it is used on the server, in a Worker and
 * in the browser — so it is deliberately conservative: anything it cannot be sure
 * about, it removes.
 */

/** Elements whose whole content goes, not just their tags. */
const DANGEROUS_ELEMENTS = ["script", "style", "iframe", "object", "embed", "applet", "noscript", "template"];

/** Elements removed as tags, keeping nothing. They carry no visible content. */
const VOID_DANGEROUS = ["link", "meta", "base", "form", "input", "button", "textarea", "select"];

/**
 * Schemes an attribute may point at.
 *
 * `data:` is allowed only for images, which is how inline logos travel in email;
 * `data:text/html` is a script delivery mechanism and is not on the list.
 */
const SAFE_URL = /^(?:https?:|mailto:|tel:|cid:|#|\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)/i;

function stripElementWithContent(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
  return html.replace(re, "").replace(selfClosing, "");
}

/**
 * Removes what can execute, and leaves what can be read.
 *
 * Not a general-purpose sanitiser and not a replacement for a real parser: it is
 * a denylist, and a denylist is only ever as good as its list. It is here because
 * the alternative in this codebase was one regular expression for `<script>`.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return "";

  let out = html;

  for (const tag of DANGEROUS_ELEMENTS) out = stripElementWithContent(out, tag);
  for (const tag of VOID_DANGEROUS) out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");

  // Event handlers, in every spelling: quoted, single-quoted, and bare.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // Anything pointing somewhere, checked against the allowed schemes. An href
  // that is not clearly safe is dropped rather than rewritten: a link that does
  // nothing is a visible bug, and a link that runs code is not.
  out = out.replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (whole) => {
    const value = /=\s*"([^"]*)"|=\s*'([^']*)'|=\s*([^\s>]+)/.exec(whole);
    // Trimmed, then matched against the allowlist. Anything with a control
    // character or a smuggled scheme simply fails to match, which is the outcome
    // wanted — there is nothing to strip out first.
    const url = (value?.[1] ?? value?.[2] ?? value?.[3] ?? "").trim();
    return SAFE_URL.test(url) ? whole : "";
  });

  // `style` can load and position things; `expression()` still runs in old
  // Outlook, and `position:fixed` lets a mail overlay the application's own UI.
  out = out.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (whole, css: string) => (isSafeCss(css) ? whole : ""));
  out = out.replace(/\sstyle\s*=\s*'([^']*)'/gi, (whole, css: string) => (isSafeCss(css) ? whole : ""));

  return out;
}

/** True for inline CSS that cannot fetch, execute, or escape its own box. */
export function isSafeCss(css: string): boolean {
  const flat = css.toLowerCase().replace(/\s+/g, "");
  return !(
    flat.includes("expression(") ||
    flat.includes("javascript:") ||
    flat.includes("behavior:") ||
    flat.includes("-moz-binding") ||
    flat.includes("@import") ||
    flat.includes("position:fixed")
  );
}

/**
 * Plain text as the email editor's HTML: escaped, a blank line between paragraphs, a single line
 * break inside one. Pure and dependency-free, so both the browser (a quote's default message)
 * and the server (a model's draft, a starter template) use the same one.
 */
export function paragraphsToHtml(text: string): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

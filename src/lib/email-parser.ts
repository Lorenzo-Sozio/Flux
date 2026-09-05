/**
 * Lightweight email body cleaner — strips quoted reply history and common
 * HTML signature blocks without any external dependencies.
 *
 * Used by the inbound email webhook to extract only the new reply text.
 */

// Common Gmail/Outlook/Apple quote-header patterns
const QUOTE_HEADER_PATTERNS = [
  // "On Mon, 1 Jan 2024, at 12:00, Name <email> wrote:"
  /^On\s.+wrote:\s*$/im,
  // "---- Original Message ----" (Outlook)
  /^-{3,}\s*Original Message\s*-{3,}/im,
  // "From: Name <email>" block starting a quote
  /^From:\s*.+\n(Sent|Date|To|Subject):/im,
  // "> " style plain-text quote
  /^>\s/m,
];

/**
 * Strips quoted reply history from plain-text email body.
 * Returns only the new reply portion.
 */
export function stripPlainTextQuotes(body: string): string {
  for (const pattern of QUOTE_HEADER_PATTERNS) {
    const match = body.search(pattern);
    if (match !== -1) {
      return body.slice(0, match).trimEnd();
    }
  }
  return body.trim();
}

/**
 * Strips HTML signatures and quoted reply blocks from an HTML email body.
 * Returns cleaned HTML string.
 */
export function stripHtmlQuotesAndSignature(html: string): string {
  let cleaned = html;

  // Remove Gmail-style quoted block: <div class="gmail_quote">...</div>
  cleaned = cleaned.replace(/<div[^>]*class="gmail_quote"[^>]*>[\s\S]*?<\/div>/gi, "");

  // Remove Outlook quoted block: <div id="appendonsend">...</div>
  cleaned = cleaned.replace(/<div[^>]*id="appendonsend"[^>]*>[\s\S]*?<\/div>/gi, "");

  // Remove Apple Mail quote: <blockquote type="cite">...</blockquote>
  cleaned = cleaned.replace(/<blockquote[^>]*type="cite"[^>]*>[\s\S]*?<\/blockquote>/gi, "");

  // Remove generic signature divs with common class names
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*signature[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  // Remove Yahoo "yiv" signature containers
  cleaned = cleaned.replace(/<div[^>]*id="yiv[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  // Trim whitespace-only <p> or <br> at the end
  cleaned = cleaned.replace(/(\s*<br\s*\/?>\s*)+$/gi, "").trim();

  return cleaned;
}

/**
 * Extract plain-text preview from HTML (first 200 chars, no tags).
 */
export function htmlToTextPreview(html: string, maxLength = 200): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * Parse a raw "From" header value into name + email.
 * Handles formats: "Name <email>", "<email>", "email"
 */
export function parseFromHeader(from: string): { name: string | null; email: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^"|"$/g, "").trim() || null, email: match[2].trim().toLowerCase() };
  }
  return { name: null, email: from.trim().toLowerCase() };
}

/**
 * Extract a ticket ID from an email subject or In-Reply-To header.
 * Tickets embed their number in subjects like: "[TKT-202401-ABCDEF] ..."
 * Returns the ticket number or null.
 */
export function extractTicketReference(subject: string): string | null {
  const match = subject.match(/\[?(TKT-\d{6}-[A-F0-9]{6})\]?/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Every address in a `To:` header, lowercased, display names discarded.
 *
 * ⚠️ This decides which customer's database an inbound email is filed in, so it
 * returns all of them and not just the first: a customer writes to the person
 * they know and copies the support address, and it is the support address that
 * names the workspace.
 */
export function recipientAddresses(header: string): string[] {
  const seen = new Set<string>();
  for (const part of header.split(",")) {
    // `parseFromHeader` has already trimmed and lowercased it: doing so again
    // here is work no input can tell apart, which is untested code by definition.
    const email = parseFromHeader(part.trim()).email;
    // Must actually look like an address. A `To:` header legitimately carries
    // group syntax such as `undisclosed-recipients:;`, and the header parser
    // hands that back as though it were one — which then goes looking for a
    // workspace configured to send from it.
    if (email?.includes("@")) seen.add(email);
  }
  return [...seen];
}

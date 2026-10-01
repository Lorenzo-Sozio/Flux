/**
 * What every email to a customer looks like: the workspace's frame (its colour, its logo, its
 * company details), a person's signature, and the boxes a document puts in front of the text.
 *
 * Pure: no database, no request. The loader is src/lib/email-brand-load.ts; the profile page
 * draws its preview with these same functions, so the preview is the email.
 *
 * ⚠️⚠️ **Everything a person typed is escaped, every link is http(s), every colour is a hex.**
 * A job title, a website, a company name reach the customer's inbox inside HTML: one `"` in an
 * unescaped attribute is somebody else's markup in an email signed by the business.
 *
 * ⚠️ Email HTML, not web HTML: tables, inline styles, system fonts. Outlook ignores most of CSS
 * (no border-radius, no max-width on a div), Gmail strips `<style>`, and a phone's mail app
 * turns colours dark on its own. Every block sets its own background and text colour so a dark
 * reader has something definite to invert, and nothing depends on a stylesheet.
 */

export type BrandLang = "it" | "en";

export const SOCIAL_KINDS = ["linkedin", "instagram", "facebook", "x", "youtube"] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];

export const DEFAULT_BRAND_COLOR = "#1d4ed8";

/** The workspace's identity as stored (`workspace_setting` `brand.identity`): what Settings → General writes. */
export interface BrandIdentity {
  color: string;
  website: string | null;
  socials: Partial<Record<SocialKind, string>>;
}

export const NO_BRAND_IDENTITY: BrandIdentity = { color: DEFAULT_BRAND_COLOR, website: null, socials: {} };

/** Everything an email needs to carry the business's identity. */
export interface EmailBrand {
  /** The legal name, as on the invoices. */
  name: string;
  color: string;
  /** A public, signed address of the logo (src/lib/brand-logo-token.ts), or null for a wordmark. */
  logoUrl: string | null;
  website: string | null;
  socials: { kind: SocialKind; url: string }[];
  address: string | null;
  vatNumber: string | null;
  phone: string | null;
  email: string | null;
}

/** A person's part of the signature as stored (`workspace_setting` `signature.<userId>`), from their Profile. */
export interface SignatureSettings {
  /** Off: no signature is added to what they send, whatever the dialog says. */
  enabled: boolean;
  title: string;
  phone: string;
  mobile: string;
  /** The account's picture instead of the initials. Off by default: a face is the person's choice. */
  usePhoto: boolean;
}

export const DEFAULT_SIGNATURE: SignatureSettings = {
  enabled: true,
  title: "",
  phone: "",
  mobile: "",
  usePhoto: false,
};

export interface SignaturePerson {
  name: string;
  email: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  photoUrl: string | null;
}

export type SignatureVariant = "full" | "compact";

/** A person as their signature shows them: the account's name and address, their Profile's part. */
export function signaturePerson(
  me: { name: string | null; email: string | null; image?: string | null },
  settings: SignatureSettings,
): SignaturePerson {
  return {
    name: me.name?.trim() || me.email || "",
    email: me.email,
    title: settings.title || null,
    phone: settings.phone || null,
    mobile: settings.mobile || null,
    photoUrl: settings.usePhoto ? cleanUrl(me.image ?? null) : null,
  };
}

/** What a document lays the person's text out with (`finish` in src/lib/email-deliver.ts). */
export interface EmailKit {
  brand: EmailBrand;
  /** The rendered signature, or "" when there is none to add. */
  signature: string;
  lang: BrandLang;
}

const MAX_FIELD = 120;

// ─── Cleaning what was typed ─────────────────────────────────────────────────

export function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A colour that can go in a style attribute: `#rrggbb`, or null. `#rgb` is widened. */
export function cleanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

/**
 * A link that can go in an href: http(s) only, with a host. "example.com" is read as https.
 * ⚠️ `javascript:`, `data:` and anything a URL parser does not accept are refused, not repaired.
 */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 300 || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The address as people read it: no scheme, no `www.`, no trailing slash. */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : "";
}

export function cleanBrandIdentity(input: unknown): BrandIdentity {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawSocials = (v.socials && typeof v.socials === "object" ? v.socials : {}) as Record<string, unknown>;
  const socials: Partial<Record<SocialKind, string>> = {};
  for (const kind of SOCIAL_KINDS) {
    const url = cleanUrl(rawSocials[kind]);
    if (url) socials[kind] = url;
  }
  return { color: cleanColor(v.color) ?? DEFAULT_BRAND_COLOR, website: cleanUrl(v.website), socials };
}

export function cleanSignatureSettings(input: unknown): SignatureSettings {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    enabled: v.enabled !== false,
    title: cleanText(v.title),
    phone: cleanText(v.phone),
    mobile: cleanText(v.mobile),
    usePhoto: v.usePhoto === true,
  };
}

// ─── Colour ──────────────────────────────────────────────────────────────────

function channel(hex: string, at: number): number {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const INK = "#141824";
const BODY = "#1f2430";
const MUTED = "#5d6475";
const FAINT = "#7a8192";
const LINE = "#e3e6ec";

/**
 * ⚠️ What reads on the brand colour: white, unless the colour is light. A workspace that picks
 * yellow gets dark text on its buttons rather than a button nobody can read.
 */
export function inkOn(color: string): string {
  return contrastRatio(color, "#ffffff") >= 3 ? "#ffffff" : INK;
}

/** The brand colour as text on white, or the body colour when it is too light to be read. */
export function brandText(color: string): string {
  return contrastRatio(color, "#ffffff") >= 3 ? color : BODY;
}

// ─── Texts ───────────────────────────────────────────────────────────────────

const TEXT = {
  it: { vat: "P.IVA", bankTransfer: "Bonifico bancario", payee: "Intestato a", reference: "causale" },
  en: { vat: "VAT", bankTransfer: "Bank transfer", payee: "Payee", reference: "reference" },
} as const;

const SOCIAL_LABEL: Record<SocialKind, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
};

const FONT = "'Segoe UI',-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";

function vatLine(brand: EmailBrand, lang: BrandLang): string {
  return brand.vatNumber ? `${TEXT[lang].vat} ${brand.vatNumber}` : "";
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** The logo, or the company's name in its colour when there is no logo to show. */
export function logoHtml(brand: EmailBrand, height: number): string {
  if (brand.logoUrl) {
    return `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" height="${height}" style="display:block;height:${height}px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none">`;
  }
  return `<span style="font-family:${FONT};font-size:${Math.round(height * 0.62)}px;font-weight:700;letter-spacing:-.01em;color:${brandText(brand.color)}">${esc(brand.name)}</span>`;
}

/** The main action: a link drawn as a button, in the brand colour. */
export function ctaButton(brand: EmailBrand, label: string, url: string): string {
  const href = cleanUrl(url);
  if (!href) return "";
  const ink = inkOn(brand.color);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 6px"><tr><td style="background:${brand.color};border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-weight:600;font-size:15px;line-height:1.2;color:${ink};text-decoration:none;border-radius:8px">${esc(label)}</a></td></tr></table>`;
}

export interface SummaryBox {
  /** The one figure that matters, big: the total, the amount due. */
  highlight?: { label: string; value: string };
  rows: [string, string][];
  /** `warning`: amber, for what is overdue — a reminder, not a demand. */
  tone?: "neutral" | "warning";
}

/** A document's figures, read before the text: what the customer opens the email to find. */
export function summaryBox({ highlight, rows, tone = "neutral" }: SummaryBox): string {
  const warn = tone === "warning";
  const bg = warn ? "#fff7ed" : "#f6f7fa";
  const border = warn ? "#fed7aa" : "#e8ebf1";
  const labelColor = warn ? "#9a3412" : MUTED;
  const top = highlight
    ? `<div style="font-size:12px;color:${labelColor};text-transform:uppercase;letter-spacing:.06em">${esc(highlight.label)}</div><div style="font-size:28px;font-weight:700;color:${INK};margin:2px 0 ${rows.length ? 12 : 0}px;letter-spacing:-.01em">${esc(highlight.value)}</div>`
    : "";
  const lines = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 12px 5px 0;color:${MUTED};vertical-align:top">${esc(k)}</td><td style="padding:5px 0;text-align:right;color:${INK};font-weight:500;vertical-align:top">${esc(v)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0;background:${bg};border:1px solid ${border};border-radius:12px;border-collapse:separate"><tr><td style="padding:18px 20px;font-family:${FONT}">${top}${lines ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:14px;line-height:1.4">${lines}</table>` : ""}</td></tr></table>`;
}

/** Where to pay, ready to copy: the IBAN in a box of its own, with the payee and the reference. */
export function ibanBox({
  iban,
  payee,
  reference,
  lang,
}: {
  iban: string;
  payee: string;
  reference: string;
  lang: BrandLang;
}): string {
  const tx = TEXT[lang];
  const grouped = iban
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
  if (!grouped) return "";
  const who = [payee ? `${tx.payee} ${payee}` : "", reference ? `${tx.reference}: ${reference}` : ""]
    .filter(Boolean)
    .join(" · ");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;border:1px dashed #cdd2dc;border-radius:12px;border-collapse:separate;background:#ffffff"><tr><td style="padding:14px 18px;font-family:${FONT}"><div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">${esc(tx.bankTransfer)}</div><div style="font-family:Consolas,'Courier New',monospace;font-size:16px;letter-spacing:.04em;color:${INK};margin-top:4px">${esc(grouped)}</div>${who ? `<div style="font-size:13px;color:${MUTED};margin-top:4px">${esc(who)}</div>` : ""}</td></tr></table>`;
}

// ─── The signature ───────────────────────────────────────────────────────────

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return (
    letters
      .map((w) => Array.from(w)[0] ?? "")
      .join("")
      .toUpperCase() || "·"
  );
}

function contactRow(letter: string, value: string, color: string, href?: string | null): string {
  const shown = href
    ? `<a href="${esc(href)}" style="color:${BODY};text-decoration:none">${esc(value)}</a>`
    : `<span style="color:${BODY}">${esc(value)}</span>`;
  return `<tr><td style="color:${color};font-weight:600;padding-right:8px;vertical-align:top">${letter}</td><td style="vertical-align:top">${shown}</td></tr>`;
}

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 6 ? `tel:${digits}` : null;
}

/**
 * The person's signature with the business's identity.
 *
 * - `full`: avatar, name, role · company, mobile / phone / email / website, then the logo, the
 *   social links and the company's legal line. For a first email, a quote.
 * - `compact`: name · role and one line of company, mobile, site. For a reply, a reminder.
 *
 * ⚠️ A `tel:`/`mailto:` link is written by hand here, never through `cleanUrl` (which allows
 * http(s) only, as everything a person types must be).
 */
export function signatureHtml({
  person,
  brand,
  variant,
  lang,
}: {
  person: SignaturePerson;
  brand: EmailBrand;
  variant: SignatureVariant;
  lang: BrandLang;
}): string {
  const color = brand.color;
  const accent = brandText(color);
  const role = [person.title, brand.name].filter(Boolean).join(" · ");
  const site = brand.website ? displayUrl(brand.website) : null;

  if (variant === "compact") {
    const second = [brand.name, person.mobile || person.phone || brand.phone]
      .filter(Boolean)
      .map((v) => esc(v))
      .join(" · ");
    const siteLink =
      brand.website && site
        ? `${second ? " · " : ""}<a href="${esc(brand.website)}" style="color:${accent};text-decoration:none">${esc(site)}</a>`
        : "";
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:${BODY};border-collapse:collapse;font-size:13px;line-height:1.6"><tr><td style="border-left:2px solid ${color};padding-left:12px"><div><strong style="color:${INK}">${esc(person.name)}</strong>${person.title ? ` <span style="color:${MUTED}">· ${esc(person.title)}</span>` : ""}</div><div style="color:${MUTED}">${second}${siteLink}</div></td></tr></table>`;
  }

  const photo = person.photoUrl ? cleanUrl(person.photoUrl) : null;
  const avatar = photo
    ? `<img src="${esc(photo)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:50%;border:0;object-fit:cover">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td width="64" height="64" style="width:64px;height:64px;border-radius:32px;background:${color};color:${inkOn(color)};font-family:${FONT};font-size:22px;font-weight:600;text-align:center;vertical-align:middle">${esc(initialsOf(person.name))}</td></tr></table>`;

  const rows = [
    person.mobile ? contactRow("M", person.mobile, accent, telHref(person.mobile)) : "",
    person.phone || brand.phone
      ? contactRow(
          "T",
          (person.phone || brand.phone) as string,
          accent,
          telHref((person.phone || brand.phone) as string),
        )
      : "",
    person.email ? contactRow("E", person.email, accent, `mailto:${person.email}`) : "",
    brand.website && site ? contactRow("W", site, accent, brand.website) : "",
  ].join("");

  const chips = brand.socials
    .map(
      (s) =>
        `<a href="${esc(s.url)}" style="display:inline-block;padding:4px 9px;border:1px solid #d7dbe3;border-radius:999px;color:#3b4252;text-decoration:none;margin-left:4px;font-size:12px">${SOCIAL_LABEL[s.kind]}</a>`,
    )
    .join("");
  const legal = [brand.name, brand.address, vatLine(brand, lang)].filter(Boolean).map(esc).join(" · ");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};color:${BODY};border-collapse:collapse;max-width:520px"><tr><td style="vertical-align:top;padding-right:16px;width:64px">${avatar}</td><td style="vertical-align:top;border-left:2px solid ${color};padding-left:16px"><div style="font-size:16px;font-weight:700;color:${INK}">${esc(person.name)}</div>${role ? `<div style="font-size:13px;color:${MUTED};margin-top:1px">${esc(role)}</div>` : ""}${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;font-size:13px;line-height:1.7">${rows}</table>` : ""}</td></tr><tr><td colspan="2" style="padding-top:14px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${LINE}"><tr><td style="padding-top:12px;vertical-align:middle">${logoHtml(brand, 26)}</td>${chips ? `<td style="padding-top:12px;text-align:right;vertical-align:middle">${chips}</td>` : ""}</tr>${legal ? `<tr><td colspan="2" style="padding-top:8px;font-size:11.5px;color:${FAINT};line-height:1.5">${legal}</td></tr>` : ""}</table></td></tr></table>`;
}

// ─── The frame ───────────────────────────────────────────────────────────────

/**
 * The frame of an email from the business: the brand bar, the logo and what the email is
 * ("Preventivo 2026/014"), the content, and the company's details underneath.
 *
 * `preheader` is the line a mail client shows beside the subject in the list; it is hidden in
 * the email itself.
 */
export function brandFrame({
  brand,
  lang,
  label,
  preheader,
  body,
}: {
  brand: EmailBrand;
  lang: BrandLang;
  label?: string | null;
  preheader?: string | null;
  body: string;
}): string {
  const hidden = preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div>`
    : "";
  const second = [brand.address, vatLine(brand, lang)].filter(Boolean).map(esc).join(" · ");
  const site =
    brand.website != null
      ? `<a href="${esc(brand.website)}" style="color:${FAINT};text-decoration:none">${esc(displayUrl(brand.website))}</a>`
      : "";
  const third = [site, brand.phone ? esc(brand.phone) : ""].filter(Boolean).join(" · ");
  const footer = [brand.name ? `<strong style="color:#3b4252">${esc(brand.name)}</strong>` : "", second, third]
    .filter(Boolean)
    .join("<br>");
  return `${hidden}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef0f4;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border-collapse:collapse;font-family:${FONT}"><tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td height="5" style="height:5px;line-height:5px;font-size:0;background:${brand.color}">&nbsp;</td></tr></table><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td style="padding:22px 32px 18px;vertical-align:middle">${logoHtml(brand, 30)}</td>${label ? `<td style="padding:22px 32px 18px;text-align:right;vertical-align:middle;font-size:12px;color:${FAINT};letter-spacing:.06em;text-transform:uppercase">${esc(label)}</td>` : ""}</tr></table><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td style="padding:6px 32px 32px;font-size:15px;line-height:1.6;color:${BODY};background:#ffffff">${body}</td></tr></table></td></tr>${footer ? `<tr><td style="padding:18px 8px 0;text-align:center;font-size:11.5px;line-height:1.6;color:${FAINT}">${footer}</td></tr>` : ""}</table></td></tr></table>`;
}

/**
 * The letterhead alone — the colour bar and the logo — for an email designed in the builder,
 * which brings its own layout (the "Letterhead" block, `{{intestazione}}`).
 */
export function brandHeaderHtml(brand: EmailBrand): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff"><tr><td height="5" style="height:5px;line-height:5px;font-size:0;background:${brand.color}">&nbsp;</td></tr><tr><td style="padding:22px 24px 14px">${logoHtml(brand, 30)}</td></tr></table>`;
}

/** Whether the author placed the signature themselves (`{{firma}}`): then it is not added again at the end. */
export function placesSignature(html: string): boolean {
  return /\{\{\s*(firma|signature)\s*\}\}/i.test(html);
}

/** A personal email: the person's text and their signature, no letterhead — it is a letter, not a circular. */
export function personalEmail(body: string, signature: string): string {
  return signature ? `${body}<div style="margin-top:24px">${signature}</div>` : body;
}

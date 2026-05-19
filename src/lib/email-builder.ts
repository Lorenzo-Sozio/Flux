/**
 * email-builder.ts — client-safe (no Drizzle)
 * Block type system + email-safe HTML compiler.
 *
 * Output rules:
 * - Table-based layout (Outlook compatible)
 * - All CSS inline (no external stylesheets)
 * - Media queries in <style> block for mobile
 * - Max width 600px
 * - No JavaScript
 */

// ─── Block types ──────────────────────────────────────────────────────────────

export type BlockType =
  | "heading"
  | "text"
  | "image"
  | "button"
  | "divider"
  | "spacer"
  | "two_column"
  | "footer"
  | "html";

export type TextAlign = "left" | "center" | "right";

export interface HeadingProps {
  text: string;
  level: "h1" | "h2" | "h3";
  align: TextAlign;
  color: string;
  backgroundColor: string;
  paddingTop: number;
  paddingBottom: number;
}

export interface TextProps {
  html: string;
  align: TextAlign;
  color: string;
  backgroundColor: string;
  fontSize: number;
  lineHeight: number;
  paddingTop: number;
  paddingBottom: number;
}

export interface ImageProps {
  src: string;
  alt: string;
  href: string;
  align: TextAlign;
  width: number; // 0–100 %
  backgroundColor: string;
  paddingTop: number;
  paddingBottom: number;
}

export interface ButtonProps {
  label: string;
  href: string;
  bgColor: string;
  textColor: string;
  align: TextAlign;
  borderRadius: number;
  fontSize: number;
  paddingH: number;
  paddingV: number;
  blockBg: string;
}

export interface DividerProps {
  color: string;
  thickness: number;
  paddingTop: number;
  paddingBottom: number;
  backgroundColor: string;
}

export interface SpacerProps {
  height: number;
  backgroundColor: string;
}

export interface TwoColumnProps {
  leftHtml: string;
  rightHtml: string;
  leftBg: string;
  rightBg: string;
  gap: number;
  backgroundColor: string;
}

export interface FooterProps {
  html: string;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  showUnsubscribe: boolean;
}

export interface HtmlProps {
  html: string;
  backgroundColor: string;
}

export type BlockProps =
  | HeadingProps
  | TextProps
  | ImageProps
  | ButtonProps
  | DividerProps
  | SpacerProps
  | TwoColumnProps
  | FooterProps
  | HtmlProps;

export interface Block {
  id: string;
  type: BlockType;
  props: BlockProps;
}

export interface EmailSettings {
  backgroundColor: string;
  contentWidth: number;
  fontFamily: string;
  previewText: string;
}

export interface EmailDesign {
  version: 1;
  settings: EmailSettings;
  blocks: Block[];
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: EmailSettings = {
  backgroundColor: "#f5f5f5",
  contentWidth: 600,
  fontFamily: "Arial, Helvetica, sans-serif",
  previewText: "",
};

export function defaultProps(type: BlockType): BlockProps {
  switch (type) {
    case "heading":
      return {
        text: "Your Heading Here",
        level: "h2",
        align: "center",
        color: "#111827",
        backgroundColor: "#ffffff",
        paddingTop: 24,
        paddingBottom: 16,
      } as HeadingProps;
    case "text":
      return {
        html: "<p>Write your message here. Use <strong>bold</strong> or <em>italic</em> to highlight key points.</p>",
        align: "left",
        color: "#374151",
        backgroundColor: "#ffffff",
        fontSize: 15,
        lineHeight: 1.6,
        paddingTop: 8,
        paddingBottom: 16,
      } as TextProps;
    case "image":
      return {
        src: "",
        alt: "",
        href: "",
        align: "center",
        width: 100,
        backgroundColor: "#ffffff",
        paddingTop: 0,
        paddingBottom: 0,
      } as ImageProps;
    case "button":
      return {
        label: "Click Here",
        href: "#",
        bgColor: "#2563eb",
        textColor: "#ffffff",
        align: "center",
        borderRadius: 6,
        fontSize: 15,
        paddingH: 28,
        paddingV: 13,
        blockBg: "#ffffff",
      } as ButtonProps;
    case "divider":
      return {
        color: "#e5e7eb",
        thickness: 1,
        paddingTop: 16,
        paddingBottom: 16,
        backgroundColor: "#ffffff",
      } as DividerProps;
    case "spacer":
      return {
        height: 24,
        backgroundColor: "#ffffff",
      } as SpacerProps;
    case "two_column":
      return {
        leftHtml: "<p style='margin:0;'>Left column content</p>",
        rightHtml: "<p style='margin:0;'>Right column content</p>",
        leftBg: "#ffffff",
        rightBg: "#f9fafb",
        gap: 2,
        backgroundColor: "#ffffff",
      } as TwoColumnProps;
    case "footer":
      return {
        html: "<p>© 2025 Company Name. All rights reserved.</p>",
        backgroundColor: "#f3f4f6",
        textColor: "#9ca3af",
        fontSize: 12,
        showUnsubscribe: true,
      } as FooterProps;
    case "html":
      return {
        html: "<!-- Custom HTML block -->",
        backgroundColor: "#ffffff",
      } as HtmlProps;
  }
}

export function newBlock(type: BlockType): Block {
  return {
    id: Math.random().toString(36).slice(2, 9),
    type,
    props: defaultProps(type),
  };
}

export function emptyDesign(): EmailDesign {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    blocks: [newBlock("heading"), newBlock("text"), newBlock("button"), newBlock("footer")],
  };
}

// ─── HTML Compiler ────────────────────────────────────────────────────────────

function esc(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fontSizeForLevel(level: "h1" | "h2" | "h3") {
  return level === "h1" ? 32 : level === "h2" ? 24 : 18;
}

function compileBlock(block: Block, fontFamily: string): string {
  const { type, props } = block;

  switch (type) {
    case "heading": {
      const p = props as HeadingProps;
      const fs = fontSizeForLevel(p.level);
      return `
<tr>
  <td style="background-color:${p.backgroundColor};padding:${p.paddingTop}px 24px ${p.paddingBottom}px 24px;text-align:${p.align};">
    <${p.level} style="margin:0;font-family:${fontFamily};font-size:${fs}px;font-weight:bold;line-height:1.3;color:${p.color};">${p.text}</${p.level}>
  </td>
</tr>`;
    }

    case "text": {
      const p = props as TextProps;
      return `
<tr>
  <td style="background-color:${p.backgroundColor};padding:${p.paddingTop}px 24px ${p.paddingBottom}px 24px;text-align:${p.align};font-family:${fontFamily};font-size:${p.fontSize}px;line-height:${p.lineHeight};color:${p.color};">
    ${p.html}
  </td>
</tr>`;
    }

    case "image": {
      const p = props as ImageProps;
      const imgW = Math.round((p.width / 100) * 600);
      const imgTag = `<img src="${esc(p.src)}" alt="${esc(p.alt)}" width="${imgW}" style="display:block;max-width:100%;height:auto;border:0;" />`;
      const inner = p.href
        ? `<a href="${esc(p.href)}" style="display:block;text-decoration:none;">${imgTag}</a>`
        : imgTag;
      return `
<tr>
  <td align="${p.align}" style="background-color:${p.backgroundColor};padding:${p.paddingTop}px 0 ${p.paddingBottom}px 0;">
    ${inner}
  </td>
</tr>`;
    }

    case "button": {
      const p = props as ButtonProps;
      return `
<tr>
  <td align="${p.align}" style="background-color:${p.blockBg};padding:16px 24px;">
    <table border="0" cellpadding="0" cellspacing="0" style="display:inline-table;">
      <tr>
        <td style="border-radius:${p.borderRadius}px;background-color:${p.bgColor};">
          <a href="${esc(p.href)}" style="display:inline-block;padding:${p.paddingV}px ${p.paddingH}px;font-family:${fontFamily};font-size:${p.fontSize}px;color:${p.textColor};text-decoration:none;border-radius:${p.borderRadius}px;font-weight:bold;">${esc(p.label)}</a>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
    }

    case "divider": {
      const p = props as DividerProps;
      return `
<tr>
  <td style="background-color:${p.backgroundColor};padding:${p.paddingTop}px 24px ${p.paddingBottom}px 24px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="border-top:${p.thickness}px solid ${p.color};font-size:0;line-height:0;">&nbsp;</td>
      </tr>
    </table>
  </td>
</tr>`;
    }

    case "spacer": {
      const p = props as SpacerProps;
      return `
<tr>
  <td style="background-color:${p.backgroundColor};height:${p.height}px;font-size:0;line-height:0;">&nbsp;</td>
</tr>`;
    }

    case "two_column": {
      const p = props as TwoColumnProps;
      const colW = Math.round((600 - p.gap) / 2);
      return `
<tr>
  <td style="background-color:${p.backgroundColor};padding:0;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td width="${colW}" valign="top" style="background-color:${p.leftBg};padding:16px;font-family:${fontFamily};font-size:14px;color:#374151;">
          ${p.leftHtml}
        </td>
        <td width="${p.gap}" style="font-size:0;line-height:0;">&nbsp;</td>
        <td width="${colW}" valign="top" style="background-color:${p.rightBg};padding:16px;font-family:${fontFamily};font-size:14px;color:#374151;">
          ${p.rightHtml}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
    }

    case "footer": {
      const p = props as FooterProps;
      const unsub = p.showUnsubscribe
        ? `<p style="margin:8px 0 0 0;"><a href="{{link_unsubscribe}}" style="color:${p.textColor};text-decoration:underline;">Unsubscribe</a></p>`
        : "";
      return `
<tr>
  <td style="background-color:${p.backgroundColor};padding:20px 24px;text-align:center;font-family:${fontFamily};font-size:${p.fontSize}px;color:${p.textColor};">
    ${p.html}
    ${unsub}
  </td>
</tr>`;
    }

    case "html": {
      const p = props as HtmlProps;
      return `
<tr>
  <td style="background-color:${p.backgroundColor};">
    ${p.html}
  </td>
</tr>`;
    }

    default:
      return "";
  }
}

export function compileToHtml(design: EmailDesign, subject = ""): string {
  const { settings, blocks } = design;
  const rows = blocks.map((b) => compileBlock(b, settings.fontFamily)).join("\n");

  // Calculate HTML size estimate
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${esc(subject)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      img { max-width: 100% !important; height: auto !important; }
      .stack-column { display: block !important; width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${settings.backgroundColor};word-spacing:normal;">
  ${settings.previewText ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${settings.backgroundColor};white-space:nowrap;">${esc(settings.previewText)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>` : ""}
  <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="background-color:${settings.backgroundColor};">
    <tr>
      <td align="center">
        <table class="email-container" border="0" cellpadding="0" cellspacing="0" role="presentation" width="${settings.contentWidth}" style="max-width:${settings.contentWidth}px;">
${rows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Size check ───────────────────────────────────────────────────────────────

export function estimateHtmlSize(html: string): { bytes: number; kb: number; warning: boolean } {
  const bytes = new TextEncoder().encode(html).length;
  const kb = Math.round((bytes / 1024) * 10) / 10;
  return { bytes, kb, warning: kb > 80 };
}

// ─── Variable extraction ──────────────────────────────────────────────────────

export const VARIABLES = [
  { key: "{{nome}}", label: "First Name" },
  { key: "{{cognome}}", label: "Last Name" },
  { key: "{{email}}", label: "Email" },
  { key: "{{azienda}}", label: "Company" },
  { key: "{{link_unsubscribe}}", label: "Unsubscribe Link" },
];

import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

/**
 * A few drawing primitives over pdf-lib, measured from the top of the page.
 *
 * ⚠️⚠️ **Why not @react-pdf/renderer.** Its layout engine is Yoga compiled to
 * WebAssembly and instantiated from bytes at runtime, which Cloudflare Workers
 * forbid ("Wasm code generation disallowed by embedder"). Every PDF answered 500
 * in production while rendering perfectly in Node and in the tests. pdf-lib is
 * plain JavaScript; the price is that line breaks and page breaks are ours.
 *
 * ⚠️ The standard fonts encode WinAnsi only. A character outside it — the
 * typographic minus, a narrow no-break space from Intl, an emoji in a product
 * name — makes pdf-lib throw, and the whole document fails. `clean` replaces them
 * before anything is measured or drawn.
 */

export const A4 = { width: 595.28, height: 841.89 };

export type Hex = `#${string}`;

function color(hex: Hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const REPLACEMENTS: Record<string, string> = {
  "−": "-",
  "‐": "-",
  "‑": "-",
  " ": " ",
  " ": " ",
  "​": "",
  "→": "->",
  "≤": "<=",
  "≥": ">=",
};

export interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: Hex;
}

export interface Canvas {
  doc: PDFDocument;
  page: PDFPage;
  /** Distance from the top of the current page, in points. */
  y: number;
  readonly left: number;
  readonly right: number;
  readonly contentWidth: number;
  readonly bottomLimit: number;
  clean(text: string): string;
  width(text: string, style?: TextStyle): number;
  wrap(text: string, maxWidth: number, style?: TextStyle): string[];
  text(text: string, x: number, y: number, style?: TextStyle & { align?: "left" | "right"; width?: number }): void;
  /** Wrapped lines from the cursor down; returns their height and moves the cursor. */
  paragraph(text: string, x: number, width: number, style?: TextStyle & { lineHeight?: number }): number;
  line(x1: number, y1: number, x2: number, y2: number, style?: { thickness?: number; color?: Hex }): void;
  rect(x: number, y: number, w: number, h: number, style: { fill?: Hex; border?: Hex; thickness?: number }): void;
  /** Starts a new page when `height` does not fit below the cursor. True when it did. */
  ensure(height: number): boolean;
  newPage(): void;
  save(footer: (c: Canvas, pageIndex: number, pageCount: number) => void): Promise<Uint8Array>;
}

export async function createCanvas(opts: {
  title: string;
  author?: string;
  subject?: string;
  language?: string;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  /** Drawn at the top of every page after the first: a repeated table header, say. */
  onNewPage?: (c: Canvas) => void;
}): Promise<Canvas> {
  const doc = await PDFDocument.create();
  doc.setTitle(opts.title);
  if (opts.author) doc.setAuthor(opts.author);
  if (opts.subject) doc.setSubject(opts.subject);
  if (opts.language) doc.setLanguage(opts.language);
  doc.setProducer("Flux CRM");
  doc.setCreator("Flux CRM");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  const font = (style?: TextStyle): PDFFont => (style?.bold ? bold : regular);

  const clean = (text: string) =>
    Array.from(text.normalize("NFC"))
      .map((ch) => {
        if (ch === "\n") return ch;
        if (supported.has(ch.codePointAt(0) ?? 0)) return ch;
        return REPLACEMENTS[ch] ?? "?";
      })
      .join("");

  const c: Canvas = {
    doc,
    page: doc.addPage([A4.width, A4.height]),
    y: opts.marginTop,
    left: opts.marginX,
    right: A4.width - opts.marginX,
    contentWidth: A4.width - opts.marginX * 2,
    bottomLimit: A4.height - opts.marginBottom,
    clean,

    width(text, style) {
      return font(style).widthOfTextAtSize(clean(text), style?.size ?? 9);
    },

    wrap(text, maxWidth, style) {
      const size = style?.size ?? 9;
      const f = font(style);
      const out: string[] = [];
      const fits = (s: string) => f.widthOfTextAtSize(s, size) <= maxWidth;
      /**
       * Starts a line with `word`. A word wider than the line is cut rather than
       * left to overflow the column, wherever in the paragraph it falls.
       */
      const startWith = (word: string): string => {
        if (fits(word)) return word;
        let piece = "";
        for (const ch of word) {
          if (!fits(piece + ch) && piece) {
            out.push(piece);
            piece = ch;
          } else piece += ch;
        }
        return piece;
      };
      for (const para of clean(text).split("\n")) {
        const words = para.split(/(\s+)/).filter((w) => w.length > 0);
        let current = "";
        for (const word of words) {
          if (current.trim() === "") {
            current = /^\s+$/.test(word) ? current + word : startWith(word);
          } else if (fits((current + word).trimEnd())) {
            current += word;
          } else if (/^\s+$/.test(word)) {
            // Trailing space that does not fit: the line ends here anyway.
            current += word;
          } else {
            out.push(current.trimEnd());
            current = startWith(word);
          }
        }
        out.push(current.trimEnd());
      }
      return out;
    },

    text(text, x, y, style) {
      const size = style?.size ?? 9;
      const f = font(style);
      const t = clean(text);
      const w = f.widthOfTextAtSize(t, size);
      const drawX = style?.align === "right" ? x + (style.width ?? 0) - w : x;
      c.page.drawText(t, {
        x: drawX,
        // The baseline sits about 80% of the font size below the top of the line box.
        y: A4.height - y - size * 0.8,
        size,
        font: f,
        color: color(style?.color ?? "#111827"),
      });
    },

    paragraph(text, x, width, style) {
      const size = style?.size ?? 9;
      const lh = style?.lineHeight ?? size * 1.35;
      const lines = c.wrap(text, width, style);
      let height = 0;
      for (const l of lines) {
        c.ensure(lh);
        c.text(l, x, c.y, style);
        c.y += lh;
        height += lh;
      }
      return height;
    },

    line(x1, y1, x2, y2, style) {
      c.page.drawLine({
        start: { x: x1, y: A4.height - y1 },
        end: { x: x2, y: A4.height - y2 },
        thickness: style?.thickness ?? 0.6,
        color: color(style?.color ?? "#e5e7eb"),
      });
    },

    rect(x, y, w, h, style) {
      c.page.drawRectangle({
        x,
        y: A4.height - y - h,
        width: w,
        height: h,
        color: style.fill ? color(style.fill) : undefined,
        borderColor: style.border ? color(style.border) : undefined,
        borderWidth: style.border ? (style.thickness ?? 0.8) : 0,
      });
    },

    ensure(height) {
      if (c.y + height <= c.bottomLimit) return false;
      c.newPage();
      return true;
    },

    newPage() {
      c.page = doc.addPage([A4.width, A4.height]);
      c.y = opts.marginTop;
      opts.onNewPage?.(c);
    },

    async save(footer) {
      const pages = doc.getPages();
      pages.forEach((p, i) => {
        c.page = p;
        footer(c, i, pages.length);
      });
      return doc.save();
    },
  };
  return c;
}

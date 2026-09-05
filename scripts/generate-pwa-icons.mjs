/**
 * The app icons, generated rather than committed as opaque binaries.
 *
 * A PWA needs the same mark at half a dozen sizes, and two of them are not
 * interchangeable: a *maskable* icon is cropped by the launcher to whatever
 * shape the device likes (circle, squircle, teardrop), so its artwork has to
 * survive losing the outer 20% on every side. Shipping the same square PNG for
 * both is the single most common way an installed icon ends up with its edges
 * shaved off.
 *
 * Run with: node scripts/generate-pwa-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/** oklch(0.488 0.243 264.376) — the light theme's --primary, as sRGB. */
const BRAND = "#1447e6";
const OUT = path.join(process.cwd(), "public", "icons");

/**
 * The Command glyph the sidebar already uses as the product mark, drawn on a
 * rounded square.
 *
 * `inset` is the fraction of the canvas left empty around the glyph. The
 * maskable variants use a much larger one: the launcher may crop anything
 * outside the middle 80%, so the mark has to sit well inside that.
 */
function markSvg({ size, inset, radius, background }) {
  const glyph = size * (1 - inset * 2);
  const offset = size * inset;
  // Stroke width is expressed in the glyph's own 24-unit coordinate system, so
  // it scales with the mark instead of thinning out at large sizes.
  const stroke = 2.1;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${background}"/>
  <g transform="translate(${offset} ${offset}) scale(${glyph / 24})">
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"
      fill="none" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const ICONS = [
  // Ordinary icons: the rounded square is part of the artwork.
  { file: "icon-192.png", size: 192, inset: 0.24, radius: 42, background: BRAND },
  { file: "icon-512.png", size: 512, inset: 0.24, radius: 112, background: BRAND },
  // Maskable: square edge to edge, glyph pulled well inside the safe zone.
  { file: "icon-maskable-192.png", size: 192, inset: 0.3, radius: 0, background: BRAND },
  { file: "icon-maskable-512.png", size: 512, inset: 0.3, radius: 0, background: BRAND },
  // iOS draws its own rounded corners and does not honour transparency, so this
  // one is a full-bleed square with the glyph inset for the corner radius.
  { file: "apple-touch-icon.png", size: 180, inset: 0.26, radius: 0, background: BRAND },
  { file: "icon-32.png", size: 32, inset: 0.16, radius: 6, background: BRAND },
];

await mkdir(OUT, { recursive: true });

for (const icon of ICONS) {
  const svg = markSvg(icon);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(OUT, icon.file), png);
  console.log(`${icon.file.padEnd(26)} ${icon.size}×${icon.size}  ${(png.length / 1024).toFixed(1)} kB`);
}

// The favicon, as an SVG the browser can scale by itself.
await writeFile(path.join(OUT, "icon.svg"), markSvg({ size: 64, inset: 0.18, radius: 14, background: BRAND }));
console.log("icon.svg                   vector");

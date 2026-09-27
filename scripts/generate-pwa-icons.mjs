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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  // ⚠️ The notification badge is a *mask*, not a picture. Android keeps only the
  // alpha channel and paints the result in the status bar's own colour, so a
  // brand-coloured square would arrive as a solid brand-coloured blob. Hence the
  // transparent background: what shows is the glyph's silhouette and nothing else.
  { file: "badge-72.png", size: 72, inset: 0.14, radius: 0, background: "none" },
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

// ── Launch screens for iOS ──────────────────────────────────────────────────
//
// ⚠️ iOS does not build a launch screen from the manifest, as Android does: an
// installed web app with no `apple-touch-startup-image` for the exact screen size
// opens on white, then flashes to the page. One image per device size, matched by
// media query in src/app/layout.tsx from the same list (src/config/splash-screens.json).
//
// The artwork is the first frame of the HTML splash (src/components/pwa/splash-screen.tsx)
// at its final state: same gradient, same glass mark in the same place, so the
// system's image hands over to the page without a jump. No text: the name would
// need a font the machine running this may not have, and the page's own splash
// writes it a moment later anyway.

const SPLASH_OUT = path.join(process.cwd(), "public", "splash");
const screens = JSON.parse(await readFile(path.join(process.cwd(), "src", "config", "splash-screens.json"), "utf8"));
const GLYPH = "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3";

function splashSvg({ width, height, ratio }) {
  const W = width * ratio;
  const H = height * ratio;
  const r = ratio;
  // Where the HTML splash puts the mark: its column (mark, gap, name) is centred,
  // so the mark sits half the gap-plus-name above the middle.
  const cx = W / 2;
  const cy = H / 2 - 29.5 * r;
  const mark = 104 * r;
  const glyph = 52 * r;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0" r="1" gradientTransform="translate(0.5 0) scale(1.2 0.75) translate(-0.5 0)">
      <stop offset="0" stop-color="#3a6bff"/><stop offset="0.38" stop-color="#1447e6"/>
      <stop offset="0.72" stop-color="#0c2fa8"/><stop offset="1" stop-color="#071d6e"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#8cafff" stop-opacity="0.55"/><stop offset="0.4" stop-color="#5a82ff" stop-opacity="0.18"/>
      <stop offset="0.7" stop-color="#5a82ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="1" stop-color="#fff" stop-opacity="0.07"/>
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="${24 * r}" stdDeviation="${22 * r}" flood-color="#020a32" flood-opacity="0.6"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${cx}" cy="${H / 2 - 20 * r}" r="${280 * r}" fill="url(#glow)"/>
  <rect x="${cx - mark / 2}" y="${cy - mark / 2}" width="${mark}" height="${mark}" rx="${28 * r}" fill="url(#glass)"
    stroke="#fff" stroke-opacity="0.3" stroke-width="${r}" filter="url(#shadow)"/>
  <g transform="translate(${cx - glyph / 2} ${cy - glyph / 2}) scale(${glyph / 24})">
    <path d="${GLYPH}" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

await mkdir(SPLASH_OUT, { recursive: true });
for (const screen of screens) {
  const file = `launch-${screen.width}x${screen.height}@${screen.ratio}x.png`;
  // A smooth gradient bands at 8 bits a channel unless dithered, and palette PNGs
  // band worst of all: full-colour PNG, maximum compression.
  const png = await sharp(Buffer.from(splashSvg(screen)))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(path.join(SPLASH_OUT, file), png);
  console.log(`splash/${file.padEnd(30)} ${(png.length / 1024).toFixed(0)} kB  ${screen.devices}`);
}

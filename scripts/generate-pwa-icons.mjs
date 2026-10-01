/**
 * The app icons and the iOS launch images, generated rather than committed as opaque binaries.
 *
 * Every one of them draws the Flux mark from scripts/brand/flux-mark.mjs — the woven looped
 * square in four tones — on the navy tile, so the icon on the home screen, the favicon, the
 * launch screen, the sidebar and the brand files in public/brand are one drawing.
 *
 * A PWA needs the same mark at half a dozen sizes, and two of them are not interchangeable: a
 * *maskable* icon is cropped by the launcher to whatever shape the device likes (circle,
 * squircle, teardrop), so its artwork has to survive losing the outer 20% on every side.
 * Shipping the same square PNG for both is the single most common way an installed icon ends up
 * with its edges shaved off.
 *
 * Run with: npm run generate:icons
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { markAt, squircle, TILE, TONES } from "./brand/flux-mark.mjs";

const OUT = path.join(process.cwd(), "public", "icons");

/**
 * The navy tile with the mark.
 *
 * - `shape`: `squircle` draws the tile's own outline (transparent corners); `square` fills the
 *   canvas edge to edge, for launchers and iOS, which cut their own shape.
 * - `inset`: the fraction of the canvas left empty around the mark. The maskable variants use a
 *   much larger one: the launcher may crop anything outside the middle 80%.
 * - `steps`: slices per ribbon; fewer make a lighter file, which only the favicon needs.
 */
function tileSvg({ size, inset, shape, steps = 240, points = 360 }) {
  const mark = size * (1 - inset * 2);
  const outline =
    shape === "squircle" ? `<path d="${squircle(size, 0, 0, 5, points)}"` : `<rect width="${size}" height="${size}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <title>Flux CRM</title>
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${TILE.from}"/><stop offset="1" stop-color="${TILE.to}"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.2" cy="0.1" r="0.8">
      <stop offset="0" stop-color="#fff" stop-opacity="0.1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${outline} fill="url(#tile)"/>
  ${outline} fill="url(#shine)"/>
  ${markAt({ x: size * inset, y: size * inset, size: mark, tones: TONES.dark, steps })}
</svg>`;
}

/**
 * ⚠️ The notification badge is a *mask*, not a picture. Android keeps only the alpha channel and
 * paints the result in the status bar's own colour, so a coloured tile would arrive as a solid
 * blob. Hence one colour on transparency: what shows is the mark's silhouette and nothing else.
 */
function badgeSvg(size, inset) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${markAt({ x: size * inset, y: size * inset, size: size * (1 - inset * 2), tones: "#ffffff" })}
</svg>`;
}

const ICONS = [
  // Ordinary icons: the tile's outline is part of the artwork.
  { file: "icon-192.png", svg: tileSvg({ size: 192, inset: 0.19, shape: "squircle" }) },
  { file: "icon-512.png", svg: tileSvg({ size: 512, inset: 0.19, shape: "squircle" }) },
  // Maskable: square edge to edge, the mark well inside the safe zone.
  { file: "icon-maskable-192.png", svg: tileSvg({ size: 192, inset: 0.27, shape: "square" }) },
  { file: "icon-maskable-512.png", svg: tileSvg({ size: 512, inset: 0.27, shape: "square" }) },
  // iOS draws its own rounded corners and does not honour transparency: full bleed.
  { file: "apple-touch-icon.png", svg: tileSvg({ size: 180, inset: 0.2, shape: "square" }) },
  { file: "icon-32.png", svg: tileSvg({ size: 32, inset: 0.12, shape: "squircle", steps: 90 }) },
  { file: "badge-72.png", svg: badgeSvg(72, 0.08) },
];

await mkdir(OUT, { recursive: true });

for (const icon of ICONS) {
  const size = Number(icon.svg.match(/width="(\d+)"/)[1]);
  const png = await sharp(Buffer.from(icon.svg), { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(OUT, icon.file), png);
  console.log(`${icon.file.padEnd(26)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

// The favicon and the mark the app shows (sidebar, sign-in pages): one vector, light enough to
// load on every first visit.
const favicon = tileSvg({ size: 64, inset: 0.17, shape: "squircle", steps: 56, points: 96 });
await writeFile(path.join(OUT, "icon.svg"), favicon);
console.log(`icon.svg                   vector  ${(favicon.length / 1024).toFixed(1)} kB`);

// ── Launch screens for iOS ──────────────────────────────────────────────────
//
// ⚠️ iOS does not build a launch screen from the manifest, as Android does: an
// installed web app with no `apple-touch-startup-image` for the exact screen size
// opens on white, then flashes to the page. One image per device size, matched by
// media query in src/app/layout.tsx from the same list (src/config/splash-screens.json).
//
// The artwork is the first frame of the HTML splash (src/components/pwa/splash-screen.tsx)
// at its final state: same navy, same tile in the same place, so the system's image hands
// over to the page without a jump. No text: the name would need a font the machine running
// this may not have, and the page's own splash writes it a moment later anyway.

const SPLASH_OUT = path.join(process.cwd(), "public", "splash");
const screens = JSON.parse(await readFile(path.join(process.cwd(), "src", "config", "splash-screens.json"), "utf8"));

function splashSvg({ width, height, ratio }) {
  const W = width * ratio;
  const H = height * ratio;
  const r = ratio;
  // Where the HTML splash puts the tile: its column (tile, gap, name) is centred, so the tile
  // sits half the gap-plus-name above the middle.
  const cx = W / 2;
  const cy = H / 2 - 29.5 * r;
  const tile = 104 * r;
  const x = cx - tile / 2;
  const y = cy - tile / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0" r="1" gradientTransform="translate(0.5 0) scale(1.2 0.75) translate(-0.5 0)">
      <stop offset="0" stop-color="#25386f"/><stop offset="0.38" stop-color="#15224d"/>
      <stop offset="0.72" stop-color="#0c1633"/><stop offset="1" stop-color="#070d22"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#7c7dff" stop-opacity="0.38"/><stop offset="0.4" stop-color="#4b86ff" stop-opacity="0.12"/>
      <stop offset="0.7" stop-color="#4b86ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${TILE.from}"/><stop offset="1" stop-color="${TILE.to}"/>
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="${24 * r}" stdDeviation="${22 * r}" flood-color="#01040f" flood-opacity="0.7"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${cx}" cy="${H / 2 - 20 * r}" r="${280 * r}" fill="url(#glow)"/>
  <path d="${squircle(tile, x, y)}" fill="url(#tile)" stroke="#fff" stroke-opacity="0.14" stroke-width="${r}" filter="url(#shadow)"/>
  ${markAt({ x: x + tile * 0.19, y: y + tile * 0.19, size: tile * 0.62, tones: TONES.dark })}
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

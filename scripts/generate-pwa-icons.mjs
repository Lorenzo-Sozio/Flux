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
 * The colour of the launch screen: the manifest's `background_color` (src/app/manifest.ts) and
 * the iOS launch images. ⚠️ The icons the system draws on it are filled with exactly this colour,
 * flat: Android's launch screen is that colour with the icon in the middle, and a tile of its own
 * gradient on it read as a square of another blue.
 */
const LAUNCH_BG = "#15224d";

/**
 * The navy tile with the mark.
 *
 * - `shape`: `squircle` draws the tile's own outline (transparent corners); `square` fills the
 *   canvas edge to edge, for launchers and iOS, which cut their own shape.
 * - `inset`: the fraction of the canvas left empty around the mark. The maskable variants use a
 *   much larger one: the launcher may crop anything outside the middle 80%.
 * - `steps`: slices per ribbon; fewer make a lighter file, which only the favicon needs.
 * - `flat`: the launch screen's colour, no gradient and no shine — the icons Android draws on its
 *   launch screen, so the tile disappears into it and only the mark shows.
 */
function tileSvg({ size, inset, shape, steps = 240, points = 360, flat = false }) {
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
  ${flat ? `${outline} fill="${LAUNCH_BG}"/>` : `${outline} fill="url(#tile)"/>\n  ${outline} fill="url(#shine)"/>`}
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
  // The manifest's icons, which Android also draws on its launch screen: flat, in its colour.
  { file: "icon-192.png", svg: tileSvg({ size: 192, inset: 0.19, shape: "squircle", flat: true }) },
  { file: "icon-512.png", svg: tileSvg({ size: 512, inset: 0.19, shape: "squircle", flat: true }) },
  // Maskable: square edge to edge, the mark well inside the safe zone.
  { file: "icon-maskable-192.png", svg: tileSvg({ size: 192, inset: 0.27, shape: "square", flat: true }) },
  { file: "icon-maskable-512.png", svg: tileSvg({ size: 512, inset: 0.27, shape: "square", flat: true }) },
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
// ⚠️ It is the only launch screen: the page draws none of its own, because a second one after the
// system's read as two splashes. The same as Android's: the mark alone on the launch colour.

const SPLASH_OUT = path.join(process.cwd(), "public", "splash");
const screens = JSON.parse(await readFile(path.join(process.cwd(), "src", "config", "splash-screens.json"), "utf8"));

function splashSvg({ width, height, ratio }) {
  const W = width * ratio;
  const H = height * ratio;
  const mark = 96 * ratio;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${LAUNCH_BG}"/>
  ${markAt({ x: (W - mark) / 2, y: (H - mark) / 2, size: mark, tones: TONES.dark })}
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

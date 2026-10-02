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

import { EXTENT, markAt, RIBBON_PATH, STROKE_WIDTH, squircle, TILE, TONES } from "./brand/flux-mark.mjs";

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
 * - `flat`: the launch screen's colour, no gradient and no shine — the maskable icons, which
 *   Android 12+ shows in a circle on its launch screen: the circle disappears into it.
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
 * The mark alone, on transparency: what Android draws in the middle of its launch screen. Any
 * background of its own — a tile, even one of the launch colour — showed as a square on it.
 */
function markSvg(size, inset) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <title>Flux CRM</title>
  ${markAt({ x: size * inset, y: size * inset, size: size * (1 - inset * 2), tones: TONES.dark })}
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
  // The tile, for notifications and wherever an icon needs its own ground.
  { file: "icon-192.png", svg: tileSvg({ size: 192, inset: 0.19, shape: "squircle" }) },
  { file: "icon-512.png", svg: tileSvg({ size: 512, inset: 0.19, shape: "squircle" }) },
  // The manifest's "any" icons, which Android draws on its launch screen: the mark alone.
  // ⚠️ New names, not the old ones redrawn: an installed app keeps the icons it fetched by URL,
  // and a changed file under the same name may never reach it.
  { file: "launch-mark-192.png", svg: markSvg(192, 0.12) },
  { file: "launch-mark-512.png", svg: markSvg(512, 0.12) },
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

// The finished mark for the opening animation (src/components/pwa/launch-animation.tsx), edge to
// edge — no inset, so the drawn line laid over it on the same square matches it exactly.
{
  const size = 512;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${markAt({ x: 0, y: 0, size, tones: TONES.dark })}
</svg>`;
  const png = await sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(OUT, "launch-final-512.png"), png);
  console.log(`launch-final-512.png       ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

// The line of the opening animation, as an animated WebP: the ribbons drawn one after the other,
// with the glow baked in.
//
// ⚠️⚠️ An image, not a CSS animation of `stroke-dashoffset`. That property is animated on the main
// thread, the one busy starting the app at that very moment: with it blocked the drawing froze
// (measured in Chrome: one picture in 1.4 s), and on a phone it stuttered. An animated image is
// advanced by the compositor, main thread busy or not (28 pictures in the same 1.4 s). Timing and
// easing are the ones the CSS had; the opening's other parts are opacity and transform only.
{
  const PX = 312; // 104 CSS px at 3x
  const FPS = 50;
  const LEAD = 0.2; // the line starts after this
  // [start, duration, easing] per ribbon, from the start of the drawing.
  const bezier = (x1, y1, x2, y2) => (t) => {
    // Solve x(u) = t by bisection, return y(u).
    const at = (a, b, u) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
  const linear = (t) => t;
  const RIBBONS = [
    [0, 0.34, bezier(0.55, 0, 1, 0.45)],
    [0.34, 0.26, linear],
    [0.6, 0.26, linear],
    [0.86, 0.34, bezier(0, 0.55, 0.45, 1)],
  ];
  const END = LEAD + 0.86 + 0.34;
  // The ribbon's length: a straight run, three quarters of a circle, a short run back.
  const [, a, v, R, , , , , x, , h] = RIBBON_PATH.match(/-?[\d.]+/g).map(Number);
  const LENGTH = Math.abs(v - a) + 1.5 * Math.PI * R + Math.abs(x - h);
  const lo = EXTENT.lo;
  const side = EXTENT.hi - EXTENT.lo;
  // The glow the CSS drew as drop-shadow(0 0 2.5px rgba(150,170,255,.75)), on the 24 grid.
  const glow = (2.5 / 104) * side;

  const frames = [];
  for (let f = 0; f * (1 / FPS) <= END + 1e-9; f++) {
    const t = f / FPS - LEAD;
    const paths = TONES.dark
      .map((tone, q) => {
        const [start, duration, ease] = RIBBONS[q];
        const k = Math.max(0, Math.min(1, (t - start) / duration));
        if (k <= 0) return "";
        const drawn = ease(k) * LENGTH;
        return `<path d="${RIBBON_PATH}" transform="rotate(${q * 90} 12 12)" stroke="${tone}" stroke-dasharray="${drawn.toFixed(4)} ${(2 * LENGTH).toFixed(4)}"/>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="${lo} ${lo} ${side} ${side}">
  <defs><filter id="g" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="${glow.toFixed(4)}" flood-color="rgb(150,170,255)" flood-opacity="0.75"/></filter></defs>
  <g fill="none" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" filter="url(#g)">${paths}</g>
</svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }
  const webp = await sharp(frames, { join: { animated: true } })
    // Once, ending on the drawn mark, which the finished mark then settles over.
    .webp({ loop: 1, delay: frames.map(() => Math.round(1000 / FPS)), quality: 82, alphaQuality: 90, effort: 6 })
    .toBuffer();
  await writeFile(path.join(OUT, "launch-draw.webp"), webp);
  console.log(`launch-draw.webp           ${PX}×${PX}  ${frames.length} frames  ${(webp.length / 1024).toFixed(1)} kB`);
}

// The same drawing for the page: the opening animation draws the ribbons as plain strokes and
// lays the finished mark over them, so it needs the geometry the icons were drawn from.
await writeFile(
  path.join(process.cwd(), "src", "components", "pwa", "launch-mark.generated.ts"),
  `// Generated by scripts/generate-pwa-icons.mjs from scripts/brand/flux-mark.mjs. Do not edit.

/** One ribbon on the 24 grid; the other three are it turned by 90°, 180°, 270° about (12, 12). */
export const RIBBON_PATH = "${RIBBON_PATH}";
export const STROKE_WIDTH = ${STROKE_WIDTH};
/** The square the mark fills on the 24 grid, stroke included: the drawing's viewBox. */
export const MARK_BOX = { lo: ${+EXTENT.lo.toFixed(4)}, size: ${+(EXTENT.hi - EXTENT.lo).toFixed(4)} };
/** The ribbons' tones on the navy, in the order they are drawn. */
export const TONES = [${TONES.dark.map((t) => `"${t}"`).join(", ")}] as const;
/** The launch screen's colour: the manifest's background_color and the iOS launch images. */
export const LAUNCH_BG = "${LAUNCH_BG}";
`,
);
console.log("src/components/pwa/launch-mark.generated.ts");

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
// ⚠️ Plain, with no mark: on iOS the installed app's opening animation draws the mark from nothing
// (src/components/pwa/launch-animation.tsx), and a mark already here would read as a second splash
// — the logo, then an empty screen, then the logo drawn.

const SPLASH_OUT = path.join(process.cwd(), "public", "splash");
const screens = JSON.parse(await readFile(path.join(process.cwd(), "src", "config", "splash-screens.json"), "utf8"));

function splashSvg({ width, height, ratio }) {
  const W = width * ratio;
  const H = height * ratio;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${LAUNCH_BG}"/>
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

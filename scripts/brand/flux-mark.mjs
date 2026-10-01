/**
 * The Flux mark: the looped square (⌘) drawn as one closed strand in four ribbons that turn about
 * the centre, each one colour (its bar and its loop), the colour changing smoothly where one
 * ribbon hands over to the next. Each ribbon starts on top of the one before, so the strand reads
 * as woven.
 *
 * The source of every icon and of the brand files: scripts/generate-pwa-icons.mjs builds the app
 * icons, the iOS launch images and the mark the app shows from here.
 *
 * ⚠️ SVG has no gradient that follows a curve, so the strand is drawn as fine slices: each one the
 * exact outline of the stroke between two points (offset along the true normals), reaching back
 * over the slice before it by more than its own length — its edge then lies on colour, never on
 * the background, and no hairline shows at any size. Fewer `steps` make a lighter file.
 *
 * Plain JavaScript, no dependencies.
 */

/** The four tones, turning clockwise: on light backgrounds, and brighter on dark ones. */
export const TONES = {
  light: ["#22b8f0", "#1d63ed", "#3730d4", "#7040ec"],
  dark: ["#5fd6ff", "#4b86ff", "#6b6bff", "#a07cff"],
};

/** The navy of the app tile, top-left to bottom-right. */
export const TILE = { from: "#1b2a55", to: "#0a1128" };

// Geometry on a 24-unit grid centred on 12.
const H = 3.2; // half the side of the centre square
const R = 3.6; // loop radius
const W = 2.5; // ribbon width
const a = 12 - H;
const b = 12 + H;

/** Where the drawing reaches, stroke included: the mark's square on the 24 grid. */
export const EXTENT = { lo: a - 2 * R - W / 2, hi: b + 2 * R + W / 2 };

// ── Colour, blended in OKLab so a blend between two tones stays bright ──────

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklab(hex) {
  const [r, g, bl] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToHex([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// ── One ribbon as a curve ───────────────────────────────────────────────────

/**
 * Down from the top crossing (b, a), round the bottom-right loop (270°, centre (b+R, b+R)), back to
 * the crossing (b, b). Point and unit tangent at distance `s`; before the start the strand is the
 * previous ribbon's last stretch, which is straight and continues this one's first.
 */
const L1 = b + R - a;
const L2 = 1.5 * Math.PI * R;
const TOTAL = L1 + L2 + R;
function at(s) {
  if (s <= L1) return { x: b, y: a + s, tx: 0, ty: 1 };
  if (s <= L1 + L2) {
    const th = Math.PI - (s - L1) / R; // left → bottom → right → top, counter-clockwise on screen
    return { x: b + R + R * Math.cos(th), y: b + R + R * Math.sin(th), tx: Math.sin(th), ty: -Math.cos(th) };
  }
  return { x: b + R - (s - L1 - L2), y: b, tx: -1, ty: 0 };
}

/** The point turned by `quarter` × 90° clockwise about the centre. */
function turn(p, quarter) {
  let { x, y, tx, ty } = p;
  for (let q = 0; q < quarter; q++) {
    [x, y] = [24 - y, x];
    [tx, ty] = [-ty, tx];
  }
  return { x, y, tx, ty };
}

/**
 * The colour along the strand. A ribbon is one tone from the start of its bar to the end of its
 * loop; the blend to the next tone starts as the strand leaves the loop and runs past the crossing
 * into the next bar, so the loops stay one colour and the strand on top of a crossing is already
 * mostly its new colour.
 */
function colouring(tones) {
  const labs = tones.map(hexToOklab);
  const mix = (i, j, e) => oklabToHex(labs[i].map((v, k) => v + (labs[j][k] - v) * e));
  const ease = (u) => u * u * (3 - 2 * u);
  const from = L1 + L2 + 0.1;
  const past = 2.2;
  const span = TOTAL - from + past;
  return (q, s) => {
    if (s < past) return mix((q + 3) % 4, q, ease((TOTAL - from + s) / span));
    if (s <= from) return mix(q, q, 0);
    return mix(q, (q + 1) % 4, ease((s - from) / span));
  };
}

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();

/**
 * The mark's drawing on the 24 grid: SVG elements, no wrapper. `tones` is a palette from TONES, or
 * one colour for a silhouette (the notification badge, a stamp).
 */
export function markElements({ tones = TONES.light, steps = 240 } = {}) {
  const solid = typeof tones === "string";
  const colourAt = solid ? () => tones : colouring(tones);
  const half = W / 2;
  const overlap = (TOTAL / steps) * 2.5;
  const slice = (quarter, s0, s1) => {
    const p = turn(at(s0 - overlap), quarter);
    const q = turn(at(s1), quarter);
    const pts = [
      [p.x - p.ty * half, p.y + p.tx * half],
      [q.x - q.ty * half, q.y + q.tx * half],
      [q.x + q.ty * half, q.y - q.tx * half],
      [p.x + p.ty * half, p.y - p.tx * half],
    ];
    return `<path d="M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z" fill="${colourAt(quarter, (s0 + s1) / 2)}"/>`;
  };
  const ribbon = (quarter, upTo = TOTAL) => {
    const out = [];
    for (let i = 0; i < steps; i++) {
      const s0 = (i / steps) * TOTAL;
      if (s0 >= upTo) break;
      out.push(slice(quarter, s0, ((i + 1) / steps) * TOTAL));
    }
    return out.join("");
  };
  if (solid) {
    // One colour: the overlaps cannot show, so each ribbon is one stroke.
    const d = `M${b} ${a}V${b + R}A${R} ${R} 0 1 0 ${b + R} ${b}H${b}`;
    return [0, 90, 180, 270]
      .map(
        (deg) =>
          `<path d="${d}" transform="rotate(${deg} 12 12)" fill="none" stroke="${tones}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join("");
  }
  // The first ribbon's start again, over the fourth, as far as the far edge of the strand it crosses.
  return [0, 1, 2, 3].map((q) => ribbon(q)).join("") + ribbon(0, W * 0.75);
}

/** The mark fitted into a `size` square whose top-left corner is (x, y), as a `<g>`. */
export function markAt({ x, y, size, tones, steps }) {
  const k = size / (EXTENT.hi - EXTENT.lo);
  return `<g transform="translate(${fmt(x - EXTENT.lo * k)} ${fmt(y - EXTENT.lo * k)}) scale(${fmt(k)})">${markElements({ tones, steps })}</g>`;
}

/**
 * A superellipse ("squircle") path filling a `size` square at (x, y): the tile's outline. `points`
 * can be fewer for a small icon, whose file is what it weighs.
 */
export function squircle(size, x = 0, y = 0, n = 5, points = 360) {
  const half = size / 2;
  const pts = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([
      x + half + half * Math.sign(c) * Math.abs(c) ** (2 / n),
      y + half + half * Math.sign(s) * Math.abs(s) ** (2 / n),
    ]);
  }
  return `M${pts.map(([px, py]) => `${fmt(px)} ${fmt(py)}`).join("L")}Z`;
}

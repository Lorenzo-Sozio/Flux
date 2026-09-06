/**
 * Opens the app in a phone-shaped browser and reports what does not fit.
 *
 * The static audit (scripts/mobile-audit.mjs) reads classes; this one measures
 * the rendered page. It answers the questions reading cannot:
 *
 *   • does the document scroll sideways, and if so **which element** is doing it;
 *   • is anything narrower than 44px that a finger has to hit;
 *   • what does the screen actually look like.
 *
 * No dependencies. Chrome speaks the DevTools Protocol over a WebSocket, and
 * Node has had a WebSocket client built in since 22 — so this needs a browser
 * that is already installed and nothing else.
 *
 *   node scripts/mobile-shots.mjs                  # measure every route
 *   node scripts/mobile-shots.mjs --shots          # and write PNGs
 *   node scripts/mobile-shots.mjs --device=se      # 375×667 instead of 390×844
 *
 * Reads BASE_URL, LOGIN_EMAIL and LOGIN_PASSWORD from the environment. Without
 * credentials it measures only the pages that need none.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const EMAIL = process.env.LOGIN_EMAIL ?? "";
const PASSWORD = process.env.LOGIN_PASSWORD ?? "";
const WANT_SHOTS = process.argv.includes("--shots");
const OUT = process.env.SHOT_DIR ?? "mobile-shots";

/** The two phones worth checking: the common one, and the smallest still sold. */
const DEVICES = {
  iphone12: { width: 390, height: 844, dpr: 3 },
  se: { width: 375, height: 667, dpr: 2 },
  small: { width: 320, height: 568, dpr: 2 },
};
const deviceArg = process.argv.find((a) => a.startsWith("--device="))?.split("=")[1] ?? "iphone12";
const DEVICE = DEVICES[deviceArg] ?? DEVICES.iphone12;

const ROUTES = [
  { path: "/auth/v1/login", auth: false },
  { path: "/dashboard/crm", auth: true },
  { path: "/dashboard/contacts", auth: true },
  { path: "/dashboard/companies", auth: true },
  { path: "/dashboard/leads", auth: true },
  { path: "/dashboard/pipeline", auth: true },
  { path: "/dashboard/calendar", auth: true },
  { path: "/dashboard/tasks", auth: true },
  { path: "/dashboard/sales/quotes", auth: true },
  { path: "/dashboard/sales/orders", auth: true },
  { path: "/dashboard/sales/orders/new", auth: true },
  { path: "/dashboard/sales/products", auth: true },
  { path: "/dashboard/sales/finance", auth: true },
  { path: "/dashboard/support/tickets", auth: true },
  { path: "/dashboard/support", auth: true },
  { path: "/dashboard/marketing/campaigns", auth: true },
  { path: "/dashboard/automation", auth: true },
  { path: "/dashboard/reports", auth: true },
  { path: "/dashboard/users", auth: true },
  { path: "/dashboard/settings", auth: true },
  { path: "/dashboard/help", auth: true },
];

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("mobile-shots: no Chrome or Edge found.");
  process.exit(2);
}

// ── A very small DevTools Protocol client ───────────────────────────────────

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;

    socket.addEventListener("open", () =>
      resolve({
        send(method, params = {}, sessionId) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params, sessionId }));
          return new Promise((ok, no) => pending.set(id, { ok, no }));
        },
        close: () => socket.close(),
      }),
    );
    socket.addEventListener("error", reject);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.no(new Error(message.error.message));
      else waiter.ok(message.result);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browserEndpoint(port) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome never opened its debugging port");
}

// ── What we ask the page ────────────────────────────────────────────────────

/**
 * ⚠️ Finds the element **causing** the sideways scroll, not merely that there is
 * one. "The page scrolls horizontally" is a symptom anybody can see; the useful
 * answer is which box sticks out and by how much.
 *
 * An element inside something that scrolls sideways on purpose — a kanban, a
 * table — is not the culprit, so those are walked past.
 */
const OVERFLOW_PROBE = `(() => {
  const docWidth = document.documentElement.clientWidth;
  const guilty = [];
  const scrollers = new Set();
  for (const el of document.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (style.overflowX === "auto" || style.overflowX === "scroll") scrollers.add(el);
  }
  const insideScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (scrollers.has(p)) return true;
    return false;
  };
  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const over = Math.round(rect.right - docWidth);
    if (over <= 1) continue;
    if (insideScroller(el)) continue;
    guilty.push({
      over,
      width: Math.round(rect.width),
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute("class") ?? "").slice(0, 110),
      text: (el.textContent ?? "").trim().slice(0, 40),
    });
  }
  // Only the outermost offenders: a parent that sticks out drags its children
  // with it, and listing all of them buries the one line that matters.
  const outermost = guilty.filter((g, i) =>
    !guilty.some((other, j) => j !== i && other.over >= g.over && other.width > g.width));

  // ⚠️ The box is not the target. A 16px checkbox with an ::after inset of
  // -14px is a 44px target, and measuring the element alone reports it as a
  // failure — which is a checker crying wolf about the fix for the thing it
  // was asked to find.
  const hitArea = (el) => {
    const rect = el.getBoundingClientRect();
    const after = getComputedStyle(el, "::after");
    if (after.content === "none" || after.position !== "absolute") return rect;
    const grow = (v) => (v.endsWith("px") ? -parseFloat(v) : 0);
    return {
      width: rect.width + grow(after.left) + grow(after.right),
      height: rect.height + grow(after.top) + grow(after.bottom),
    };
  };

  const small = [];
  for (const el of document.querySelectorAll("button, a[href], [role=button], input, select")) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const rect = hitArea(el);
    if (rect.height >= 40 || rect.width >= 40) continue;
    small.push({
      size: Math.round(rect.width) + "x" + Math.round(rect.height),
      tag: el.tagName.toLowerCase(),
      label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30),
    });
  }

  return JSON.stringify({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: docWidth,
    guilty: outermost.sort((a, b) => b.over - a.over).slice(0, 6),
    small: small.slice(0, 8),
    title: document.title,
  });
})()`;

// ── Run ─────────────────────────────────────────────────────────────────────

const port = 9333;
const profile = join(process.env.TEMP ?? "/tmp", `flux-shots-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-sandbox",
  ],
  { stdio: "ignore" },
);

let failures = 0;
try {
  const browser = await connect(await browserEndpoint(port));
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => browser.send(method, params, sessionId);

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: DEVICE.width,
    height: DEVICE.height,
    deviceScaleFactor: DEVICE.dpr,
    mobile: true,
  });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  const goto = async (url) => {
    await call("Page.navigate", { url });
    await sleep(2200);
  };
  const evaluate = async (expression) => {
    const { result } = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return result.value;
  };

  let signedIn = false;
  if (EMAIL && PASSWORD) {
    await goto(`${BASE}/auth/v1/login`);
    await evaluate(`(() => {
      const set = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const email = document.querySelector('input[type=email], input[name=email], #login-email');
      const password = document.querySelector('input[type=password]');
      if (email) set(email, ${JSON.stringify(EMAIL)});
      if (password) set(password, ${JSON.stringify(PASSWORD)});
      const form = (password ?? email)?.closest("form");
      form?.requestSubmit ? form.requestSubmit() : form?.submit();
      return Boolean(form);
    })()`);
    await sleep(5000);
    signedIn = !(await evaluate("location.pathname")).includes("/auth/");
    console.log(signedIn ? "signed in\n" : "could not sign in — authenticated routes skipped\n");
  }

  if (WANT_SHOTS) mkdirSync(OUT, { recursive: true });

  for (const route of ROUTES) {
    if (route.auth && !signedIn) continue;
    await goto(BASE + route.path);
    const report = JSON.parse(await evaluate(OVERFLOW_PROBE));

    const overflow = report.scrollWidth - report.clientWidth;
    const bad = overflow > 1 || report.small.length > 0;
    if (bad) failures++;
    console.log(`${bad ? "✗" : "✓"} ${route.path}`);
    if (overflow > 1) {
      console.log(`    scrolls ${overflow}px sideways (${report.scrollWidth} in ${report.clientWidth})`);
      for (const g of report.guilty) {
        console.log(`      +${g.over}px  <${g.tag}> ${g.text ? `"${g.text}" ` : ""}${g.cls}`);
      }
    }
    for (const s of report.small) console.log(`    ${s.size} target  <${s.tag}> ${s.label}`);

    if (WANT_SHOTS) {
      const { data } = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(
        join(OUT, `${route.path.replace(/\W+/g, "-").replace(/^-|-$/g, "")}.png`),
        Buffer.from(data, "base64"),
      );
    }
  }

  console.log(
    `\n${failures === 0 ? "nothing sticks out" : `${failures} route(s) with something to fix`} — ${DEVICE.width}x${DEVICE.height}\n`,
  );
  browser.close();
} finally {
  chrome.kill();
}

process.exit(failures === 0 ? 0 : 1);

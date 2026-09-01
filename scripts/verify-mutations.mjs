/**
 * Mutation check: do the tests know how to fail?
 *
 *   node scripts/verify-mutations.mjs scripts/mutations/<name>.json
 *
 * A guarantee that is claimed but not exercised by a test does not exist. A green suite
 * proves the code passes the tests; it does not prove the tests would notice if the code
 * were wrong. This script breaks one line at a time, on purpose, and requires the suite to
 * go red for each break. A mutation that survives is a test that was decorating.
 *
 * Each entry: { file, description, find, replace }. `find` must appear exactly once, and a
 * mutation that changes nothing is reported as an error rather than passed off as a
 * survivor — an edit that does not edit is the easiest way to fake this whole exercise.
 *
 * The original files are always restored, including when the run is interrupted.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_DIR = "scripts/mutations";

// With no argument it runs every spec, so "did the tests keep their teeth?" is one command
// and not a list of paths somebody has to remember to keep in sync.
const specPaths = process.argv[2]
  ? [process.argv[2]]
  : readdirSync(DEFAULT_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(DEFAULT_DIR, f));

const spec = specPaths.flatMap((p) => JSON.parse(readFileSync(p, "utf8")));
const originals = new Map();

function restore() {
  for (const [file, content] of originals) writeFileSync(file, content);
}

process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

function suiteIsGreen() {
  try {
    execFileSync("npx", ["vitest", "run", "--reporter=dot"], { stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

let survived = 0;
let broken = 0;

try {
  if (!suiteIsGreen()) {
    console.error("the suite is already red before any mutation: fix that first");
    process.exit(2);
  }

  for (const m of spec) {
    const before = readFileSync(m.file, "utf8");
    if (!originals.has(m.file)) originals.set(m.file, before);

    const occurrences = before.split(m.find).length - 1;
    if (occurrences !== 1) {
      console.log(`  BROKEN      ${m.description}`);
      console.log(`              "find" appears ${occurrences} times in ${m.file}, expected 1`);
      broken += 1;
      continue;
    }

    const after = before.replace(m.find, m.replace);
    if (after === before) {
      console.log(`  BROKEN      ${m.description}`);
      console.log("              the mutation changes nothing, so it proves nothing");
      broken += 1;
      continue;
    }

    writeFileSync(m.file, after);
    const green = suiteIsGreen();
    writeFileSync(m.file, before);

    if (green) {
      console.log(`  SURVIVED    ${m.description}`);
      survived += 1;
    } else {
      console.log(`  caught      ${m.description}`);
    }
  }
} finally {
  restore();
}

const total = spec.length;
if (survived === 0 && broken === 0) {
  console.log(`\n${total}/${total} mutations caught, from ${specPaths.length} spec file(s).`);
  process.exit(0);
}
console.log(`\n${survived} survived, ${broken} broken, out of ${total}.`);
process.exit(1);

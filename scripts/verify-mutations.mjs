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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const originals = new Map();

function restore() {
  for (const [file, content] of originals) writeFileSync(file, content);
  rmSync(IN_FLIGHT, { force: true });
}

// ⚠️ SIGINT is not the only way this stops. A harness timeout sends SIGTERM, and
// an unexpected throw before the `finally` would leave a file mutated with
// nothing to notice it — which happened: a run killed at ten minutes left one
// mutation in the source, and the next run reported "already red before any
// mutation" without saying why.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}
process.on("uncaughtException", (err) => {
  restore();
  console.error(err);
  process.exit(1);
});

/**
 * Where the originals are kept while a run is in flight.
 *
 * ⚠️ Restoring in a `finally` and on a signal covers most ways a run ends, and
 * not all of them: a harness that kills the process, a machine that loses power,
 * a `SIGKILL`. Any of those leaves a mutated file behind, and a mutated file is
 * invisible — the next run reports "already red" and sends the reader looking at
 * their own recent work, or worse stays green because nothing covers the line
 * that is still broken.
 *
 * The originals are written here before the first mutation and deleted on a clean
 * exit, so the file existing at startup *is* the evidence that a run was
 * interrupted, and it carries everything needed to undo it.
 */
const IN_FLIGHT = "scripts/mutations/.in-flight.json";

/** Puts back whatever an interrupted run left mutated, and says what it did. */
function recoverFromInterruptedRun() {
  if (!existsSync(IN_FLIGHT)) return;

  let saved;
  try {
    saved = JSON.parse(readFileSync(IN_FLIGHT, "utf8"));
  } catch {
    console.error(`${IN_FLIGHT} is unreadable. Check your working tree against git before trusting a run.`);
    process.exit(2);
  }

  const files = Object.keys(saved);
  for (const file of files) writeFileSync(file, saved[file]);
  rmSync(IN_FLIGHT, { force: true });

  console.error("a previous run was interrupted and left files mutated. Restored:");
  for (const file of files) console.error(`  ${file}`);
  console.error("");
}

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
  // Before anything else: a file left mutated by an interrupted run is the
  // likeliest reason the suite is red, and "already red" on its own sends the
  // reader looking at their own work instead.
  recoverFromInterruptedRun();

  if (!suiteIsGreen()) {
    console.error("the suite is already red before any mutation: fix that first");
    process.exit(2);
  }

  for (const m of spec) {
    const onDisk = readFileSync(m.file, "utf8");
    if (!originals.has(m.file)) {
      originals.set(m.file, onDisk);
      // Written before the file is touched, so the record is never behind reality.
      writeFileSync(IN_FLIGHT, JSON.stringify(Object.fromEntries(originals), null, 2));
    }

    // Match against LF regardless of what git checked out.
    //
    // A spec writes its pattern with escaped newlines, while the working copy may
    // hold CRLF -- and does, on Windows, for anything git has normalised. Every
    // multi-line pattern then matched zero times and the run reported BROKEN, which
    // reads exactly like "this guard is gone" and is nothing of the sort.
    //
    // The file is written back with LF; the formatter and git settle the endings.
    const before = onDisk.split(CRLF).join(LF);

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

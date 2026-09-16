/**
 * Keeps the screens translated, not only the files.
 *
 * messages.test.ts checks that Italian and English carry the same keys. That was
 * true for months while the quote detail page, the automation builder and half the
 * dialogs rendered English typed straight into the JSX, which no file comparison
 * can see. These run the two readers in scripts/: one lists text a person reads
 * that does not go through next-intl, the other lists `t("key")` calls whose key
 * exists in neither file and would print the key path on screen.
 *
 * A value that is the same in both languages ("Acme S.r.l." as a placeholder) is
 * marked `i18n-ignore` where it is written.
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function run(script: string): { code: number; output: string } {
  try {
    return { code: 0, output: execFileSync(process.execPath, [script], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { code: err.status, output: err.stdout };
  }
}

describe("translated screens", () => {
  it("have no text typed straight into a component", () => {
    const { code, output } = run("scripts/i18n-audit.mjs");
    expect(code, output).toBe(0);
  });

  it("ask only for keys that exist in both languages", () => {
    const { code, output } = run("scripts/i18n-keys-check.mjs");
    expect(code, output).toBe(0);
  });
});

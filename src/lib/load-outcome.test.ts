/**
 * ⚠️ A figure that could not be loaded is not a zero (I14): a failure is its own outcome, a plan
 * without the module is not a failure, and Next's redirects travel on.
 */
import { describe, expect, it, vi } from "vitest";

import { failed, loadedValue, loadOutcome } from "./load-outcome";

describe("⚠️ loading a figure", () => {
  it("a value is a value", async () => {
    const o = await loadOutcome("x", async () => 0);
    expect(o).toEqual({ ok: true, value: 0 });
    expect(loadedValue(o)).toBe(0);
    expect(failed(o)).toBe(false);
  });

  it("⚠️ a failure is said to be one, and logged — never turned into zero", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const o = await loadOutcome("x", async () => {
      throw new Error("connection terminated");
    });
    expect(o).toEqual({ ok: false, reason: "error" });
    expect(failed(o)).toBe(true);
    expect(loadedValue(o)).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("a plan without the module is not a failure: the card is simply absent", async () => {
    const plan = Object.assign(new Error("module unavailable"), { name: "EntitlementError" });
    const o = await loadOutcome("x", async () => {
      throw plan;
    });
    expect(o).toEqual({ ok: false, reason: "plan" });
    expect(failed(o)).toBe(false);
  });

  it("⚠️ Next's redirect travels on instead of being caught as a failure", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    await expect(
      loadOutcome("x", async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
  });
});

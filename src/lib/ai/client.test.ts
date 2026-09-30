/**
 * The routing of tasks to providers and models, and the JSON check on structured answers.
 *
 * ⚠️ The model is configuration: these hold the rules that decide which model answers which
 * task, because a wrong one here is silent — the copilot still answers, from the wrong model,
 * billed at the wrong price.
 */
import { describe, expect, it } from "vitest";

import { aiAvailable, aiGenerate, aiGenerateJson } from "./client";
import { aiRoute } from "./config";

const KEY = { GEMINI_API_KEY: "k-123" };

describe("aiRoute", () => {
  it("is off when nothing is configured, so the copilot is simply not offered", () => {
    expect(aiRoute("summary", {})).toEqual({ state: "off" });
    expect(aiAvailable("summary", {})).toBe(false);
  });

  it("uses Gemini 2.5 Flash-Lite when only the key is set", () => {
    const route = aiRoute("summary", KEY);
    expect(route.state === "on" && [route.provider.id, route.model, route.apiKey]).toEqual([
      "gemini",
      "gemini-2.5-flash-lite",
      "k-123",
    ]);
  });

  it("changes the model with AI_MODEL, and one task's model with AI_MODEL_<TASK>", () => {
    const env = { ...KEY, AI_MODEL: "gemini-3.5-flash-lite", AI_MODEL_CALL_NOTE: "gemini-3.8-flash" };
    const summary = aiRoute("summary", env);
    const callNote = aiRoute("call_note", env);
    expect(summary.state === "on" && summary.model).toBe("gemini-3.5-flash-lite");
    expect(callNote.state === "on" && callNote.model).toBe("gemini-3.8-flash");
  });

  it("still gives AI_MODEL to a task that names the global provider again", () => {
    // The other half of the rule — a task routed to a *different* provider does not inherit
    // AI_MODEL — can only be exercised once a second provider exists; it belongs to that change.
    const explicit = aiRoute("draft", {
      ...KEY,
      AI_PROVIDER: "gemini",
      AI_PROVIDER_DRAFT: "gemini",
      AI_MODEL: "gemini-x",
    });
    const byDefault = aiRoute("draft", { ...KEY, AI_PROVIDER_DRAFT: "gemini", AI_MODEL: "gemini-x" });
    expect(explicit.state === "on" && explicit.model).toBe("gemini-x");
    expect(byDefault.state === "on" && byDefault.model).toBe("gemini-x");
  });

  it("⚠️ says a wrong configuration is wrong, instead of passing it off as 'not configured'", () => {
    expect(aiRoute("summary", { ...KEY, AI_PROVIDER: "gpt" })).toEqual({
      state: "config",
      problem: 'unknown AI provider "gpt"',
    });
    expect(aiRoute("summary", { AI_PROVIDER: "gemini" })).toEqual({
      state: "config",
      problem: "GEMINI_API_KEY is not set",
    });
    expect(aiRoute("classify", { AI_PROVIDER_CLASSIFY: "gemini" })).toMatchObject({ state: "config" });
  });

  it("⚠️ refuses a model id that could reach anything but the model's path", () => {
    for (const model of ["../files", "gemini-2.5?key=x", "gemini 2.5", "gemini/2.5"]) {
      expect(aiRoute("summary", { ...KEY, AI_MODEL: model }), model).toMatchObject({ state: "config" });
    }
  });
});

describe("aiGenerate", () => {
  it("calls nothing when the copilot is off, and says why", async () => {
    let called = false;
    const result = await aiGenerate(
      "summary",
      { system: "s", messages: [{ role: "user", text: "t" }], maxOutputTokens: 10 },
      {
        env: {},
        fetch: async () => {
          called = true;
          return new Response("{}");
        },
      },
    );
    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false, reason: "off" });
  });

  it("sends the task to the model its route names", async () => {
    const urls: string[] = [];
    await aiGenerate(
      "classify",
      { system: "s", messages: [{ role: "user", text: "t" }], maxOutputTokens: 10 },
      {
        env: { ...KEY, AI_MODEL_CLASSIFY: "gemini-3.5-flash-lite" },
        fetch: async (url) => {
          urls.push(url);
          return new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }),
          );
        },
      },
    );
    expect(urls[0]).toContain("/models/gemini-3.5-flash-lite:generateContent");
  });
});

describe("aiGenerateJson", () => {
  const answering = (text: string, finishReason = "STOP") => ({
    env: KEY,
    fetch: async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }), { status: 200 }),
  });
  const request = {
    system: "Estrai il budget.",
    messages: [{ role: "user" as const, text: "Abbiamo 5.000 euro." }],
    maxOutputTokens: 100,
    schema: { type: "object", properties: { budget: { type: "number" } }, required: ["budget"] },
  };
  const budget = (v: unknown) =>
    typeof v === "object" && v !== null && typeof (v as { budget?: unknown }).budget === "number"
      ? { budget: (v as { budget: number }).budget }
      : null;

  it("returns the value when the answer parses and fits", async () => {
    const result = await aiGenerateJson("extract", request, budget, answering('{"budget":5000}'));
    expect(result).toMatchObject({ ok: true, value: { budget: 5000 } });
  });

  it("⚠️ never passes on an answer that does not parse, does not fit, or was cut off", async () => {
    expect(await aiGenerateJson("extract", request, budget, answering("cinquemila"))).toMatchObject({
      ok: false,
      reason: "output",
    });
    expect(await aiGenerateJson("extract", request, budget, answering('{"budget":"5000"}'))).toMatchObject({
      ok: false,
      reason: "output",
    });
    expect(await aiGenerateJson("extract", request, budget, answering('{"budget":5000}', "MAX_TOKENS"))).toMatchObject({
      ok: false,
      reason: "output",
    });
  });
});

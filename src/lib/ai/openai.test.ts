/**
 * ⚠️⚠️ The OpenAI client against recorded answers (the Responses API,
 * https://developers.openai.com/api/reference/resources/responses).
 *
 * No real key has been through it yet: these hold it to the published contract — the key as a
 * Bearer token, Flux's instructions as `instructions`, nothing stored on OpenAI's side, a reasoning
 * model's thinking budgeted and its working left out of the answer, every failure in Flux's words.
 */
import { describe, expect, it } from "vitest";

import { aiRoute } from "./config";
import { isReasoningModel, openAiBody, openAiProvider, strictSchema } from "./openai";
import type { AiCallContext, AiRequest, AiStreamEvent } from "./types";

type Call = { url: string; body: Record<string, unknown>; auth: string | null };

function recorder(answer: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
    return answer();
  };
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const context = (fetchImpl: AiCallContext["fetch"], model = "gpt-5-mini"): AiCallContext => ({
  model,
  apiKey: "sk-123",
  fetch: fetchImpl,
});

const REQUEST: AiRequest = {
  system: "Riassumi il record per il commerciale.",
  messages: [
    { role: "user", text: "Nota: il cliente chiede lo sconto." },
    { role: "assistant", text: "Bozza precedente" },
    { role: "user", text: "Più breve." },
  ],
  maxOutputTokens: 400,
  temperature: 0.2,
};

const COMPLETED = {
  status: "completed",
  output: [
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "message", id: "msg_0", phase: "commentary", content: [{ type: "output_text", text: "sto pensando" }] },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      content: [
        { type: "output_text", text: "Il cliente " },
        { type: "output_text", text: "chiede uno sconto." },
      ],
    },
  ],
  usage: {
    input_tokens: 120,
    output_tokens: 90,
    input_tokens_details: { cached_tokens: 64 },
    output_tokens_details: { reasoning_tokens: 70 },
  },
};

describe("⚠️⚠️ the request", () => {
  it("sends the key as a Bearer token, the instructions apart, and asks OpenAI to keep nothing", async () => {
    const { calls, fetchImpl } = recorder(json(200, COMPLETED));
    await openAiProvider.generate(REQUEST, context(fetchImpl));
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0].auth).toBe("Bearer sk-123");
    expect(calls[0].body).toMatchObject({
      model: "gpt-5-mini",
      instructions: REQUEST.system,
      input: [
        { role: "user", content: "Nota: il cliente chiede lo sconto." },
        { role: "assistant", content: "Bozza precedente" },
        { role: "user", content: "Più breve." },
      ],
      store: false,
    });
  });

  it("⚠️ gives a reasoning model a thinking allowance and a low effort, and no temperature", () => {
    const body = openAiBody(REQUEST, "gpt-5-mini", {});
    expect(body.max_output_tokens).toBeGreaterThan(REQUEST.maxOutputTokens);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body).not.toHaveProperty("temperature");
    expect(openAiBody(REQUEST, "o4-mini", { OPENAI_REASONING_EFFORT: "medium" }).reasoning).toEqual({
      effort: "medium",
    });
    // An effort OpenAI does not know is not sent: it would refuse the whole request.
    expect(openAiBody(REQUEST, "gpt-5-mini", { OPENAI_REASONING_EFFORT: "max" }).reasoning).toEqual({ effort: "low" });
  });

  it("sends the temperature and the exact ceiling to a model that does not reason", () => {
    const body = openAiBody(REQUEST, "gpt-4.1-mini", {});
    expect(body).toMatchObject({ temperature: 0.2, max_output_tokens: 400 });
    expect(body).not.toHaveProperty("reasoning");
    expect(isReasoningModel("gpt-4.1-mini")).toBe(false);
    expect(isReasoningModel("gpt-5.1")).toBe(true);
  });

  it("asks for a strict JSON answer when every property is required, a guided one otherwise", () => {
    const schema = {
      type: "object",
      properties: { subject: { type: "string" }, body: { type: "string" } },
      required: ["subject", "body"],
    };
    const body = openAiBody({ ...REQUEST, output: { kind: "json", schema } }, "gpt-5-mini", {});
    expect(body.text).toEqual({
      format: { type: "json_schema", name: "answer", strict: true, schema: { ...schema, additionalProperties: false } },
    });
    const loose = { ...schema, required: ["subject"] };
    expect(strictSchema(loose)).toBeNull();
    const guided = openAiBody({ ...REQUEST, output: { kind: "json", schema: loose } }, "gpt-5-mini", {});
    expect(guided.text).toEqual({ format: { type: "json_schema", name: "answer", strict: false, schema: loose } });
  });
});

describe("⚠️⚠️ the answer", () => {
  it("is the message's text, the working left out, with every token counted", async () => {
    const { fetchImpl } = recorder(json(200, COMPLETED));
    const result = await openAiProvider.generate(REQUEST, context(fetchImpl));
    expect(result).toEqual({
      ok: true,
      text: "Il cliente chiede uno sconto.",
      truncated: false,
      usage: { inputTokens: 120, outputTokens: 90, reasoningTokens: 70, cachedInputTokens: 64 },
      provider: "openai",
      model: "gpt-5-mini",
    });
  });

  it("an answer cut at the ceiling comes back marked; one with nothing in it is a failure", async () => {
    const cut = { ...COMPLETED, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } };
    const r1 = await openAiProvider.generate(REQUEST, context(recorder(json(200, cut)).fetchImpl));
    expect(r1).toMatchObject({ ok: true, truncated: true });
    const empty = { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] };
    const r2 = await openAiProvider.generate(REQUEST, context(recorder(json(200, empty)).fetchImpl));
    expect(r2).toMatchObject({ ok: false, reason: "output" });
  });

  it("a refusal or a content filter is `blocked`", async () => {
    const refused = {
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Non posso aiutare." }] }],
    };
    expect(await openAiProvider.generate(REQUEST, context(recorder(json(200, refused)).fetchImpl))).toMatchObject({
      ok: false,
      reason: "blocked",
    });
    const filtered = { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] };
    expect(await openAiProvider.generate(REQUEST, context(recorder(json(200, filtered)).fetchImpl))).toMatchObject({
      ok: false,
      reason: "blocked",
    });
  });

  it.each([
    [
      401,
      { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } },
      "auth",
    ],
    [404, { error: { message: "The model does not exist", code: "model_not_found" } }, "model"],
    [400, { error: { message: "The model `x` does not exist", code: "model_not_found" } }, "model"],
    [429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } }, "rate_limited"],
    [400, { error: { message: "Unsupported parameter: 'temperature'", code: "unsupported_parameter" } }, "invalid"],
    [503, { error: { message: "overloaded" } }, "unavailable"],
  ])("an HTTP %i is named in Flux's words", async (status, body, reason) => {
    const result = await openAiProvider.generate(REQUEST, context(recorder(json(status, body)).fetchImpl));
    expect(result).toMatchObject({ ok: false, reason, provider: "openai" });
    // ⚠️ Never the request: it carries a customer's words.
    expect(result.ok ? "" : result.message).not.toContain("sconto");
  });

  it("a network failure is `unavailable`, a timeout said as one", async () => {
    const r = await openAiProvider.generate(
      REQUEST,
      context(async () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "unavailable", message: "OpenAI did not answer in time" });
  });
});

describe("⚠️ streaming", () => {
  const sse = (events: Record<string, unknown>[]) => () =>
    new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

  async function collect(gen: AsyncGenerator<AiStreamEvent>) {
    const out: AiStreamEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  }

  it("streams the answer's text, not the working, and ends with the whole result", async () => {
    const { calls, fetchImpl } = recorder(
      sse([
        { type: "response.created", response: { status: "in_progress" } },
        { type: "response.output_item.added", item: { id: "msg_0", type: "message", phase: "commentary" } },
        { type: "response.output_text.delta", item_id: "msg_0", delta: "sto pensando" },
        { type: "response.output_item.added", item: { id: "msg_1", type: "message" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Il cliente " },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "chiede uno sconto." },
        { type: "response.completed", response: COMPLETED },
      ]),
    );
    const events = await collect(openAiProvider.stream(REQUEST, context(fetchImpl)));
    expect(calls[0].body.stream).toBe(true);
    expect(events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : ""))).toEqual([
      "Il cliente ",
      "chiede uno sconto.",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "end",
      result: { ok: true, text: "Il cliente chiede uno sconto.", usage: { reasoningTokens: 70 } },
    });
  });

  it("an error event, or a stream that never finishes, ends as a failure", async () => {
    const failed = await collect(
      openAiProvider.stream(
        REQUEST,
        context(
          recorder(
            sse([
              { type: "response.output_text.delta", item_id: "m", delta: "Il" },
              { type: "error", code: "server_error", message: "boom" },
            ]),
          ).fetchImpl,
        ),
      ),
    );
    expect(failed.at(-1)).toMatchObject({ type: "end", result: { ok: false, reason: "unavailable" } });
    const unfinished = await collect(
      openAiProvider.stream(
        REQUEST,
        context(recorder(sse([{ type: "response.output_text.delta", item_id: "m", delta: "Il" }])).fetchImpl),
      ),
    );
    expect(unfinished.at(-1)).toMatchObject({ type: "end", result: { ok: false, reason: "unavailable" } });
  });
});

describe("⚠️ choosing OpenAI", () => {
  it("is chosen by name, or by being the only key set", () => {
    expect(aiRoute("draft", { OPENAI_API_KEY: "sk" })).toMatchObject({ state: "on", model: "gpt-5-mini" });
    expect(aiRoute("draft", { AI_PROVIDER: "openai", OPENAI_API_KEY: "sk", AI_MODEL: "gpt-5.1" })).toMatchObject({
      state: "on",
      model: "gpt-5.1",
    });
    // With both keys and no name, the default provider stays the default.
    const both = aiRoute("draft", { OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g" });
    expect(both.state === "on" && both.provider.id).toBe("gemini");
  });

  it("named without its key is a configuration mistake, not 'off'", () => {
    expect(aiRoute("draft", { AI_PROVIDER: "openai" })).toEqual({
      state: "config",
      problem: "OPENAI_API_KEY is not set",
    });
  });

  it("one task on OpenAI, the rest on Gemini, each with its own model", () => {
    const env = {
      GEMINI_API_KEY: "g",
      AI_MODEL: "gemini-3.5-flash-lite",
      AI_PROVIDER_DRAFT: "openai",
      OPENAI_API_KEY: "sk",
    };
    const draft = aiRoute("draft", env);
    const summary = aiRoute("summary", env);
    expect(draft).toMatchObject({ state: "on", model: "gpt-5-mini" });
    expect(draft.state === "on" && draft.provider.id).toBe("openai");
    expect(summary).toMatchObject({ state: "on", model: "gemini-3.5-flash-lite" });
  });
});

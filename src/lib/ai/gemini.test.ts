/**
 * ⚠️⚠️ The Gemini client against recorded answers (https://ai.google.dev/api/generate-content).
 *
 * No real key has been through it yet: these hold it to the published contract — the key in
 * `x-goog-api-key` and never in the URL, Flux's instructions as `systemInstruction`, the
 * assistant as `model`, the thinking left out of the answer, every failure named in Flux's
 * words — so the first real call has only the key and the model left to prove.
 */
import { describe, expect, it } from "vitest";

import { geminiProvider } from "./gemini";
import { sseData } from "./sse";
import type { AiCallContext, AiRequest, AiStreamEvent } from "./types";

type Call = { url: string; body: Record<string, unknown>; key: string | null };

function recorder(answer: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init?.body)),
      key: new Headers(init?.headers).get("x-goog-api-key"),
    });
    return answer();
  };
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function context(fetchImpl: AiCallContext["fetch"]): AiCallContext {
  return { model: "gemini-2.5-flash-lite", apiKey: "k-123", fetch: fetchImpl };
}

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

const ANSWER = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          { text: "ragionamento interno", thought: true },
          { text: "Il cliente " },
          { text: "chiede uno sconto." },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 9, thoughtsTokenCount: 4, totalTokenCount: 133 },
};

describe("gemini: the request", () => {
  it("sends the key in the header, the model in the path, and the conversation in Gemini's shape", async () => {
    const { calls, fetchImpl } = recorder(json(200, ANSWER));
    await geminiProvider.generate(REQUEST, context(fetchImpl));

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
    );
    expect(call.key).toBe("k-123");
    // ⚠️ Never in the URL: URLs end up in logs.
    expect(call.url).not.toContain("k-123");
    expect(call.body.systemInstruction).toEqual({ parts: [{ text: "Riassumi il record per il commerciale." }] });
    expect(call.body.contents).toEqual([
      { role: "user", parts: [{ text: "Nota: il cliente chiede lo sconto." }] },
      { role: "model", parts: [{ text: "Bozza precedente" }] },
      { role: "user", parts: [{ text: "Più breve." }] },
    ]);
    expect(call.body.generationConfig).toEqual({ maxOutputTokens: 400, temperature: 0.2 });
  });

  it("asks for JSON against the schema when the request gives one", async () => {
    const { calls, fetchImpl } = recorder(json(200, ANSWER));
    const schema = { type: "object", properties: { budget: { type: "number" } }, required: ["budget"] };
    await geminiProvider.generate({ ...REQUEST, output: { kind: "json", schema } }, context(fetchImpl));
    expect(calls[0].body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    });
  });
});

describe("gemini: the answer", () => {
  it("returns the answer's text without the model's thinking, and the usage", async () => {
    const { fetchImpl } = recorder(json(200, ANSWER));
    const result = await geminiProvider.generate(REQUEST, context(fetchImpl));
    expect(result).toEqual({
      ok: true,
      text: "Il cliente chiede uno sconto.",
      truncated: false,
      usage: { inputTokens: 120, outputTokens: 9, reasoningTokens: 4, cachedInputTokens: 0 },
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
    });
  });

  it("says an answer that reached the token ceiling is incomplete", async () => {
    const cut = { ...ANSWER, candidates: [{ ...ANSWER.candidates[0], finishReason: "MAX_TOKENS" }] };
    const { fetchImpl } = recorder(json(200, cut));
    const result = await geminiProvider.generate(REQUEST, context(fetchImpl));
    expect(result.ok && result.truncated).toBe(true);
  });

  it("reports a refused prompt and a filtered answer as blocked, not as an empty answer", async () => {
    const refused = recorder(json(200, { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }));
    const a = await geminiProvider.generate(REQUEST, context(refused.fetchImpl));
    expect(a).toMatchObject({ ok: false, reason: "blocked" });

    const filtered = recorder(json(200, { candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }));
    const b = await geminiProvider.generate(REQUEST, context(filtered.fetchImpl));
    expect(b).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("names every HTTP failure in Flux's words", async () => {
    const cases: [number, unknown, string][] = [
      [
        400,
        {
          error: { status: "INVALID_ARGUMENT", message: "API key not valid", details: [{ reason: "API_KEY_INVALID" }] },
        },
        "auth",
      ],
      [400, { error: { status: "INVALID_ARGUMENT", message: "bad schema" } }, "invalid"],
      [403, { error: { status: "PERMISSION_DENIED", message: "denied" } }, "auth"],
      [404, { error: { status: "NOT_FOUND", message: "model not found" } }, "model"],
      [429, { error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }, "rate_limited"],
      [503, { error: { status: "UNAVAILABLE", message: "overloaded" } }, "unavailable"],
    ];
    for (const [status, body, reason] of cases) {
      const { fetchImpl } = recorder(json(status, body));
      const result = await geminiProvider.generate(REQUEST, context(fetchImpl));
      expect(result, `HTTP ${status}`).toMatchObject({ ok: false, reason });
    }
  });

  it("never puts the request, which carries a customer's words, in a failure message", async () => {
    const { fetchImpl } = recorder(json(500, { error: { message: "internal" } }));
    const result = await geminiProvider.generate(REQUEST, context(fetchImpl));
    expect(!result.ok && result.message).not.toContain("sconto");
  });

  it("reports a network failure and a timeout as unavailable", async () => {
    const down = await geminiProvider.generate(
      REQUEST,
      context(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(down).toMatchObject({ ok: false, reason: "unavailable" });

    const slow = await geminiProvider.generate(
      REQUEST,
      context(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    expect(slow).toMatchObject({ ok: false, reason: "unavailable", message: "Gemini did not answer in time" });
  });
});

function sseResponse(chunks: string[]): () => Response {
  return () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}

async function collect(events: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("gemini: streaming", () => {
  it("streams the text as it arrives and ends with the whole answer and the final usage", async () => {
    const first = { candidates: [{ content: { parts: [{ text: "Buongiorno " }] } }] };
    const second = {
      candidates: [{ content: { parts: [{ text: "Rossi." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 3 },
    };
    // The second event is split across two network chunks, and CRLF line endings are used.
    const wire = `data: ${JSON.stringify(first)}\r\n\r\ndata: ${JSON.stringify(second)}\r\n\r\n`;
    const cut = wire.indexOf("Rossi");
    const { calls, fetchImpl } = recorder(sseResponse([wire.slice(0, cut), wire.slice(cut)]));

    const events = await collect(geminiProvider.stream(REQUEST, context(fetchImpl)));

    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent?alt=sse",
    );
    expect(events).toEqual([
      { type: "text", text: "Buongiorno " },
      { type: "text", text: "Rossi." },
      {
        type: "end",
        result: {
          ok: true,
          text: "Buongiorno Rossi.",
          truncated: false,
          usage: { inputTokens: 50, outputTokens: 3, reasoningTokens: 0, cachedInputTokens: 0 },
          provider: "gemini",
          model: "gemini-2.5-flash-lite",
        },
      },
    ]);
  });

  it("ends a refused stream with the failure, not with an empty success", async () => {
    const { fetchImpl } = recorder(json(429, { error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }));
    const events = await collect(geminiProvider.stream(REQUEST, context(fetchImpl)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "end", result: { ok: false, reason: "rate_limited" } });
  });
});

describe("sseData", () => {
  it("does not end an event on a CR that is the first half of a CRLF split across chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = ["data: a\r", "\ndata: b\r\n\r\n"];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const data of sseData(body)) out.push(data);
    expect(out).toEqual(["a\nb"]);
  });

  it("skips comments and keep-alives, and keeps a last event with no blank line after it", async () => {
    const body = new Response(": keep-alive\n\ndata: uno\n\ndata: due").body as ReadableStream<Uint8Array>;
    const out: string[] = [];
    for await (const data of sseData(body)) out.push(data);
    expect(out).toEqual(["uno", "due"]);
  });
});

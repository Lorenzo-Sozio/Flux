/**
 * Server-Sent Events, read from a response body: the `data` of each event, in order.
 *
 * Streaming providers (Gemini's `?alt=sse`, and most others) send one JSON document per event.
 * ⚠️ A network chunk is not an event: one chunk can carry half an event or three of them, and a
 * multi-byte character can be split across two. Only a blank line ends an event.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // A "\r" at the very end waits for the next chunk: it may be the first half of "\r\n", and
      // read alone it would end the line twice — a blank line, and an event cut in two.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n|\r(?!$)/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const data = dataOf(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (data !== null) yield data;
        end = buffer.indexOf("\n\n");
      }
    }
    // A last event the server did not close with a blank line still counts.
    const data = dataOf((buffer + decoder.decode()).replace(/\r\n?/g, "\n"));
    if (data !== null) yield data;
  } finally {
    reader.releaseLock();
  }
}

/** The event's `data` lines joined, or null for an event without any (a comment, a keep-alive). */
function dataOf(event: string): string | null {
  const lines = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return lines.length > 0 ? lines.join("\n") : null;
}

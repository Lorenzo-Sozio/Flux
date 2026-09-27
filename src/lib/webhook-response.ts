/**
 * What is kept of a receiver's answer to a webhook: the start of it, read no further.
 *
 * ⚠️ A receiver is somebody else's server — and, since keys can subscribe, anybody's. Read
 * whole, an answer of any size went into memory on every delivery and into `webhook_log`
 * on every event. The first few kilobytes say whether it worked; the rest is not ours to keep.
 */
export const MAX_WEBHOOK_RESPONSE = 4096;

export async function readWebhookResponse(res: Response, max = MAX_WEBHOOK_RESPONSE): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (out.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } catch {
    // A body that breaks halfway is still an answer: what arrived is kept.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

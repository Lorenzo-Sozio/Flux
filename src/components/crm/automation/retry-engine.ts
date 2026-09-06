/**
 * Retry Engine with Exponential Backoff
 *
 * Retry logic for actions that can fail: HTTP calls, email, and the like.
 *
 * Strategie di backoff:
 * - Linear: 1s, 2s, 3s, 4s, 5s
 * - Exponential: 1s, 2s, 4s, 8s, 16s (default per robustezza)
 */

export type BackoffStrategy = "linear" | "exponential";

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  strategy: BackoffStrategy;
}

/**
 * Config default per azioni esterne (webhook, email, ecc.)
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 secondo
  maxDelayMs: 30000, // 30 secondi max
  strategy: "exponential",
};

/**
 * The delay before attempt N.
 */
export function calculateBackoffDelay(
  attempt: number, // 0-indexed
  config: RetryConfig,
): number {
  let delay: number;

  if (config.strategy === "linear") {
    delay = config.initialDelayMs * (attempt + 1);
  } else {
    // exponential: 2^attempt * initialDelay
    delay = config.initialDelayMs * 2 ** attempt;
  }

  // Cap al maxDelay
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a function, retrying it.
 *
 * @example
 * const result = await executeWithRetry(
 *   async () => {
 *     const res = await fetch(webhookUrl, { method: 'POST', body: JSON.stringify(data) })
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`)
 *     return res.json()
 *   },
 *   {
 *     maxRetries: 3,
 *     initialDelayMs: 1000,
 *     maxDelayMs: 30000,
 *     strategy: 'exponential'
 *   }
 * )
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  const { result } = await executeWithRetryTracked(fn, config);
  return result;
}

/**
 * Like executeWithRetry but also returns the number of retry attempts made.
 * `attempts` is 0 when the first call succeeds, 1 when one retry was needed, etc.
 */
export async function executeWithRetryTracked<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<{ result: T; attempts: number }> {
  let lastError: Error | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, attempts };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      attempts = attempt + 1;

      if (attempt === config.maxRetries) {
        break;
      }

      const delayMs = calculateBackoffDelay(attempt, config);
      console.warn(
        `[RetryEngine] Attempt ${attempt + 1}/${config.maxRetries + 1} failed. ` +
          `Retrying in ${delayMs}ms... Error: ${lastError.message}`,
      );

      await sleep(delayMs);
    }
  }

  throw new Error(`Failed after ${config.maxRetries + 1} attempts. Last error: ${lastError?.message}`);
}

/**
 * Whether an error is worth retrying.
 *
 * Esempio di errori retriable:
 * - Network timeouts
 * - 5xx server errors
 * - Rate limits (429)
 *
 * Errors not worth retrying:
 * - 400 Bad Request
 * - 401 Unauthorized
 * - 403 Forbidden
 * - Validation errors
 */
export function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return true; // Default: retry unknown errors

  const message = err.message.toLowerCase();

  // HTTP-specific errors
  if (message.includes("http")) {
    // Retriable HTTP errors
    if (
      message.includes("500") || // Internal Server Error
      message.includes("502") || // Bad Gateway
      message.includes("503") || // Service Unavailable
      message.includes("504") || // Gateway Timeout
      message.includes("429") || // Too Many Requests
      message.includes("timeout") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    ) {
      return true;
    }

    // Non-retriable HTTP errors
    if (
      message.includes("400") || // Bad Request
      message.includes("401") || // Unauthorized
      message.includes("403") || // Forbidden
      message.includes("404") // Not Found
    ) {
      return false;
    }
  }

  // Network errors (retriable)
  if (
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("network")
  ) {
    return true;
  }

  // Per default, retry
  return true;
}

/**
 * Where a webhook may point: public HTTPS addresses, and nothing inside the platform.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateWebhookUrl } from "./webhook-validator";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("⚠️⚠️ validateWebhookUrl in production", () => {
  it("refuses the machine itself, private ranges and the cloud metadata address", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const url of [
      "https://localhost/hook",
      "https://api.localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "http://hooks.example.com/in",
      "https://internal/hook",
    ]) {
      expect(validateWebhookUrl(url), url).not.toBeNull();
    }
  });

  it("accepts a public HTTPS address", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(validateWebhookUrl("https://hooks.example.com/in")).toBeNull();
  });
});

describe("in development", () => {
  it("lets a local receiver be used", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(validateWebhookUrl("http://localhost:4000/hook")).toBeNull();
  });
});

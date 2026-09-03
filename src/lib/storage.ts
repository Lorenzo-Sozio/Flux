/**
 * storage.ts — where uploaded files actually live.
 *
 * They lived on the local filesystem (audit rilievo B-06). That is wrong in two
 * different ways depending on where the app runs:
 *
 *  • On Cloudflare Workers there is no filesystem at all, so uploads throw.
 *  • On Vercel there is one, which is worse: the write succeeds. The disk is
 *    per-instance and per-deploy, so the file can be missing from the very next
 *    request and is certainly gone after the next deploy. Nothing reports it —
 *    the document row survives, pointing at nothing.
 *
 * The store is chosen by what the environment provides rather than by a flag,
 * because a flag is one more thing that can disagree with reality:
 *
 *  1. An R2 bucket bound as DOCUMENTS — production on Workers.
 *  2. S3-compatible object storage, if the credentials are present.
 *  3. The local filesystem — development only, and it says so.
 *
 * The key is opaque and generated here. Nothing derived from the uploaded
 * filename ever reaches a path.
 */
import { createHash, randomUUID } from "node:crypto";

export interface StoredFile {
  /** Opaque key. Persisted on the document row; never shown to the user. */
  key: string;
  size: number;
  contentType: string;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * A key that carries no user input.
 *
 * Only the extension is taken from the upload, and only after being matched
 * against a strict pattern — a filename is attacker-controlled, and it has no
 * business appearing in a path.
 */
export function newStorageKey(originalName: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(originalName.trim());
  const ext = match ? `.${match[1].toLowerCase()}` : "";
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `documents/${yyyymm}/${randomUUID()}${ext}`;
}

/** True for a key this module could have produced. Rejects anything else. */
export function isValidStorageKey(key: string): boolean {
  return /^documents\/\d{6}\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/.test(key);
}

// ─── R2 ───────────────────────────────────────────────────────────────────────

/** The subset of the R2 binding this module uses. */
interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

function r2Driver(bucket: R2Bucket): StorageDriver {
  return {
    name: "r2",
    async put(key, body, contentType) {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return new Uint8Array(await object.arrayBuffer());
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

// ─── S3-compatible ────────────────────────────────────────────────────────────

/**
 * Signs and sends a request to any S3-compatible endpoint with SigV4.
 *
 * Written against `fetch` rather than the AWS SDK on purpose: the bundle is
 * already close to the 10 MB Workers limit, and this needs three verbs.
 */
function s3Driver(config: {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): StorageDriver {
  const encoder = new TextEncoder();

  const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const sha256 = async (data: Uint8Array | string) =>
    hex(
      await crypto.subtle.digest("SHA-256", typeof data === "string" ? encoder.encode(data) : (data as BufferSource)),
    );

  const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  };

  async function signedFetch(method: string, key: string, body?: Uint8Array, contentType?: string) {
    const url = new URL(`${config.endpoint.replace(/\/+$/, "")}/${config.bucket}/${key}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = await sha256(body ?? "");
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;

    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}\n`)
      .join("");

    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");

    let signingKey: ArrayBuffer = await hmac(encoder.encode(`AWS4${config.secretAccessKey}`), dateStamp);
    signingKey = await hmac(signingKey, config.region);
    signingKey = await hmac(signingKey, "s3");
    signingKey = await hmac(signingKey, "aws4_request");
    const signature = hex(await hmac(signingKey, toSign));

    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url.toString(), { method, headers, body: body as BodyInit | undefined });
  }

  return {
    name: "s3",
    async put(key, body, contentType) {
      const res = await signedFetch("PUT", key, body, contentType);
      if (!res.ok) throw new Error(`Object storage rejected the upload (${res.status}).`);
    },
    async get(key) {
      const res = await signedFetch("GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Object storage returned ${res.status}.`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await signedFetch("DELETE", key);
      if (!res.ok && res.status !== 404) throw new Error(`Object storage returned ${res.status}.`);
    },
  };
}

// ─── Local filesystem, development only ───────────────────────────────────────

function localDriver(): StorageDriver {
  const root = () => `${process.cwd()}/uploads`;

  return {
    name: "local",
    async put(key, body) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const path = `${root()}/${key}`;
      await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      const { readFile } = await import("node:fs/promises");
      try {
        return new Uint8Array(await readFile(`${root()}/${key}`));
      } catch {
        return null;
      }
    },
    async delete(key) {
      const { unlink } = await import("node:fs/promises");
      await unlink(`${root()}/${key}`).catch(() => undefined);
    },
  };
}

// ─── Selection ────────────────────────────────────────────────────────────────

let warnedAboutLocal = false;

/** The DOCUMENTS binding, when running on Cloudflare. Null anywhere else. */
async function cloudflareBucket(): Promise<R2Bucket | null> {
  const fromGlobal = (globalThis as { DOCUMENTS?: unknown }).DOCUMENTS as R2Bucket | undefined;
  if (fromGlobal && typeof fromGlobal.put === "function") return fromGlobal;

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as { DOCUMENTS?: R2Bucket };
    if (env?.DOCUMENTS && typeof env.DOCUMENTS.put === "function") return env.DOCUMENTS;
  } catch {
    // Not running on Cloudflare, or no context for this call. Both are ordinary.
  }
  return null;
}

/**
 * The store for this request.
 *
 * On Workers the R2 binding arrives through the Cloudflare context rather than
 * `process.env`, so it is read there first and the import is dynamic — the module
 * is absent when running anywhere else.
 */
export async function getStorage(): Promise<StorageDriver> {
  const bucket = await cloudflareBucket();
  if (bucket) return r2Driver(bucket);

  const endpoint = process.env.S3_ENDPOINT?.trim();
  const s3Bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

  if (endpoint && s3Bucket && accessKeyId && secretAccessKey) {
    return s3Driver({
      endpoint,
      bucket: s3Bucket,
      region: process.env.S3_REGION?.trim() || "auto",
      accessKeyId,
      secretAccessKey,
    });
  }

  if (process.env.NODE_ENV === "production" && !warnedAboutLocal) {
    warnedAboutLocal = true;
    console.error(
      "[storage] No object storage is configured, falling back to the local disk. " +
        "In production that disk is per-instance and per-deploy: uploads will appear " +
        "to succeed and then disappear. Bind an R2 bucket as DOCUMENTS, or set " +
        "S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.",
    );
  }

  return localDriver();
}

/** A stable fingerprint of the bytes, for de-duplication and integrity checks. */
export function contentHash(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export type { R2Bucket };

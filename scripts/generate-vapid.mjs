#!/usr/bin/env node

/**
 * Generates the VAPID keypair web push is signed with.
 *
 * Run with: npm run generate:vapid
 *
 * The pair identifies this deployment to every push service — Google's, Mozilla's,
 * Apple's. The public half travels to each browser at the moment it subscribes and
 * is baked into the endpoint the browser hands back; the private half signs every
 * send.
 *
 * ⚠️ **Generate once and keep it.** Rotating the pair does not re-key anything: a
 * browser subscribed against the old public key keeps an endpoint that the new
 * private key cannot write to, and every send comes back 403 forever. There is no
 * migration and no warning — the notifications simply stop, on every device, and
 * everyone has to turn them on again. Rotate only if the private key has leaked.
 *
 * Written with Web Crypto rather than the `web-push` package for the same reason
 * the sender is: this repository deploys to Cloudflare Workers as well as Node,
 * and one implementation that behaves the same in both is worth more than a
 * dependency.
 */

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");

// The public key travels as the uncompressed point: 0x04 || x || y, 65 bytes.
const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
// The private key is the bare scalar, which is what the JWK's `d` already holds.
const { d: privateKey } = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`
A VAPID keypair for web push. Keep the private key secret.

  PUSH_VAPID_PUBLIC_KEY=${publicKey}
  PUSH_VAPID_PRIVATE_KEY=${privateKey}

Locally: paste both into .env — never into .env.example, which is committed.

On Cloudflare, as Worker secrets, so they are not in wrangler.jsonc:

  npx wrangler secret put PUSH_VAPID_PUBLIC_KEY
  npx wrangler secret put PUSH_VAPID_PRIVATE_KEY

On Vercel: add both as environment variables for every environment that should
send notifications.

Optionally set PUSH_VAPID_SUBJECT to a mailto: or https: address a push service
can use to reach you. It defaults to this application's own address.

⚠️ Generate this once. Replacing the pair later breaks every subscription that
already exists: those browsers hold endpoints the new key cannot write to, they
answer 403 forever, and everyone has to turn notifications on again.
`);

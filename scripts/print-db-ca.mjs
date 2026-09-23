#!/usr/bin/env node
/**
 * Prints the root certificate a Postgres server presents, so it can be pinned in
 * src/lib/db-ssl.ts (or put in DATABASE_CA_PEM) when a provider rotates it.
 *
 *   node scripts/print-db-ca.mjs postgresql://user:pass@host:port/db
 */
import net from "node:net";
import tls from "node:tls";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Usage: node scripts/print-db-ca.mjs <postgres-url>");
  process.exit(1);
}
const { hostname, port } = new URL(url);

const socket = net.connect(Number(port || 5432), hostname, () => {
  // Postgres speaks its own handshake first: ask for TLS, then start it.
  const request = Buffer.alloc(8);
  request.writeInt32BE(8, 0);
  request.writeInt32BE(80877103, 4);
  socket.write(request);
});

socket.once("data", (answer) => {
  if (answer.toString() !== "S") {
    console.error("The server refused TLS.");
    process.exit(1);
  }
  const secure = tls.connect({ socket, rejectUnauthorized: false }, () => {
    let cert = secure.getPeerCertificate(true);
    const seen = new Set();
    while (cert && !seen.has(cert.fingerprint256)) {
      seen.add(cert.fingerprint256);
      if (!cert.issuerCertificate || cert.issuerCertificate.fingerprint256 === cert.fingerprint256) {
        console.error(`# root: ${cert.subject?.CN ?? "?"}  sha256 ${cert.fingerprint256}`);
        console.log(`-----BEGIN CERTIFICATE-----\n${cert.raw.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`);
        break;
      }
      cert = cert.issuerCertificate;
    }
    secure.end();
    process.exit(0);
  });
  secure.on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  });
});

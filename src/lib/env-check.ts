/**
 * env-check.ts — one report of everything missing, at boot.
 *
 * Twenty-three variables the code reads were absent from `.env.example`, and the
 * failures they produce name a symptom rather than a cause: a decrypt error, a
 * 500 from a cron route, an email whose links point at localhost (audit rilievo
 * B-05). Finding them one at a time costs a deploy each.
 *
 * Run from `instrumentation.ts`, so the list appears once in the server log
 * before the first request rather than as a surprise weeks later.
 */

interface EnvSpec {
  name: string;
  /** What stops working. Written as a consequence, not a description. */
  breaks: string;
  /** Fatal in production — the app is not serviceable without it. */
  fatal?: boolean;
  /** Satisfied when any one of these is present. */
  alternatives?: string[];
}

const REQUIRED: EnvSpec[] = [
  {
    name: "DATABASE_URL",
    breaks: "no database at all: the platform registry, accounts and billing are unreachable",
    fatal: true,
  },
  {
    name: "PLATFORM_ENCRYPTION_KEY",
    breaks: "tenant connection strings cannot be decrypted, so no workspace can be opened",
    fatal: true,
  },
  {
    name: "AUTH_SECRET",
    breaks: "sessions cannot be signed; nobody can sign in",
    fatal: true,
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    alternatives: ["NEXTAUTH_URL", "AUTH_URL"],
    breaks:
      "every outbound link — invitations, password resets, unsubscribe, click tracking, " +
      "public quotes — is built against localhost and delivered successfully to nowhere",
    fatal: true,
  },
  {
    name: "CRON_SECRET",
    breaks:
      "every scheduled job answers 500: queued email is never sent, SLA breaches are never " +
      "detected, failed webhooks are never retried, reminders never fire",
  },
  {
    name: "ADMIN_SESSION_SECRET",
    breaks: "the platform admin panel cannot issue a session, so /admin is unusable",
  },
  {
    name: "TRACKING_SECRET",
    breaks: "campaign open and click links cannot be signed or verified",
  },
];

export interface EnvCheckResult {
  missing: EnvSpec[];
  fatal: EnvSpec[];
}

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/** Returns what is missing, without throwing. */
export function checkEnv(): EnvCheckResult {
  const missing = REQUIRED.filter((spec) => {
    if (isSet(spec.name)) return false;
    return !(spec.alternatives ?? []).some(isSet);
  });

  return { missing, fatal: missing.filter((s) => s.fatal) };
}

/**
 * Logs everything missing at once, at boot.
 *
 * ⚠️ Deliberately does NOT throw, not even for a variable marked fatal.
 *
 * An earlier version did, and the cure was worse than the disease: a missing
 * `NEXT_PUBLIC_APP_URL` costs wrong links in outgoing email, while refusing to
 * boot costs the customer their entire CRM. It is also the wrong place to fail —
 * it surfaces as a deploy that starts and immediately dies, with the cause buried
 * in a boot log nobody reads until something is already down.
 *
 * Each variable is enforced where it is used instead, by the code that would
 * otherwise do the wrong thing quietly: `getAppUrl()` refuses to invent an origin,
 * `verifyCronRequest` fails closed, `decryptDbUrl` cannot decrypt. Those failures
 * name the operation that could not be completed and leave the rest working.
 */
export function reportEnv(): void {
  const { missing, fatal } = checkEnv();
  if (missing.length === 0) return;

  const lines = missing.map((spec) => {
    const alt = spec.alternatives?.length ? ` (or ${spec.alternatives.join(" / ")})` : "";
    return `  ${spec.fatal ? "✗" : "!"} ${spec.name}${alt}\n      without it: ${spec.breaks}`;
  });

  const header = `[env] ${missing.length} environment variable${missing.length === 1 ? " is" : "s are"} not set:`;
  const footer = "  See .env.example — each entry says what stops working.";
  const report = [header, ...lines, footer].join("\n");

  // Fatal ones go to error, so they show up in a platform log that surfaces
  // errors by default and warnings only on request.
  if (fatal.length > 0) console.error(report);
  else console.warn(report);
}

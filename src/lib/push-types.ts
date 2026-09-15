/**
 * Which notifications are worth waking a phone for, and how a person changes
 * that.
 *
 * ⚠️ Not every notification should push. The product writes twelve kinds, and a
 * push for each one — every chat message, every note — is how a person ends up
 * turning the whole feature off, at which point the SLA breach at 3am does not
 * reach them either. So the catalogue below is opinionated: the six that mean
 * "something now needs you" default to on, the rest default to off, and all of
 * them can be changed.
 *
 * A pure module on purpose: the settings screen, the server action that saves a
 * choice and the send path all read the same table, which is what stops the
 * three of them drifting into three different ideas of what is enabled.
 */

/** The notification types this product writes, and whether they push by default. */
export const PUSH_TYPES = {
  lead_assigned: { defaultOn: true },
  task_due: { defaultOn: true },
  sla_breach: { defaultOn: true },
  sla_warning: { defaultOn: true },
  contract_renewal: { defaultOn: true },
  sequence_reply: { defaultOn: true },
  deal_won: { defaultOn: false },
  quote_approval_requested: { defaultOn: false },
  quote_approved: { defaultOn: false },
  quote_rejected: { defaultOn: false },
  chat_message: { defaultOn: false },
  direct: { defaultOn: false },
  group: { defaultOn: false },
  note: { defaultOn: false },
} as const;

export type PushType = keyof typeof PUSH_TYPES;

/** The catalogue in the order the settings screen lists it: on by default first. */
export const PUSH_TYPE_ORDER = (Object.keys(PUSH_TYPES) as PushType[]).sort((a, b) => {
  const byDefault = Number(PUSH_TYPES[b].defaultOn) - Number(PUSH_TYPES[a].defaultOn);
  return byDefault !== 0 ? byDefault : a.localeCompare(b);
});

export function isPushType(value: string): value is PushType {
  return Object.hasOwn(PUSH_TYPES, value);
}

/**
 * What is stored: the master switch, plus only the choices a person actually
 * made.
 *
 * ⚠️ Overrides rather than a complete list, so that adding a thirteenth
 * notification type does not silently arrive switched off for everyone who ever
 * opened this screen. A stored list would freeze the defaults on the day it was
 * saved; an override map leaves the new type at whatever the catalogue says.
 */
export interface PushPreferences {
  enabled: boolean;
  overrides: Partial<Record<PushType, boolean>>;
}

export const DEFAULT_PREFERENCES: PushPreferences = { enabled: true, overrides: {} };

/**
 * Reads the stored override map, tolerating anything.
 *
 * This column is written by us and read by us, but it is text holding JSON, and
 * a half-written value must not take down every notification in the workspace.
 * Anything unreadable means "no choices made", which lands on the defaults.
 */
export function parseOverrides(raw: string | null | undefined): Partial<Record<PushType, boolean>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Partial<Record<PushType, boolean>> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPushType(key) && typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Keeps only real choices, so an unknown type cannot be stored and later read. */
export function serialiseOverrides(overrides: Partial<Record<PushType, boolean>>): string {
  const clean: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (isPushType(key) && typeof value === "boolean") clean[key] = value;
  }
  return JSON.stringify(clean);
}

/**
 * The one question the send path asks.
 *
 * ⚠️ Fails closed on a type nobody catalogued. A notification type added to the
 * product without being added here does not push, which is the safe direction:
 * the notification still appears in the bell, and nobody's phone starts buzzing
 * for something no one decided should buzz.
 */
export function shouldPush(type: string, prefs: PushPreferences): boolean {
  if (!prefs.enabled) return false;
  if (!isPushType(type)) return false;
  return prefs.overrides[type] ?? PUSH_TYPES[type].defaultOn;
}

/** The state of every switch on the settings screen, defaults filled in. */
export function resolveAll(prefs: PushPreferences): Record<PushType, boolean> {
  const out = {} as Record<PushType, boolean>;
  for (const type of PUSH_TYPE_ORDER) out[type] = prefs.overrides[type] ?? PUSH_TYPES[type].defaultOn;
  return out;
}

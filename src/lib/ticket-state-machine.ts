const VALID_TRANSITIONS: Record<string, string[]> = {
  new:         ["open", "in_progress", "closed"],
  open:        ["in_progress", "waiting", "on_hold", "resolved", "closed"],
  in_progress: ["waiting", "on_hold", "resolved", "closed", "open"],
  waiting:     ["open", "in_progress", "on_hold", "resolved", "closed"],
  on_hold:     ["open", "in_progress", "waiting", "resolved", "closed"],
  resolved:    ["open", "closed"],
  closed:      [],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isSLAPauseStatus(status: string): boolean {
  return status === "waiting" || status === "on_hold";
}

export const TICKET_STATUSES = Object.keys(VALID_TRANSITIONS);

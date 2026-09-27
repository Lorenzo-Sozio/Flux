/**
 * Which half of the home page opens: "me" (one's own numbers, the work list, the agenda) or
 * "company" (the workspace's figures and charts).
 *
 * ⚠️ The second half is the state of the business, not a team report: active leads, pipeline
 * value, open tickets. It was labelled "Team" and hidden from everybody by default, so the owner
 * of a small business — who opens the home to see exactly that — had to press a button on every
 * visit. Now the choice is remembered per browser, and with no choice yet it follows the role:
 * whoever manages every record opens on "company", everybody else on "me".
 *
 * A module of its own, not the toggle's file: a constant exported from a "use client" file
 * reaches a server component as a client reference, not as the value.
 */
export type HomeView = "me" | "company";

export const HOME_VIEW_COOKIE = "flux_home_view";

/** A view named in the address or the cookie; "team" is the old name of "company". */
export function parseHomeView(value: string | string[] | undefined): HomeView | null {
  if (value === "me") return "me";
  if (value === "company" || value === "team") return "company";
  return null;
}

/** The address wins, then the remembered choice, then the role. */
export function resolveHomeView(
  fromUrl: string | string[] | undefined,
  remembered: string | undefined,
  managesEveryRecord: boolean,
): HomeView {
  return parseHomeView(fromUrl) ?? parseHomeView(remembered) ?? (managesEveryRecord ? "company" : "me");
}

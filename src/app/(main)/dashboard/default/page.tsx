import { redirect } from "next/navigation";

/**
 * `/dashboard/default` — the address the starting template used, kept as a
 * redirect and nothing else.
 *
 * The page it used to render came from that template: section cards and an
 * interactive area chart fed by a `data.json` of invented figures. None of it
 * ever showed anything about a workspace, and the components sat on disk for
 * months behind a commented-out block — imported by nothing, read by nobody, and
 * still counted whenever somebody asked how large this codebase was.
 *
 * The redirect stays because old bookmarks and links point here. The template
 * does not.
 */
export default function DefaultDashboardPage() {
  redirect("/dashboard/crm");
}

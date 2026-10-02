import { ENTITIES, type EntityDef } from "@/lib/entities";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

/** Where the app opens, and where Back ends before leaving it. */
export const HOME_PATH = "/dashboard/crm";

export type Place = { url: string; titleKey: string; parent?: string };

/** Every place the menu names, sub-items with their parent. */
const PLACES: Place[] = sidebarItems.flatMap((group) =>
  group.items.flatMap((item) => [
    { url: item.url, titleKey: item.titleKey },
    ...(item.subItems ?? []).map((sub) => ({ url: sub.url, titleKey: sub.titleKey, parent: item.url })),
  ]),
);

/**
 * Where a page sits in the menu: the place it is or is under, the kind of record it shows, and the
 * page above it — what the top bar's back arrow opens, and what the phone's Back goes to.
 *
 * - A place in the menu: its parent if it is a sub-item (Pipeline › Forecast), else nothing above.
 * - A page *below* a place (a contact, an invoice, a settings page the menu does not list): that place.
 *
 * Read from the unfiltered menu, for naming and for the way back only — never for access: a page
 * that is open was already allowed by the server.
 */
export function locate(pathname: string): { place: Place | null; entity: EntityDef | null; above: string | null } {
  const place =
    PLACES.filter((p) => pathname === p.url || pathname.startsWith(`${p.url}/`)).sort(
      (a, b) => b.url.length - a.url.length,
    )[0] ?? null;
  if (!place) return { place: null, entity: null, above: null };
  if (pathname !== place.url) {
    const entity =
      ENTITIES.filter((e) => pathname.startsWith(`${e.list}/`)).sort((a, b) => b.list.length - a.list.length)[0] ??
      null;
    return { place, entity, above: place.url };
  }
  return { place, entity: null, above: place.parent ?? null };
}

/** The page above `pathname`, or null when it has none. */
export function backTargetOf(pathname: string): string | null {
  return locate(pathname).above;
}

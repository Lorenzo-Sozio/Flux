"use client";

import { useMemo } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { APP_CONFIG } from "@/config/app-config";
import { ENTITIES } from "@/lib/entities";
import { cn } from "@/lib/utils";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

type Place = { url: string; titleKey: string; parent?: string };

/** Every place the menu names, sub-items with their parent. */
const PLACES: Place[] = sidebarItems.flatMap((group) =>
  group.items.flatMap((item) => [
    { url: item.url, titleKey: item.titleKey },
    ...(item.subItems ?? []).map((sub) => ({ url: sub.url, titleKey: sub.titleKey, parent: item.url })),
  ]),
);

/**
 * The left of the phone's top bar: where you are, and the way back.
 *
 * It used to say "Flux" on every screen — true, and no help. Installed, the app
 * has no address bar and no tab title, so this is the only thing that says which
 * page is open; and a record's page, reached from a list, had no way back but
 * the browser's own gesture, which an installed app on iOS does not have.
 *
 * - A place in the menu shows its name.
 * - A place *below* one (a contact, an invoice, a settings page the menu does
 *   not list) shows what it is and a back arrow to the place above it.
 * - A menu sub-item (Pipeline › Forecast) shows its name and goes back to its parent.
 *
 * Read from the menu itself — the unfiltered list only for naming, never for
 * access: a page that is open was already allowed by the server.
 */
export function MobilePageTitle({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const te = useTranslations("entities");
  const tm = useTranslations("nav.mobile");

  const { title, back } = useMemo(() => {
    const match = PLACES.filter((p) => pathname === p.url || pathname.startsWith(`${p.url}/`)).sort(
      (a, b) => b.url.length - a.url.length,
    )[0];
    if (!match) return { title: APP_CONFIG.name, back: null as string | null };

    if (pathname !== match.url) {
      // Below a listed place: a record, or a page the menu does not list.
      const entity = ENTITIES.filter((e) => pathname.startsWith(`${e.list}/`)).sort(
        (a, b) => b.list.length - a.list.length,
      )[0];
      const title = entity ? te(`types.${entity.type}.one` as never) : t(`items.${match.titleKey}` as never);
      return { title, back: match.url };
    }
    return { title: t(`items.${match.titleKey}` as never), back: match.parent ?? null };
  }, [pathname, t, te]);

  return (
    <div className={cn("flex min-w-0 items-center gap-0.5", className)}>
      {back && (
        <Link
          href={back}
          prefetch={false}
          aria-label={tm("back")}
          className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-md text-foreground active:bg-muted"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
      )}
      <span className={cn("truncate font-semibold text-base", !back && "pl-1")}>{title}</span>
    </div>
  );
}

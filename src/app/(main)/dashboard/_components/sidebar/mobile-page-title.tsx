"use client";

import { useMemo } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { APP_CONFIG } from "@/config/app-config";
import { cn } from "@/lib/utils";
import { locate } from "@/navigation/back-target";

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
 * ⚠️ The way back is `locate` (src/navigation/back-target.ts), the same the phone's Back button
 * follows (src/lib/back-plan.ts): the arrow and the button must never disagree.
 */
export function MobilePageTitle({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const te = useTranslations("entities");
  const tm = useTranslations("nav.mobile");

  const { title, back } = useMemo(() => {
    const { place, entity, above } = locate(pathname);
    if (!place) return { title: APP_CONFIG.name, back: null as string | null };
    // Below a listed place, a record names its kind; anything else, the place.
    const title = entity ? te(`types.${entity.type}.one` as never) : t(`items.${place.titleKey}` as never);
    return { title, back: above };
  }, [pathname, t, te]);

  return (
    <div className={cn("flex min-w-0 items-center gap-0.5", className)}>
      {back && (
        <Link
          href={back}
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

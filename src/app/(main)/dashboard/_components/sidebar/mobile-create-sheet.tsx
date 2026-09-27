"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { entityIcon, GROUP_TINT } from "@/components/crm/entity-icon";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ENTITIES, ENTITY_GROUPS, type EntityType } from "@/lib/entities";
import { cn } from "@/lib/utils";

/**
 * The bottom bar's create button, opened: everything this person may create,
 * with the kind of record they are looking at first.
 *
 * The same list as quick create in the sidebar — `creatable`, decided on the
 * server from role and plan — laid out for a thumb: a large "New contact" when
 * you are in contacts, and a grid of the rest below it.
 */
export function MobileCreateSheet({
  open,
  onOpenChange,
  creatable,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creatable: readonly EntityType[];
}) {
  const te = useTranslations("entities");
  const t = useTranslations("nav.mobile");
  const pathname = usePathname();
  const allowed = new Set(creatable);
  const entries = ENTITIES.filter((e) => e.create && allowed.has(e.type));
  // The section you are in decides the first suggestion: the longest list path
  // that the current page sits under.
  const here = entries
    .filter((e) => pathname === e.list || pathname.startsWith(`${e.list}/`))
    .sort((a, b) => b.list.length - a.list.length)[0];
  const sections = ENTITY_GROUPS.map((group) => ({
    group,
    items: entries.filter((e) => e.group === group),
  })).filter((s) => s.items.length > 0);

  const close = () => onOpenChange(false);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[88dvh] pb-[var(--safe-bottom)]">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className="font-semibold text-lg">{t("createTitle")}</DrawerTitle>
          <DrawerDescription>{entries.length > 0 ? te("quickCreate.hint") : te("quickCreate.none")}</DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {here && (
            <Link
              href={here.create?.href ?? here.list}
              prefetch={false}
              onClick={close}
              className="mb-4 flex min-h-14 items-center gap-3 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm active:bg-primary/90"
            >
              <Plus className="size-5 shrink-0" aria-hidden />
              <span className="font-semibold">{te(`types.${here.type}.new` as never)}</span>
            </Link>
          )}

          <div className="space-y-4">
            {sections.map(({ group, items }) => (
              <section key={group} aria-labelledby={`create-${group}`}>
                <h3
                  id={`create-${group}`}
                  className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                >
                  {te(`groups.${group}` as never)}
                </h3>
                <ul className="grid grid-cols-3 gap-2">
                  {items.map((e) => {
                    const Icon = entityIcon(e.type);
                    return (
                      <li key={e.type}>
                        <Link
                          href={e.create?.href ?? e.list}
                          prefetch={false}
                          onClick={close}
                          aria-label={te(`types.${e.type}.new` as never)}
                          className={cn(
                            "flex h-full min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-2 text-center transition-colors active:bg-muted",
                            here?.type === e.type && "border-primary/50",
                          )}
                        >
                          <span
                            className={cn("flex size-9 items-center justify-center rounded-lg", GROUP_TINT[group])}
                            aria-hidden
                          >
                            <Icon className="size-4.5" />
                          </span>
                          <span className="line-clamp-2 font-medium text-xs leading-tight">
                            {te(`types.${e.type}.one` as never)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

"use client";

import { type ReactNode, useMemo, useState } from "react";

import { usePathname } from "next/navigation";

import { ArrowLeftRight, Check, ChevronRight, Lock, LogOut, Pencil, RotateCcw, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { logoutAction } from "@/actions/auth";
import { ChatUnreadBadge } from "@/components/chat/chat-unread-badge";
import { IntentLink as Link } from "@/components/intent-link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CurrencySwitcher } from "@/components/ui/currency-switcher";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { cn, getInitials } from "@/lib/utils";
import {
  accountPlacement,
  MOBILE_TAB_SLOTS,
  mobileTabCandidates,
  type NavGroup,
  type NavMainItem,
  sidebarPlacement,
} from "@/navigation/sidebar/sidebar-items";

import { MobileThemePicker } from "./mobile-theme-picker";
import { lockHref } from "./nav-main";
import { OPEN_SEARCH_EVENT } from "./search-dialog";

function isHere(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(`${url}/`);
}

/**
 * The phone's navigation hub, opened from the Menu slot of the bottom bar.
 *
 * It replaces the desktop sidebar squeezed into a left-hand drawer, which was
 * opened from the top-left corner — the hardest place on the glass to reach —
 * and listed forty lines to scroll through. Here every section is a tile in a
 * grid, grouped as in the sidebar, its reports as chips underneath; the account,
 * the search and the preferences a phone had no way to reach (language and
 * currency were desktop-only) sit at the top and bottom.
 *
 * ⚠️ It renders the menu the layout already filtered for role and plan — the
 * same `groups` the sidebar gets — and adds no rule of its own. Locked modules
 * show as locked and lead to the plans, as in the sidebar.
 */
export function MobileMenuHub({
  open,
  onOpenChange,
  groups,
  scopeToggle,
  user,
  pinned,
  onPin,
  currentTabs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly NavGroup[];
  /** "Show all sections", for a person whose menu leaves some out. */
  scopeToggle?: ReactNode;
  user: { name?: string | null; email?: string | null; image?: string | null };
  pinned: string[] | null;
  onPin: (urls: string[] | null) => void;
  currentTabs: readonly NavMainItem[];
}) {
  const t = useTranslations("nav");
  const tm = useTranslations("nav.mobile");
  const tu = useTranslations("nav.user");
  const ts = useTranslations("search");
  const pathname = usePathname();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const mainGroups = useMemo(() => sidebarPlacement(groups), [groups]);
  const accountGroups = useMemo(() => accountPlacement(groups), [groups]);
  const candidates = useMemo(() => mobileTabCandidates(groups), [groups]);

  const close = () => {
    setEditing(false);
    onOpenChange(false);
  };
  const label = (key: string) => t(`items.${key}` as never);
  const userName = user?.name || tu("unknownUser");

  const startEditing = () => {
    setDraft(currentTabs.map((tab) => tab.url));
    setEditing(true);
  };
  const toggle = (url: string) =>
    setDraft((d) => (d.includes(url) ? d.filter((u) => u !== url) : d.length < MOBILE_TAB_SLOTS ? [...d, url] : d));

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => {
        if (!v) setEditing(false);
        onOpenChange(v);
      }}
    >
      <DrawerContent className="max-h-[92dvh] pb-[var(--safe-bottom)]">
        <DrawerTitle className="sr-only">{tm("menuTitle")}</DrawerTitle>
        <DrawerDescription className="sr-only">{tm("menuDescription")}</DrawerDescription>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
          {editing ? (
            /* ── Choosing the shortcuts ─────────────────────────────────────── */
            <section aria-labelledby="hub-shortcuts-edit">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 id="hub-shortcuts-edit" className="font-semibold text-base">
                  {tm("shortcutsTitle")}
                </h2>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {draft.length}/{MOBILE_TAB_SLOTS}
                </span>
              </div>
              <p className="mb-3 text-muted-foreground text-sm">{tm("shortcutsHint", { count: MOBILE_TAB_SLOTS })}</p>
              <ul className="divide-y rounded-xl border">
                {candidates.map((item) => {
                  const position = draft.indexOf(item.url);
                  const chosen = position !== -1;
                  const full = !chosen && draft.length >= MOBILE_TAB_SLOTS;
                  return (
                    <li key={item.url}>
                      <button
                        type="button"
                        onClick={() => toggle(item.url)}
                        disabled={full}
                        aria-pressed={chosen}
                        className="flex min-h-12 w-full items-center gap-3 px-3 text-left disabled:opacity-40"
                      >
                        {item.icon && <item.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
                        <span className="min-w-0 flex-1 truncate text-sm">{label(item.titleKey)}</span>
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full border font-semibold text-xs",
                            chosen ? "border-primary bg-primary text-primary-foreground" : "text-transparent",
                          )}
                          aria-hidden
                        >
                          {chosen ? position + 1 : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => {
                    onPin(null);
                    setEditing(false);
                  }}
                >
                  <RotateCcw className="size-4" />
                  {tm("shortcutsReset")}
                </Button>
                <Button
                  type="button"
                  className="gap-1.5"
                  disabled={draft.length === 0}
                  onClick={() => {
                    onPin(draft);
                    setEditing(false);
                  }}
                >
                  <Check className="size-4" />
                  {tm("shortcutsDone")}
                </Button>
              </div>
            </section>
          ) : (
            <>
              {/* ── Who, and search ──────────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <Avatar className="size-11 rounded-xl">
                  <AvatarImage src={user?.image ?? undefined} alt={userName} />
                  <AvatarFallback className="rounded-xl">{getInitials(userName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{userName}</p>
                  {user?.email && <p className="truncate text-muted-foreground text-xs">{user.email}</p>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  close();
                  // After the drawer has let go of focus, or the palette opens behind it.
                  window.setTimeout(() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)), 250);
                }}
                className="mt-4 flex h-11 w-full items-center gap-2 rounded-xl border bg-muted/40 px-3 text-left text-muted-foreground text-sm"
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{ts("placeholder")}</span>
              </button>

              {/* ── The bar's shortcuts ──────────────────────────────────────── */}
              <div className="mt-4 flex items-center gap-2 rounded-xl border p-2 pl-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{tm("shortcutsTitle")}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {currentTabs.map((tab) => label(tab.titleKey)).join(" · ")}
                    {pinned ? "" : ` · ${tm("shortcutsDefault")}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5"
                  onClick={startEditing}
                >
                  <Pencil className="size-3.5" />
                  {tm("shortcutsEdit")}
                </Button>
              </div>

              {/* ── Every section ────────────────────────────────────────────── */}
              <nav aria-label={tm("menuTitle")} className="mt-5 space-y-5">
                {mainGroups.map((group) => {
                  const chips = group.items.flatMap((item) => (item.locked ? [] : (item.subItems ?? [])));
                  return (
                    <section key={group.id} aria-labelledby={`hub-group-${group.id}`}>
                      {group.labelKey && (
                        <h2
                          id={`hub-group-${group.id}`}
                          className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                        >
                          {t(`groups.${group.labelKey}` as never)}
                        </h2>
                      )}
                      <ul className="grid grid-cols-3 gap-2">
                        {group.items.map((item) => {
                          const active = isHere(pathname, item.url);
                          return (
                            <li key={item.url}>
                              <Link
                                href={item.locked ? lockHref(item.lockedModule) : item.url}
                                onClick={close}
                                aria-current={active ? "page" : undefined}
                                aria-label={item.locked ? t("notInPlan", { title: label(item.titleKey) }) : undefined}
                                className={cn(
                                  "relative flex h-full min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition-colors active:bg-muted",
                                  active ? "border-primary/50 bg-primary/5 text-primary" : "bg-card",
                                  item.locked && "opacity-60",
                                )}
                              >
                                {item.icon && <item.icon className="size-5" aria-hidden />}
                                <span className="line-clamp-2 font-medium text-xs leading-tight">
                                  {label(item.titleKey)}
                                </span>
                                {!item.locked && (
                                  <ChatUnreadBadge url={item.url} className="absolute top-1.5 right-1.5 ml-0" />
                                )}
                                {item.locked && (
                                  <Lock
                                    className="absolute top-1.5 right-1.5 size-3 text-muted-foreground"
                                    aria-hidden
                                  />
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                      {chips.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {chips.map((sub) => (
                            <li key={sub.url}>
                              <Link
                                href={sub.locked ? lockHref(sub.lockedModule) : sub.url}
                                onClick={close}
                                aria-current={pathname === sub.url ? "page" : undefined}
                                className={cn(
                                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs",
                                  pathname === sub.url ? "border-primary/50 text-primary" : "text-muted-foreground",
                                  sub.locked && "opacity-60",
                                )}
                              >
                                {sub.icon && <sub.icon className="size-3.5" aria-hidden />}
                                {label(sub.titleKey)}
                                {sub.locked && <Lock className="size-3" aria-hidden />}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}

                {scopeToggle}

                {/* ── Administration: rows, as they are read less often ──────── */}
                {accountGroups.map((group) => (
                  <section key={group.id} aria-labelledby={`hub-group-${group.id}`}>
                    {group.labelKey && (
                      <h2
                        id={`hub-group-${group.id}`}
                        className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                      >
                        {t(`groups.${group.labelKey}` as never)}
                      </h2>
                    )}
                    <ul className="divide-y rounded-xl border">
                      {group.items.map((item) => (
                        <li key={item.url}>
                          <Link
                            href={item.locked ? lockHref(item.lockedModule) : item.url}
                            onClick={close}
                            aria-current={isHere(pathname, item.url) ? "page" : undefined}
                            className={cn("flex min-h-12 items-center gap-3 px-3", item.locked && "opacity-60")}
                          >
                            {item.icon && <item.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
                            <span className="min-w-0 flex-1 truncate text-sm">{label(item.titleKey)}</span>
                            {!item.locked && <ChatUnreadBadge url={item.url} className="ml-0" />}
                            {item.locked ? (
                              <Lock className="size-3.5 text-muted-foreground" aria-hidden />
                            ) : (
                              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {group.items.some((item) => item.subItems?.length) && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {group.items
                          .flatMap((item) => (item.locked ? [] : (item.subItems ?? [])))
                          .map((sub) => (
                            <li key={sub.url}>
                              <Link
                                href={sub.locked ? lockHref(sub.lockedModule) : sub.url}
                                onClick={close}
                                className={cn(
                                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-muted-foreground text-xs",
                                  sub.locked && "opacity-60",
                                )}
                              >
                                {sub.icon && <sub.icon className="size-3.5" aria-hidden />}
                                {label(sub.titleKey)}
                              </Link>
                            </li>
                          ))}
                      </ul>
                    )}
                  </section>
                ))}
              </nav>

              {/* ── Preferences a phone could not reach before ───────────────── */}
              <section aria-labelledby="hub-prefs" className="mt-5">
                <h2
                  id="hub-prefs"
                  className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                >
                  {tm("preferences")}
                </h2>
                <ul className="divide-y rounded-xl border">
                  <li className="flex min-h-12 items-center justify-between gap-3 px-3">
                    <span className="text-sm">{tm("language")}</span>
                    <LocaleSwitcher />
                  </li>
                  <li className="flex min-h-12 items-center justify-between gap-3 px-3">
                    <span className="text-sm">{tm("currency")}</span>
                    <CurrencySwitcher />
                  </li>
                  <li>
                    <p className="px-3 pt-3 text-sm">{tm("theme")}</p>
                    <MobileThemePicker />
                  </li>
                </ul>
              </section>

              {/* ── Leaving ─────────────────────────────────────────────────── */}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-11 gap-2" asChild>
                  <Link href="/select-tenant" onClick={close}>
                    <ArrowLeftRight className="size-4" />
                    <span className="truncate">{tm("switchWorkspace")}</span>
                  </Link>
                </Button>
                <form action={logoutAction}>
                  <Button type="submit" variant="outline" className="h-11 w-full gap-2 text-destructive">
                    <LogOut className="size-4" />
                    <span className="truncate">{tu("logout")}</span>
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

"use client";

import { Menu, PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * The control that opens the navigation panel.
 *
 * ⚠️ It replaces the shadcn `SidebarTrigger`, which draws a panel-left glyph
 * and calls itself "Toggle Sidebar" in an sr-only span — in English, whatever
 * the workspace's language. On a desktop that glyph is right: the sidebar is
 * visible and the button collapses it, so it describes what will happen. On a
 * phone there is no sidebar to collapse, the icon means nothing, and the thing
 * people look for is three lines.
 *
 * So: a hamburger below md and the panel glyph from md up, one button, and a
 * name in the reader's own language rather than a hidden English one.
 */
export function MenuTrigger() {
  const { toggleSidebar, openMobile } = useSidebar();
  const t = useTranslations("nav");

  return (
    <Button
      variant="ghost"
      size="icon"
      data-slot="sidebar-trigger"
      className="-ml-1 shrink-0"
      aria-label={t("openMenu")}
      aria-expanded={openMobile}
      onClick={toggleSidebar}
    >
      <Menu className="md:hidden" />
      <PanelLeft className="hidden md:block" />
    </Button>
  );
}

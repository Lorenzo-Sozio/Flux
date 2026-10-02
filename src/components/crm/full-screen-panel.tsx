"use client";

import type { ReactNode } from "react";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A panel that fills a phone's screen, as the search does: a fixed header with the title and one
 * action, a list that scrolls, an optional footer. For what opens from the top bar — the bell, the
 * recents — whose dropdown on a desktop was a 320px box with a 320px list on a phone: a third of
 * the screen, targets a finger misses, and the rest of the page still under it to tap by mistake.
 *
 * ⚠️ Built on the Dialog, which below `sm` already takes the whole screen between the safe-area
 * insets and always draws its close button (top right: the header leaves room for it).
 *
 * ⚠️ The list is the scroll box, not the dialog: header and footer sit at its two ends and never
 * move. They used to be `sticky` inside the dialog's own scroll box, where the footer (the
 * notifications' "Notification settings") scrolled away with the list.
 */
export function FullScreenPanel({
  open,
  onOpenChange,
  title,
  description,
  action,
  footer,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** What the panel is, for screen readers: the title says it to everybody else. */
  description: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const tc = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ownCloseButton className={cn("gap-0 p-0 sm:h-[min(640px,calc(100dvh-4rem))] sm:p-0", className)}>
        {/* ⚠️ The close button is the header's own, centred with the title and the action: the
            dialog's default one is pinned 12px from the top, and on a touchscreen — where every
            control grows to 44px — it sat lower than everything beside it. */}
        <div className="z-10 flex min-h-14 shrink-0 items-center gap-2 border-b bg-background py-2 pr-2 pl-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription className="sr-only">{description}</DialogDescription>
          </div>
          {action}
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={tc("close")} className="shrink-0">
              <XIcon />
            </Button>
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="shrink-0 border-t bg-background">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

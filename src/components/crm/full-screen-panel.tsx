"use client";

import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A panel that fills a phone's screen, as the search does: a fixed header with the title and one
 * action, a list that scrolls, an optional footer. For what opens from the top bar — the bell, the
 * recents — whose dropdown on a desktop was a 320px box with a 320px list on a phone: a third of
 * the screen, targets a finger misses, and the rest of the page still under it to tap by mistake.
 *
 * ⚠️ Built on the Dialog, which below `sm` already takes the whole screen between the safe-area
 * insets and always draws its close button (top right: the header leaves room for it). The header
 * and footer are sticky inside the dialog's own scroll box, so the list is what scrolls.
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("gap-0 p-0 sm:h-[min(640px,calc(100dvh-4rem))] sm:p-0", className)}>
        <div className="sticky top-0 z-10 flex min-h-14 shrink-0 items-center gap-2 border-b bg-background py-2 pr-14 pl-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription className="sr-only">{description}</DialogDescription>
          </div>
          {action}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
        {footer && <div className="sticky bottom-0 shrink-0 border-t bg-background">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

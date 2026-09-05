"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // ── Shared ──────────────────────────────────────────────────────────
          "fixed z-50 flex flex-col bg-background text-sm ring-1 ring-foreground/10 duration-100 outline-none",
          // ⚠️ The height cap is `dvh`, not `vh`. On iOS Safari `100vh` is the
          // window *without* the address bar, so a dialog capped at 90vh is
          // taller than the screen and its buttons sit under the toolbar, where
          // they cannot be tapped. There was no cap at all before this, and
          // eighteen dialogs had each grown their own — all of them in `vh`.
          "max-h-[100dvh]",
          // ── Phone: the whole screen ────────────────────────────────────────
          // Nearly every dialog in this product is a form, and a form on a
          // 375px screen wants the width. Full screen also settles the virtual
          // keyboard question: the content is an ordinary scroll container
          // filling the viewport, so the browser scrolls the focused field into
          // view by itself. A sheet pinned to `bottom-0` does not have that
          // property — the keyboard opens underneath it and the fields at the
          // bottom become unreachable on iOS.
          "inset-0 w-full rounded-none p-5",
          "pt-[calc(1.25rem+var(--safe-top))] pb-[calc(1.25rem+var(--safe-bottom))]",
          "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-4",
          // ── Tablet and up: the centred box it has always been ──────────────
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:max-h-[calc(100dvh-4rem)] sm:rounded-xl sm:p-6",
          "sm:data-open:zoom-in-95 sm:data-open:slide-in-from-bottom-0 sm:data-closed:zoom-out-95 sm:data-closed:slide-out-to-bottom-0",
          className
        )}
        {...props}
      >
        {/* ⚠️ The scroll lives here, not on the content box, so the close button
            outside it stays put instead of scrolling away from a long form.
            `gap-6` moves in with the children it was spacing. */}
        <div className="-mx-5 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 sm:-mx-6 sm:px-6">
          {children}
        </div>
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3 sm:top-4 sm:right-4"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

"use client";

import { Lock, Send, Shield, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import { RichTextEditor } from "@/components/crm/rich-text-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { TicketMacro } from "./ticket-shared";

/** The element the hero's Reply button brings into view and types into. */
export const COMPOSER_ID = "ticket-composer";

/**
 * The reply box: a public reply or an internal note, a saved reply to start from,
 * Ctrl+Enter to send.
 *
 * The draft lives in the parent, not here, because the triage card beside the
 * thread fills it too (with a suggested macro), and both must write to the same
 * draft rather than to two.
 */
export function TicketComposer({
  ticketId,
  value,
  onChange,
  isInternal,
  onInternalChange,
  macros,
  onApplyMacro,
  onSend,
  sending,
}: {
  ticketId: string;
  value: string;
  onChange: (html: string) => void;
  isInternal: boolean;
  onInternalChange: (internal: boolean) => void;
  macros: TicketMacro[];
  onApplyMacro: (macro: TicketMacro) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const t = useTranslations("support.tickets");
  const isEmpty = !value.trim() || value === "<p></p>";

  return (
    <div
      id={COMPOSER_ID}
      // `data-bottom-composer` tells the floating chat bubble that the bottom-right
      // corner is taken (chat-widget.tsx): on a phone it sat on the Send button.
      data-bottom-composer=""
      className={cn(
        "scroll-mt-20 space-y-2 border-t p-3 sm:space-y-3 sm:p-4",
        isInternal ? "bg-amber-50/40 dark:bg-amber-950/10" : "bg-card",
      )}
    >
      {/* Public / Internal toggle */}
      <div className="flex w-fit items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
        {[
          { val: false, icon: Send, label: t("detail.publicReply") },
          { val: true, icon: Lock, label: t("internalNote") },
        ].map(({ val, icon: Icon, label }) => (
          <button
            key={String(val)}
            type="button"
            aria-pressed={isInternal === val}
            onClick={() => onInternalChange(val)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-sm transition-all sm:py-1",
              isInternal === val
                ? val
                  ? "bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Editor.
          The wrapper carries the Ctrl+Enter shortcut for the editor inside it;
          it is not itself a control, and giving it a role or a tab stop would
          put an extra, meaningless stop in the tab order. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcut for the focusable editor within */}
      <div
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === "Enter") {
            e.preventDefault();
            onSend();
          }
        }}
      >
        <RichTextEditor
          value={value}
          onChange={(html) => {
            onChange(html);
            fetch(`/api/tickets/${ticketId}/presence`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "typing" }),
              // A failed presence ping must not interrupt the agent's reply.
              // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
            }).catch(() => {});
          }}
          placeholder={isInternal ? t("detail.internalNotePlaceholder") : t("detail.replyPlaceholder")}
          className={cn(
            isInternal && "border-amber-300 dark:border-amber-700",
            // ⚠️ Below lg the editor is sized for the space under a thread,
            // not for a page of its own. Its 200px writing area and a
            // toolbar that wrapped to four rows came to 330px, and on a
            // phone the conversation above it was left about 50px tall. The
            // toolbar becomes one row that scrolls sideways and the writing
            // area starts small and grows up to a third of the screen.
            // These reach inside RichTextEditor (toolbar = first child,
            // `.ProseMirror` = the editable), which is why they say so.
            "max-lg:[&>div:first-child>*]:shrink-0 max-lg:[&>div:first-child]:flex-nowrap max-lg:[&>div:first-child]:overflow-x-auto",
            "max-lg:[&_.ProseMirror]:max-h-[30dvh] max-lg:[&_.ProseMirror]:min-h-20 max-lg:[&_.ProseMirror]:overflow-y-auto",
          )}
          macroVariables
        />
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
          {isInternal ? (
            <>
              <Shield className="h-3 w-3 shrink-0" /> {t("agentsOnly")}
            </>
          ) : (
            // A phone has no Ctrl key: the hint only costs it the width
            // the three buttons beside it need.
            <span className="pointer-coarse:hidden">{t("detail.ctrlEnterHint")}</span>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {macros.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 sm:h-8">
                  <Zap className="h-3.5 w-3.5" /> {t("macro")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-60 w-52 overflow-y-auto">
                {macros.map((macro) => (
                  <DropdownMenuItem
                    key={macro.id}
                    className="flex flex-col items-start gap-0.5 py-2"
                    onClick={() => onApplyMacro(macro)}
                  >
                    <span className="font-medium text-sm">{macro.name}</span>
                    {macro.description && (
                      <span className="w-full truncate text-muted-foreground text-xs">{macro.description}</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 sm:h-8"
            onClick={() => onChange("<p></p>")}
            disabled={isEmpty}
          >
            {t("clear")}
          </Button>
          <Button size="sm" className="h-9 gap-1.5 sm:h-8" onClick={onSend} disabled={isEmpty || sending}>
            <Send className="h-3.5 w-3.5" />
            {sending ? t("detail.sending") : isInternal ? t("detail.addNote") : t("detail.sendReply")}
          </Button>
        </div>
      </div>
    </div>
  );
}

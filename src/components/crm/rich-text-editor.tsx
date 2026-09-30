"use client";

import { useEffect } from "react";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PLACEHOLDERS } from "@/lib/email-placeholders";
import { cn } from "@/lib/utils";

interface Props {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  className?: string;
  macroVariables?: boolean;
  /**
   * "email": the toolbar of an email written to one person — text formatting, lists, quote and
   * link, with the recipient's fields in one menu. No headings, alignment or code block: an
   * email with an H1 in it reads as a newsletter. Every other screen keeps "full".
   */
  variant?: "full" | "email";
  /** Classes for the editable area, e.g. its height. */
  editorClassName?: string;
}

type ToolbarButtonProps = {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
};

function ToolbarButton({ onClick, active, disabled, label, children }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className="size-9 shrink-0 sm:size-7"
          onClick={onClick}
          aria-label={label}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// Three of the eight, hand-written here and nowhere documented, so anyone wanting
// the other five had to guess — and a wrong guess ships to a customer verbatim
// (audit rilievo S-08). The catalogue is the list now.
// ⚠️ The recipient's and the unsubscribe link only: a campaign or a sequence has no sender or deal
// to fill the others with, and would send them as typed.
const EMAIL_VARS = PLACEHOLDERS.filter((p) => p.scope === "recipient" || p.scope === "campaign").map(
  (p) => `{{${p.aliases[0]}}}`,
);
/** A one-to-one email's fields, grouped as the menu shows them; no unsubscribe link in one. */
const ONE_TO_ONE_GROUPS = (["recipient", "sender", "deal", "document"] as const).map((scope) => ({
  scope,
  fields: PLACEHOLDERS.filter((p) => p.scope === scope),
}));
const MACRO_VARS = ["{ticket.number}", "{contact.firstName}", "{agent.name}"];

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  macroVariables = false,
  variant = "full",
  editorClassName,
}: Props) {
  const full = variant === "full";
  const t = useTranslations("marketing.richTextEditor");
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
      Placeholder.configure({ placeholder: placeholder ?? t("defaultPlaceholder") }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn("prose prose-sm dark:prose-invert max-w-none min-h-[200px] focus:outline-none p-4", editorClassName),
      },
    },
    onUpdate({ editor: e }) {
      onChange?.(e.getHTML());
    },
  });

  // Sync value when changed externally
  useEffect(() => {
    if (!editor || value === undefined) return;
    if (editor.getHTML() === value) return;
    // Use queueMicrotask to avoid React state update conflicts
    queueMicrotask(() => {
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(value ?? "", false as unknown as undefined);
      }
    });
  }, [value, editor]);

  if (!editor) return null;

  const handleLink = () => {
    const prev = editor.getAttributes("link").href ?? "";
    const url = window.prompt(t("enterUrl"), prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("rounded-md border bg-background", className)}>
        {/* Toolbar */}
        {/* ⚠️ One scrolling line below `sm`, not a wrapped block: at a thumb's 36px
            the buttons and the variable chips wrapped to four rows, a toolbar
            taller than the text box under it. */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b px-2 py-1.5 sm:flex-wrap">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            label={t("bold")}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            label={t("italic")}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            label={t("underline")}
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            label={t("strikethrough")}
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-1 h-5 shrink-0" />

          {full && (
            <>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                active={editor.isActive("heading", { level: 1 })}
                label={t("heading1")}
              >
                <Heading1 className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                active={editor.isActive("heading", { level: 2 })}
                label={t("heading2")}
              >
                <Heading2 className="h-3.5 w-3.5" />
              </ToolbarButton>

              <Separator orientation="vertical" className="mx-1 h-5 shrink-0" />

              <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("left").run()}
                active={editor.isActive({ textAlign: "left" })}
                label={t("alignLeft")}
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("center").run()}
                active={editor.isActive({ textAlign: "center" })}
                label={t("alignCenter")}
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("right").run()}
                active={editor.isActive({ textAlign: "right" })}
                label={t("alignRight")}
              >
                <AlignRight className="h-3.5 w-3.5" />
              </ToolbarButton>

              <Separator orientation="vertical" className="mx-1 h-5 shrink-0" />
            </>
          )}

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            label={t("bulletList")}
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            label={t("orderedList")}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            label={t("quote")}
          >
            <Quote className="h-3.5 w-3.5" />
          </ToolbarButton>
          {full && (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              active={editor.isActive("codeBlock")}
              label={t("code")}
            >
              <Code2 className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
          <ToolbarButton onClick={handleLink} active={editor.isActive("link")} label={t("link")}>
            <Link2 className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-1 h-5 shrink-0" />

          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            label={t("undo")}
          >
            <Undo className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            label={t("redo")}
          >
            <Redo className="h-3.5 w-3.5" />
          </ToolbarButton>

          {/* Variable chip insertions */}
          <Separator orientation="vertical" className="mx-1 h-5 shrink-0" />
          {full ? (
            <>
              <span className="shrink-0 text-[10px] text-muted-foreground">{t("variables")}</span>
              {(macroVariables ? MACRO_VARS : EMAIL_VARS).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-primary hover:text-primary-foreground"
                  onClick={() => editor.chain().focus().insertContent(v).run()}
                >
                  {v}
                </button>
              ))}
            </>
          ) : (
            // One menu, not eight chips: an email toolbar stays one line.
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-2 text-xs sm:h-7">
                  <Braces className="h-3.5 w-3.5" />
                  {t("insertField")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
                  {t("insertFieldHint")}
                </DropdownMenuLabel>
                {ONE_TO_ONE_GROUPS.map((group) => (
                  <DropdownMenuGroup key={group.scope}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">{t(`fieldGroups.${group.scope}`)}</DropdownMenuLabel>
                    {group.fields.map((p) => (
                      <DropdownMenuItem
                        key={p.key}
                        onSelect={() => editor.chain().focus().insertContent(`{{${p.aliases[0]}}}`).run()}
                      >
                        <code className="font-mono text-xs">{`{{${p.aliases[0]}}}`}</code>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Editor area */}
        <EditorContent editor={editor} />
      </div>
    </TooltipProvider>
  );
}

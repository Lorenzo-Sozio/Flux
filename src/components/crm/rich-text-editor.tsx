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

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  className?: string;
  macroVariables?: boolean;
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
          className="h-7 w-7"
          onClick={onClick}
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

const EMAIL_VARS = ["{{nome}}", "{{cognome}}", "{{email}}"];
const MACRO_VARS = ["{ticket.number}", "{contact.firstName}", "{agent.name}"];

export function RichTextEditor({ value, onChange, placeholder, className, macroVariables = false }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
      Placeholder.configure({ placeholder: placeholder ?? "Write your email content…" }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none min-h-[200px] focus:outline-none p-4",
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
    const url = window.prompt("Enter URL", prev);
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
        <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            label="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            label="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            label="Underline"
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            label="Strikethrough"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            label="Heading 1"
          >
            <Heading1 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            label="Heading 2"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            active={editor.isActive({ textAlign: "left" })}
            label="Align Left"
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            active={editor.isActive({ textAlign: "center" })}
            label="Align Center"
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            active={editor.isActive({ textAlign: "right" })}
            label="Align Right"
          >
            <AlignRight className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            label="Bullet List"
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            label="Ordered List"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            label="Quote"
          >
            <Quote className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive("codeBlock")}
            label="Code"
          >
            <Code2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={handleLink} active={editor.isActive("link")} label="Link">
            <Link2 className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            label="Undo"
          >
            <Undo className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            label="Redo"
          >
            <Redo className="h-3.5 w-3.5" />
          </ToolbarButton>

          {/* Variable chip insertions */}
          <Separator orientation="vertical" className="mx-1 h-5" />
          <span className="text-[10px] text-muted-foreground">Var:</span>
          {(macroVariables ? MACRO_VARS : EMAIL_VARS).map((v) => (
            <button
              key={v}
              type="button"
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-primary hover:text-primary-foreground transition-colors"
              onClick={() => editor.chain().focus().insertContent(v).run()}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Editor area */}
        <EditorContent editor={editor} />
      </div>
    </TooltipProvider>
  );
}

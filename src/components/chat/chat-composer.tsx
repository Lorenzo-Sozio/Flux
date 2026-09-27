"use client";

import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { AtSign, FileText, Paperclip, Send, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { sendMessage } from "@/actions/chat-internal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES } from "@/lib/upload-validation";
import { cn } from "@/lib/utils";

import { type ChatPerson, personLabel } from "./chat-message-body";

/** What the file picker offers: the server's whitelist, by type and by extension. */
const ACCEPT = [...Object.keys(ALLOWED_UPLOADS), ...Object.values(ALLOWED_UPLOADS).flat()].join(",");

/** An `@` at the start of a word, and what has been typed after it, up to the caret. */
const MENTION_TRIGGER = /(^|\s)@([^\s@]{0,30})$/u;

function initials(p: ChatPerson) {
  return (
    personLabel(p)
      .split(/[\s@.]/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

function fold(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The box a message is written in, shared by the chat page and the floating panel.
 *
 * A message is text, a file, or both. Text alone goes through the `sendMessage`
 * action; with a file it goes to `POST /api/chat/messages`, because a server action
 * takes one megabyte and a file may take ten. Both end in the same function
 * (src/lib/chat-send.ts), so the two are told, counted and marked read alike.
 *
 * In a group, `@` opens the list of its members. A mention is sent as an id, not
 * read back out of the text by the server — but only for a name still in the text
 * when it leaves, so deleting "@Anna" really takes Anna off the message.
 */
export function ChatComposer({
  conversationId,
  people,
  onSent,
  compact = false,
  autoFocus = false,
  className,
  textareaRef,
}: {
  conversationId: string;
  /** Who may be mentioned: the other members of a group. Empty turns mentions off. */
  people: ChatPerson[];
  onSent: () => void | Promise<void>;
  compact?: boolean;
  autoFocus?: boolean;
  className?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const t = useTranslations("chat");
  const format = useFormatter();
  const listId = useId();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mentions, setMentions] = useState<{ id: string; label: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setBox = (el: HTMLTextAreaElement | null) => {
    boxRef.current = el;
    if (typeof textareaRef === "function") textareaRef(el);
    else if (textareaRef) (textareaRef as { current: HTMLTextAreaElement | null }).current = el;
  };

  // A picture shows as a thumbnail before it is sent; the object URL goes with it.
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const canMention = people.length > 0;
  const matches = picker
    ? people.filter((p) => {
        const q = fold(picker.query);
        return !q || fold(personLabel(p)).includes(q) || fold(p.email ?? "").includes(q);
      })
    : [];

  const size = (bytes: number) =>
    bytes >= 1_000_000
      ? format.number(bytes / 1_000_000, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 })
      : format.number(Math.max(1, Math.round(bytes / 1000)), { style: "unit", unit: "kilobyte" });

  const readTrigger = (value: string, caret: number) => {
    if (!canMention) return;
    const m = MENTION_TRIGGER.exec(value.slice(0, caret));
    if (!m) {
      setPicker(null);
      return;
    }
    setPicker({ start: caret - m[2].length - 1, query: m[2] });
    setActive(0);
  };

  const pick = (person: ChatPerson) => {
    const box = boxRef.current;
    if (!picker || !box) return;
    const label = personLabel(person);
    const caret = box.selectionStart ?? text.length;
    const insert = `@${label} `;
    const next = text.slice(0, picker.start) + insert + text.slice(caret);
    setText(next);
    setMentions((prev) => (prev.some((m) => m.id === person.userId) ? prev : [...prev, { id: person.userId, label }]));
    setPicker(null);
    const at = picker.start + insert.length;
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(at, at);
    });
  };

  /** The `@` button: the same as typing one, for a keyboard where it is two taps away. */
  const startMention = () => {
    const box = boxRef.current;
    if (!box) return;
    const caret = box.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const insert = before === "" || /\s$/.test(before) ? "@" : " @";
    const next = before + insert + text.slice(caret);
    setText(next);
    const at = caret + insert.length;
    setPicker({ start: at - 1, query: "" });
    setActive(0);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(at, at);
    });
  };

  const choose = (candidate: File | null | undefined) => {
    if (!candidate) return;
    if (candidate.size > MAX_UPLOAD_BYTES) {
      toast.error(t("attachmentTooLarge"));
      return;
    }
    const type = candidate.type.toLowerCase();
    const ext = candidate.name.slice(candidate.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_UPLOADS[type]?.includes(ext)) {
      toast.error(t("attachmentHint"));
      return;
    }
    setFile(candidate);
    boxRef.current?.focus();
  };

  const send = async () => {
    const content = text.trim();
    if ((!content && !file) || sending) return;
    setSending(true);
    setPicker(null);
    const mentionIds = [...new Set(mentions.filter((m) => content.includes(`@${m.label}`)).map((m) => m.id))];
    try {
      if (file) {
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("content", content);
        form.set("mentionIds", JSON.stringify(mentionIds));
        form.set("file", file);
        const res = await fetch("/api/chat/messages", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || t("widget.sendFailed"));
        }
      } else {
        await sendMessage(conversationId, content, mentionIds);
      }
      setText("");
      setFile(null);
      setMentions([]);
      await onSent();
    } catch (err) {
      // What was written stays in the box: a message that did not go must not look sent.
      toast.error(err instanceof Error && file ? err.message : t("widget.sendFailed"));
    } finally {
      setSending(false);
      boxRef.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (picker && matches.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]);
        return;
      }
    }
    if (picker && e.key === "Escape") {
      e.preventDefault();
      setPicker(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.files?.[0];
    if (pasted) {
      e.preventDefault();
      choose(pasted);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    e.preventDefault();
    choose(dropped);
  };

  const pickerOpen = picker !== null;
  const activeId = pickerOpen && matches.length > 0 ? `${listId}-${Math.min(active, matches.length - 1)}` : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is a shortcut; the paperclip is the way in
    <div
      className={cn("relative shrink-0 border-t bg-background", className)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      {pickerOpen && (
        <div className="absolute inset-x-2 bottom-full z-20 mb-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <p className="border-b px-3 py-1.5 font-medium text-[11px] text-muted-foreground">{t("mentionPeople")}</p>
          {matches.length === 0 ? (
            <p className="px-3 py-3 text-muted-foreground text-sm">{t("mentionNoMatch")}</p>
          ) : (
            <div id={listId} role="listbox" aria-label={t("mentionPeople")} className="max-h-52 overflow-y-auto py-1">
              {matches.map((p, i) => (
                <div
                  key={p.userId}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  // Mouse down, not click: a click lands after the textarea has lost focus.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(p);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                >
                  <Avatar className="size-7 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{initials(p)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{personLabel(p)}</span>
                    {p.name && p.email && (
                      <span className="block truncate text-muted-foreground text-xs">{p.email}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {file && (
        <div className="mb-2 flex items-center gap-2.5 rounded-lg border bg-muted/40 p-1.5 pr-1">
          {preview ? (
            // biome-ignore lint/performance/noImgElement: a local object URL, not something to optimise
            <img src={preview} alt="" className="size-10 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileText className="size-4" aria-hidden />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-sm">{file.name}</span>
            <span className="block text-muted-foreground text-xs tabular-nums">{size(file.size)}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 md:size-8"
            onClick={() => setFile(null)}
            aria-label={t("removeAttachment")}
            disabled={sending}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          tabIndex={-1}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileRef.current?.click()}
          aria-label={t("attach")}
          title={t("attachmentHint")}
          disabled={sending}
        >
          <Paperclip className="size-4" />
        </Button>
        {canMention && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={startMention}
            aria-label={t("mentionPeople")}
            title={t("mentionPeople")}
            disabled={sending}
          >
            <AtSign className="size-4" />
          </Button>
        )}
        {/* A text area, so Shift+Enter starts a new line; it grows with the message
            up to five lines. */}
        <Textarea
          ref={setBox}
          value={text}
          rows={1}
          autoFocus={autoFocus}
          placeholder={t("typeMessage")}
          aria-label={t("typeMessage")}
          aria-autocomplete={canMention ? "list" : undefined}
          aria-expanded={canMention ? pickerOpen : undefined}
          aria-controls={pickerOpen && matches.length > 0 ? listId : undefined}
          aria-activedescendant={activeId}
          onChange={(e) => {
            setText(e.target.value);
            readTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => readTrigger(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onBlur={() => setPicker(null)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className={cn("max-h-32 flex-1 resize-none py-2 [field-sizing:content]", compact ? "min-h-9" : "min-h-10")}
        />
        <Button
          type="button"
          size="icon"
          className={cn("shrink-0", compact ? "size-9" : "size-10")}
          onClick={send}
          disabled={sending || (!text.trim() && !file)}
          aria-label={t("sendMessage")}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

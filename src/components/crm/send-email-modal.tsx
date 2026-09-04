"use client";

import { useCallback, useRef, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { CodeIcon, EyeIcon, Loader2Icon, MailIcon, PencilIcon, SendIcon, XIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { sendEmailAction } from "@/actions/email";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { renderPlaceholders, valuesForRecipient } from "@/lib/email-placeholders";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";
import { cn } from "@/lib/utils";

const emailSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
});

type EmailFormValues = z.infer<typeof emailSchema>;
type Mode = "preview" | "html";

export function SendEmailModal({
  entity,
  templates = [],
  ownerId,
}: {
  // Whatever record the mail is about: a contact, a lead or a company. Only the
  // fields the placeholders read are needed.
  entity: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    name?: string | null;
    companyName?: string | null;
    jobTitle?: string | null;
    phone?: string | null;
    mainPhone?: string | null;
  };
  templates?: { id: string; name: string; subject: string; body: string }[];
  ownerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [mode, setMode] = useState<Mode>("preview");
  const [body, setBody] = useState("");
  const [templateKey, setTemplateKey] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const safeTemplates = Array.isArray(templates) ? templates : [];

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { subject: "" },
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  // The fourth implementation of placeholder substitution in this codebase, each
  // with its own list of names, none of which agreed (audit rilievo S-08). They
  // all go through the one catalogue now, so a name that works in a campaign
  // works here too.
  const resolvePlaceholders = (text: string) =>
    renderPlaceholders(
      text,
      valuesForRecipient({
        firstName: entity.firstName,
        lastName: entity.lastName,
        email: entity.email,
        company: entity.companyName ?? entity.name,
        jobTitle: entity.jobTitle,
        phone: entity.phone ?? entity.mainPhone,
      }),
    );

  const flushPreview = useCallback(() => {
    if (previewRef.current) setBody(previewRef.current.innerHTML);
  }, []);

  // ─── Mode switching ────────────────────────────────────────────────────────

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (mode === "preview") flushPreview();
    if (next === "preview") setTemplateKey((k) => k + 1);
    setMode(next);
  };

  // ─── Template selection ────────────────────────────────────────────────────

  const handleTemplateSelect = (templateId: string) => {
    const template = safeTemplates.find((t) => t.id === templateId);
    if (!template) return;
    form.setValue("subject", resolvePlaceholders(template.subject || ""));
    setBody(resolvePlaceholders(template.body || ""));
    setTemplateKey((k) => k + 1);
    setMode("preview");
  };

  // ─── Paste — plain text only in preview ───────────────────────────────────

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    sel.deleteFromDocument();
    const range = sel.getRangeAt(0);
    range.insertNode(document.createTextNode(text));
    sel.collapseToEnd();
  };

  // ─── Submit ────────────────────────────────────────────────────────────────

  const onSubmit = async (data: EmailFormValues) => {
    const finalBody = mode === "preview" && previewRef.current ? previewRef.current.innerHTML : body;
    if (!finalBody.trim()) {
      toast.error("Email body cannot be empty.");
      return;
    }
    // A record with no address is the one case this dialog cannot do anything
    // about, and it used to send to `undefined`.
    if (!entity.email) {
      toast.error("This record has no email address.");
      return;
    }
    try {
      setIsSending(true);
      await sendEmailAction({
        to: entity.email,
        subject: resolvePlaceholders(data.subject),
        body: resolvePlaceholders(finalBody),
        leadId: entity.companyName ? entity.id : undefined,
        contactId: entity.firstName && !entity.companyName ? entity.id : undefined,
        ownerId,
      });
      toast.success("Email sent successfully!");
      handleOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send email.";
      toast.error(msg);
    } finally {
      setIsSending(false);
    }
  };

  // ─── Dialog lifecycle ──────────────────────────────────────────────────────

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (!v) {
      form.reset();
      setBody("");
      setMode("preview");
      setTemplateKey((k) => k + 1);
    }
  };

  // ─── Derived ───────────────────────────────────────────────────────────────

  const recipientName =
    entity.firstName || entity.lastName
      ? `${entity.firstName ?? ""} ${entity.lastName ?? ""}`.trim()
      : (entity.name ?? "");

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <MailIcon className="h-4 w-4" />
          Send Email
        </Button>
      </DialogTrigger>

      {/*
        Fixed-height dialog: h-[88vh].
        Internal structure is a flex column where only the body area grows.
        No magic-number calc() — every section uses flex sizing.
      */}
      <DialogContent className="flex h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px]">
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <DialogHeader className="shrink-0 border-b px-6 pt-6 pb-4">
          <DialogTitle className="text-lg">{recipientName ? `New Email — ${recipientName}` : "New Email"}</DialogTitle>
          {entity.email && <p className="mt-0.5 font-normal text-muted-foreground text-sm">{entity.email}</p>}
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          {/* ── Compose fields ─────────────────────────────────────────────── */}
          <div className="shrink-0 border-b">
            {/* Template row */}
            {safeTemplates.length > 0 && (
              <div className="flex items-center gap-0 border-b px-6 py-2.5">
                <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  Template
                </span>
                <Select onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="h-8 flex-1 border-0 bg-transparent pl-0 text-sm shadow-none focus:ring-0">
                    <SelectValue placeholder="Choose a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {safeTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Subject row */}
            <div className="flex items-center gap-0 px-6 py-2.5">
              <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Subject
              </span>
              <Input
                {...form.register("subject")}
                placeholder="Write a subject…"
                className="h-8 flex-1 border-0 bg-transparent pl-0 font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
              />
            </div>
            {form.formState.errors.subject && (
              <p className="px-6 pb-2 text-destructive text-xs">{form.formState.errors.subject.message}</p>
            )}
          </div>

          {/* ── Tab bar ────────────────────────────────────────────────────── */}
          {/*
            Underline-style tabs that sit flush against the content area below.
            The active tab's bottom border visually "connects" to the content.
          */}
          <div className="flex shrink-0 items-center gap-0 border-b bg-muted/20 px-4">
            {(["preview", "html"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-medium text-xs transition-colors",
                  mode === m
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {m === "preview" ? (
                  <>
                    <EyeIcon className="h-3.5 w-3.5" /> Preview
                  </>
                ) : (
                  <>
                    <CodeIcon className="h-3.5 w-3.5" /> Edit HTML
                  </>
                )}
              </button>
            ))}

            {/* Contextual hint — right-aligned, same bar */}
            <span className="ml-auto flex select-none items-center gap-1 pr-2 text-[10px] text-muted-foreground">
              {mode === "preview" ? (
                <>
                  <PencilIcon className="h-2.5 w-2.5" />
                  Click on text to edit
                </>
              ) : (
                <>
                  <EyeIcon className="h-2.5 w-2.5" />
                  Changes reflected in Preview
                </>
              )}
            </span>
          </div>

          {/* ── Body ───────────────────────────────────────────────────────── */}
          {/*
            flex-1 min-h-0 = fills all remaining space between tab bar and footer.
            Both panels are positioned absolute inside, so they always match this height.
          */}
          <div className="relative min-h-0 flex-1">
            {/* Preview panel */}
            <div
              className={cn(
                "absolute inset-0 overflow-y-auto bg-muted/30 dark:bg-muted/10",
                mode !== "preview" && "hidden",
              )}
            >
              {body ? (
                /* Centered email card — mimics how email clients render messages */
                <div className="min-h-full px-6 py-6">
                  <div
                    key={templateKey}
                    ref={previewRef}
                    contentEditable
                    suppressContentEditableWarning
                    onPaste={handlePaste}
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: an email body is HTML by definition; sanitised
                    dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(body) }}
                    className={cn(
                      "mx-auto max-w-[680px] rounded-md bg-white shadow-sm",
                      "p-0 outline-none",
                      "ring-0 focus:ring-2 focus:ring-primary/20 focus:ring-offset-0",
                      "[&_*]:cursor-text",
                    )}
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <MailIcon className="h-6 w-6 opacity-50" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">No content yet</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {safeTemplates.length > 0
                        ? "Select a template above or switch to HTML to compose"
                        : "Switch to HTML to write your email"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* HTML editor panel */}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"<!-- Paste or write your HTML here -->\n<p>Hello {{firstName}},</p>"}
              spellCheck={false}
              className={cn(
                "absolute inset-0 h-full w-full resize-none",
                "px-6 py-4 font-mono text-xs leading-relaxed",
                "bg-background text-foreground",
                "border-0 outline-none focus:ring-0",
                mode !== "html" && "hidden",
              )}
            />
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-6 py-3">
            {/* Placeholder reference — unobtrusive, left side */}
            <p className="hidden text-[10px] text-muted-foreground sm:block">
              Tip: use <code className="rounded bg-muted px-1 py-0.5 font-mono">{"{{firstName}}"}</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">{"{{lastName}}"}</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">{"{{companyName}}"}</code> as placeholders
            </p>

            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => handleOpen(false)} className="gap-1.5">
                <XIcon className="h-3.5 w-3.5" />
                Discard
              </Button>
              <Button type="submit" size="sm" disabled={isSending} className="gap-1.5">
                {isSending ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SendIcon className="h-3.5 w-3.5" />
                )}
                Send
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

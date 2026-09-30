"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CodeIcon,
  EyeIcon,
  LinkIcon,
  Loader2Icon,
  MailIcon,
  PaletteIcon,
  PaperclipIcon,
  PencilIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { decideAiSuggestionAction, getDraftAiEntryAction } from "@/actions/ai";
import { type EmailPreview, previewEmailAction, sendEmailAction } from "@/actions/email";
import { getComposerTemplates } from "@/actions/email-templates";
import { AiEmailDraft, type InsertedDraft } from "@/components/crm/ai/ai-email-draft";
import { EmailTemplatePicker } from "@/components/crm/email-template-picker";
import { RichTextEditor } from "@/components/crm/rich-text-editor";
import { SaveAsTemplateButton } from "@/components/crm/save-as-template-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AiEntry } from "@/lib/ai/types";
import { parseAddressList } from "@/lib/email-addresses";
import { emailLogTarget } from "@/lib/email-log-target";
import {
  type PlaceholderValues,
  pendingFields,
  renderPlaceholders,
  valuesForRecipient,
} from "@/lib/email-placeholders";
import type { ComposerTemplate } from "@/lib/email-template-rules";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";
import { cn } from "@/lib/utils";

/**
 * A template built in the email designer: tables, inline styles, a whole document. The text
 * editor would flatten it, so it is edited in place in its preview, or as HTML.
 */
export function isDesignedHtml(html: string): boolean {
  return /<(table|html|body|style|center)\b/i.test(html);
}

/** The text of an HTML body, whitespace folded: empty means nothing was written. */
function textOf(html: string): string {
  if (typeof DOMParser === "undefined")
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** What the dialog hands a document's own action: the person's text, never the document's parts. */
export interface DocumentEmail {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyHtml: string;
  templateId?: string;
}

/**
 * An email that carries a document — a quote's link, an invoice's PDF. Same dialog, same
 * templates, same copilot; what differs is where it goes (the address is editable: the
 * accounts department is not always the contact), what it opens with, and which action sends
 * it, because that action also moves the document (a quote becomes sent, a reminder is claimed).
 *
 * ⚠️ The document's parts are added by the server after the text (`finish` in email-deliver.ts):
 * no version of the text can leave without them, so the dialog only names them.
 */
export interface EmailDocument {
  /** The draft kept in this browser: `quote:<id>`, `invoice-copy:<id>`. */
  draftKey: string;
  title: string;
  description?: string;
  /** Named above the text: what the server adds to it. */
  parts?: { label: string; kind: "link" | "file" }[];
  defaultTo?: string | null;
  /** The text it opens with when nothing was being written. */
  /**
   * The text it opens with when nothing was being written, and the document's fields
   * (`documentValues`: its number, amount, due date), which fill `{{numero_preventivo}}` and
   * "[numero preventivo]" in whatever text is sent — a template picked later included. Asked for on
   * every opening, a restored draft too: the figures are the document's today.
   */
  load: () => Promise<
    { ok: true; subject: string; bodyHtml: string; fields?: PlaceholderValues } | { ok: false; error: string }
  >;
  send: (email: DocumentEmail) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The email as the customer will receive it, from the same code that sends it. */
  preview: (email: { subject: string; bodyHtml: string }) => Promise<EmailPreview>;
  submitLabel?: string;
  onSent?: (to: string) => void;
}

/**
 * The preview's page. Links open in a new tab (the quote's button leads to the page the customer
 * sees). ⚠️ Shown in a frame sandboxed without scripts and without the page's origin, so it is shown
 * as it will leave — a designed template keeps its `<style>`, which the sanitiser would remove —
 * and still cannot run anything or reach the dialog.
 */
function previewDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111827;background:#fff}</style></head><body>${html}</body></html>`;
}

interface SavedDraft {
  /** Only a document's dialog has an address to type. */
  to?: string;
  subject: string;
  body: string;
  cc: string;
  bcc: string;
  designed: boolean;
  /** The copilot draft in the editor, so its outcome is still recorded after a reopen. */
  ai: { id: string; text: string } | null;
  /** The template it started from, so its use is still counted after a reopen. */
  templateId?: string | null;
  savedAt: number;
}

/** A draft older than this is somebody else's afternoon, not something to bring back. */
const DRAFT_TTL_MS = 14 * 86_400_000;

function readDraft(key: string): SavedDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as SavedDraft;
    if (typeof draft?.savedAt !== "number" || Date.now() - draft.savedAt > DRAFT_TTL_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: SavedDraft | null) {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
  } catch {
    // Private windows and full quotas refuse storage: the dialog works, the draft is not kept.
  }
}

export function SendEmailModal({
  entity,
  entityType,
  templates,
  ownerId,
  dealId,
  ai,
  document: doc,
  fields,
  open: openProp,
  onOpenChange,
  trigger,
}: {
  /** Which record the sent email is logged on. Pass it: see src/lib/email-log-target.ts. */
  entityType?: "lead" | "contact" | "company";
  // Whatever record the mail is about: a contact, a lead or a company. Only the
  // fields the placeholders read are needed.
  entity: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    name?: string | null;
    companyName?: string | null;
    isConverted?: boolean | null;
    jobTitle?: string | null;
    phone?: string | null;
    mainPhone?: string | null;
  };
  /**
   * What the dialog offers to start from (actions/email-templates.ts `getComposerTemplates`).
   * Absent: asked for the first time the dialog opens, so any page can mount it.
   */
  templates?: ComposerTemplate[];
  ownerId?: string;
  /**
   * Sent from a deal's page: the email is logged on the deal as well as on its contact, and
   * "Write with AI" drafts from the whole deal rather than from the contact alone.
   */
  dealId?: string;
  /**
   * The copilot (Fase 5): ready, shown with the reason it cannot be used, or hidden (null).
   * Absent: asked for when the dialog opens.
   */
  ai?: AiEntry | null;
  /** An email that carries a document: see `EmailDocument`. */
  document?: EmailDocument;
  /**
   * The fields of the record the email is written from — an order, a contract, a ticket
   * (`documentValues`) — filled like the recipient's, so "[numero ordine]" is never typed by hand.
   */
  fields?: PlaceholderValues;
  /** Opened by the page (a menu item, `?send=1`) rather than by the dialog's own button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The button that opens it; null for none (opened by the page). */
  trigger?: React.ReactNode | null;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("marketing.sendEmailModal");
  const format = useFormatter();

  const [preview, setPreview] = useState<{ subject: string; html: string; unfilled: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [sending, setSending] = useState(false);
  // A document's dialog opening on its text, asked of the server.
  const [loading, setLoading] = useState(false);
  const [to, setTo] = useState("");
  const [docFields, setDocFields] = useState<PlaceholderValues>({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [designed, setDesigned] = useState(false);
  const [htmlSource, setHtmlSource] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  // The template the email started from: counted when it is sent, so the used ones come first.
  const [templateId, setTemplateId] = useState<string | null>(null);
  // A template picked while the editor already holds text: asked before replacing it.
  const [pendingTemplate, setPendingTemplate] = useState<ComposerTemplate | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<{
    to?: boolean;
    subject?: boolean;
    body?: boolean;
    cc?: string;
    bcc?: string;
  }>({});

  const previewRef = useRef<HTMLDivElement>(null);
  // The copilot draft in the editor, if any: what it said, to tell "sent as written" from "edited".
  const aiDraft = useRef<{ id: string; text: string } | null>(null);
  // Plus the ones saved from this dialog, so they are there at once.
  const [savedTemplates, setSavedTemplates] = useState<ComposerTemplate[]>([]);
  // Asked for on the first opening when the page did not hand them over.
  const [fetchedTemplates, setFetchedTemplates] = useState<ComposerTemplate[] | null>(null);
  const [fetchedAi, setFetchedAi] = useState<AiEntry | null | undefined>(undefined);
  const safeTemplates = [...savedTemplates, ...(templates ?? fetchedTemplates ?? [])];
  const aiEntry = ai === undefined ? (fetchedAi ?? null) : ai;

  // What "Write with AI" drafts from: the deal from a deal, otherwise the record written to.
  const aiSubject = dealId
    ? { type: "deal" as const, id: dealId }
    : entity.id
      ? { type: entityType ?? ("isConverted" in entity ? ("lead" as const) : ("contact" as const)), id: entity.id }
      : null;

  const storageKey = `flux:email-draft:${
    doc ? `doc:${doc.draftKey}` : dealId ? `deal:${dealId}` : `${entityType ?? "record"}:${entity.id}`
  }`;
  const toAddress = doc ? to.trim() : (entity.email ?? "");

  const recipientName =
    entity.firstName || entity.lastName
      ? `${entity.firstName ?? ""} ${entity.lastName ?? ""}`.trim()
      : (entity.name ?? "");
  const initials = (recipientName || entity.email || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // The fourth implementation of placeholder substitution in this codebase, each
  // with its own list of names, none of which agreed (audit rilievo S-08). They
  // all go through the one catalogue now, so a name that works in a campaign
  // works here too.
  const resolvePlaceholders = (text: string) =>
    renderPlaceholders(text, {
      ...valuesForRecipient({
        firstName: entity.firstName,
        lastName: entity.lastName,
        email: entity.email,
        company: entity.companyName ?? entity.name,
        jobTitle: entity.jobTitle,
        phone: entity.phone ?? entity.mainPhone,
      }),
      // The document's own figures: what the CRM knows is never left for the person to type.
      ...fields,
      ...docFields,
    });

  /** The body as it stands, including edits typed into a designed template's preview. */
  const currentHtml = useCallback(
    () => (designed && !htmlSource && previewRef.current ? previewRef.current.innerHTML : body),
    [designed, htmlSource, body],
  );
  const hasText = useMemo(() => textOf(body).length > 0, [body]);

  // ─── Copilot ─────────────────────────────────────────────────────────────

  /** What became of the draft in the editor, recorded once (actions/ai.ts). */
  const settleAiDraft = (outcome: "accepted" | "edited" | "discarded") => {
    const draft = aiDraft.current;
    aiDraft.current = null;
    if (draft) void decideAiSuggestionAction(draft.id, outcome).catch(() => undefined);
  };

  const handleAiDraft = (draft: InsertedDraft) => {
    // A new draft replaces the one before it, which was therefore not used.
    settleAiDraft("discarded");
    setSubject(draft.subject);
    setBody(draft.bodyHtml);
    setDesigned(false);
    setHtmlSource(false);
    setErrors({});
    aiDraft.current = { id: draft.suggestionId, text: textOf(draft.bodyHtml) };
  };

  // ─── Templates ───────────────────────────────────────────────────────────

  /**
   * ⚠️ Fields like {{nome}} stay as they are until the email is sent: the person sees which
   * parts are filled in for them, and "save as template" keeps them fields, not one customer's name.
   */
  const applyTemplate = (template: ComposerTemplate) => {
    const html = template.body || "";
    setTemplateId(template.id);
    setSubject(template.subject || "");
    setBody(html);
    setDesigned(isDesignedHtml(html));
    setHtmlSource(false);
    setPreviewKey((k) => k + 1);
    setErrors({});
  };

  const leaveDesign = () => {
    setDesigned(false);
    setHtmlSource(false);
    setBody("");
    setTemplateId(null);
  };

  const pickTemplate = (template: ComposerTemplate) => {
    if (textOf(currentHtml()) || subject.trim()) setPendingTemplate(template);
    else applyTemplate(template);
  };

  /** Into a designed template only text is pasted: markup from a web page would break its layout. */
  const pastePlainText = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    selection.deleteFromDocument();
    selection.getRangeAt(0).insertNode(document.createTextNode(text));
    selection.collapseToEnd();
  };

  // ─── Keeping the draft ───────────────────────────────────────────────────

  // A text asked of the server that arrives after the dialog closed is dropped.
  const loadToken = useRef(0);

  // The text a document opened on: kept only once the person changes it, so a reminder reopened
  // tomorrow says tomorrow's figures rather than a copy of today's nobody touched.
  const loadedText = useRef<string | null>(null);

  const reset = () => {
    setPreview(null);
    setDocFields({});
    loadToken.current += 1;
    loadedText.current = null;
    setLoading(false);
    setTo("");
    setSubject("");
    setBody("");
    setCc("");
    setBcc("");
    setShowCc(false);
    setShowBcc(false);
    setDesigned(false);
    setHtmlSource(false);
    setAiOpen(false);
    setTemplateId(null);
    setPendingTemplate(null);
    setRestored(null);
    setSavedAt(null);
    setErrors({});
    aiDraft.current = null;
  };

  const opened = () => {
    if (templates === undefined && fetchedTemplates === null) {
      void getComposerTemplates()
        .then(setFetchedTemplates)
        .catch(() => setFetchedTemplates([]));
    }
    if (ai === undefined && fetchedAi === undefined && aiSubject) {
      void getDraftAiEntryAction()
        .then(setFetchedAi)
        .catch(() => setFetchedAi(null));
    }

    // What was being written when the dialog was closed comes back, as in any mail client.
    const draft = readDraft(storageKey);
    if (draft) {
      setTo(draft.to ?? doc?.defaultTo ?? "");
      setSubject(draft.subject);
      setBody(draft.body);
      setCc(draft.cc);
      setBcc(draft.bcc);
      setShowCc(Boolean(draft.cc));
      setShowBcc(Boolean(draft.bcc));
      setDesigned(draft.designed);
      setPreviewKey((k) => k + 1);
      aiDraft.current = draft.ai;
      setTemplateId(draft.templateId ?? null);
      setRestored(draft.savedAt);
    }
    if (!doc) return;
    // A document opens on its own text, in the customer's language: editable like any other.
    if (!draft) setTo(doc.defaultTo ?? "");
    const token = ++loadToken.current;
    if (!draft) setLoading(true);
    doc
      .load()
      .then((text) => {
        if (token !== loadToken.current) return;
        if (!text.ok) {
          toast.error(text.error);
          setOpen(false);
          return;
        }
        setDocFields(text.fields ?? {});
        // A restored draft keeps its text; only the document's figures are taken.
        if (draft) return;
        loadedText.current = `${text.subject}\n${textOf(text.bodyHtml)}`;
        setSubject(text.subject);
        setBody(text.bodyHtml);
        setDesigned(isDesignedHtml(text.bodyHtml));
        setPreviewKey((k) => k + 1);
      })
      .catch(() => {
        if (token === loadToken.current) toast.error(t("loadFailed"));
      })
      .finally(() => {
        if (token === loadToken.current) setLoading(false);
      });
  };

  // Opening and closing are watched rather than handled, because the page may open it too.
  // Closing keeps the draft (it is saved as it is typed); only Discard throws it away.
  const onOpenChangeRef = useRef({ opened, reset });
  onOpenChangeRef.current = { opened, reset };
  useEffect(() => {
    if (open) onOpenChangeRef.current.opened();
    else onOpenChangeRef.current.reset();
  }, [open]);

  // Saved as it is typed, a moment after the last keystroke.
  useEffect(() => {
    if (!open || loading) return;
    const timer = window.setTimeout(() => {
      const html = currentHtml();
      const untouched =
        doc && loadedText.current === `${subject}\n${textOf(html)}` && to === (doc.defaultTo ?? "") && !cc && !bcc;
      if (untouched || (!subject.trim() && !textOf(html) && !cc && !bcc)) {
        writeDraft(storageKey, null);
        return;
      }
      const now = Date.now();
      writeDraft(storageKey, {
        ...(doc ? { to } : {}),
        subject,
        body: html,
        cc,
        bcc,
        designed,
        ai: aiDraft.current,
        templateId,
        savedAt: now,
      });
      setSavedAt(now);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [open, loading, doc, to, subject, cc, bcc, designed, templateId, storageKey, currentHtml]);

  const discard = () => {
    settleAiDraft("discarded");
    writeDraft(storageKey, null);
    reset();
    setOpen(false);
  };

  // ─── Sending ─────────────────────────────────────────────────────────────

  // Parts still to write in — "[numero fattura]", a deal's field outside a deal — asked about once.
  const [unfilled, setUnfilled] = useState<string[] | null>(null);

  // ─── Preview ─────────────────────────────────────────────────────────────

  // What the customer will receive: every field filled — the recipient's here, the sender's and the
  // deal's by the server — and what the document adds below the text, from the code that sends it.
  const files = (doc?.parts ?? []).filter((part) => part.kind === "file").map((part) => part.label);

  const openPreview = async () => {
    const html = currentHtml();
    setPreviewing(true);
    try {
      const email = { subject: resolvePlaceholders(subject), bodyHtml: resolvePlaceholders(html) };
      const result = doc
        ? await doc.preview(email)
        : await previewEmailAction({ subject: email.subject, body: email.bodyHtml, dealId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview({
        subject: result.subject,
        html: result.html,
        unfilled: pendingFields(`${email.subject}\n${textOf(email.bodyHtml)}`, { deal: Boolean(dealId) }),
      });
    } catch {
      toast.error(t("previewFailed"));
    } finally {
      setPreviewing(false);
    }
  };

  const send = async (anyway = false) => {
    const finalBody = currentHtml();
    const copies = parseAddressList(cc);
    const hidden = parseAddressList(bcc);
    const recipient = parseAddressList(toAddress);
    const next = {
      to: Boolean(doc) && (recipient.addresses.length !== 1 || recipient.invalid.length > 0),
      subject: !subject.trim(),
      body: !textOf(finalBody),
      cc: copies.invalid.length ? t("invalidCopies", { list: copies.invalid.join(", ") }) : undefined,
      bcc: hidden.invalid.length ? t("invalidCopies", { list: hidden.invalid.join(", ") }) : undefined,
    };
    setErrors(next);
    if (next.to || next.subject || next.body || next.cc || next.bcc) return;
    if (!anyway) {
      const pending = pendingFields(`${resolvePlaceholders(subject)}\n${textOf(resolvePlaceholders(finalBody))}`, {
        deal: Boolean(dealId),
      });
      if (pending.length > 0) {
        setUnfilled(pending);
        return;
      }
    }
    // A record with no address is the one case this dialog cannot do anything about.
    if (!toAddress) {
      toast.error(t("noAddress"));
      return;
    }

    setSending(true);
    try {
      const email = {
        to: toAddress,
        cc: copies.addresses.join(", ") || undefined,
        bcc: hidden.addresses.join(", ") || undefined,
        subject: resolvePlaceholders(subject),
        templateId: templateId ?? undefined,
      };
      const result = doc
        ? await doc.send({ ...email, bodyHtml: resolvePlaceholders(finalBody) })
        : await sendEmailAction({
            ...email,
            body: resolvePlaceholders(finalBody),
            ...emailLogTarget(entity, entityType),
            dealId,
            ownerId,
          }).then((r) => (r.success ? { ok: true as const } : { ok: false as const, error: r.error }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (doc?.onSent) doc.onSent(toAddress);
      else toast.success(t("sent"));
      settleAiDraft(aiDraft.current && textOf(finalBody) === aiDraft.current.text ? "accepted" : "edited");
      writeDraft(storageKey, null);
      reset();
      setOpen(false);
    } catch {
      toast.error(t("sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!sending) void send();
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const fieldRow = "flex items-center gap-3 px-4 md:px-5";
  const fieldLabel = "w-14 shrink-0 text-muted-foreground text-xs";
  const bareInput =
    "h-10 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm" className="gap-2">
              <MailIcon className="h-4 w-4" />
              {tc("sendEmail")}
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0 sm:h-[85dvh] sm:max-w-3xl"
        onKeyDown={onKeyDown}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-3 border-b py-3 pr-12 pl-4 md:pl-5">
          <div className="min-w-0">
            <DialogTitle className="truncate font-semibold text-base">{doc?.title ?? t("title")}</DialogTitle>
            <DialogDescription className={cn(!doc?.description && "sr-only", "text-muted-foreground text-xs")}>
              {doc?.description ?? (recipientName ? t("titleWithRecipient", { name: recipientName }) : t("title"))}
            </DialogDescription>
          </div>
          {savedAt ? (
            <span className="ml-auto shrink-0 text-muted-foreground text-xs" aria-live="polite">
              {t("savedAt", { time: format.dateTime(new Date(savedAt), { hour: "2-digit", minute: "2-digit" }) })}
            </span>
          ) : null}
        </div>

        {/* ── Addressing ─────────────────────────────────────────────────── */}
        <div className="shrink-0 divide-y border-b">
          <div className={cn(fieldRow, "min-h-12 py-1.5")}>
            {doc ? (
              <label className={fieldLabel} htmlFor="email-to">
                {t("to")}
              </label>
            ) : (
              <span className={fieldLabel}>{t("to")}</span>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {doc ? (
                <div className="flex-1">
                  <Input
                    id="email-to"
                    type="email"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      if (errors.to) setErrors((p) => ({ ...p, to: false }));
                    }}
                    placeholder={t("toPlaceholder")}
                    className={bareInput}
                    aria-invalid={errors.to}
                  />
                  {errors.to && <p className="pb-2 text-destructive text-xs">{t("invalidTo")}</p>}
                  {!doc.defaultTo && !to && <p className="pb-2 text-muted-foreground text-xs">{t("noDefaultTo")}</p>}
                </div>
              ) : entity.email ? (
                <span className="flex min-w-0 items-center gap-2 rounded-full border bg-muted/40 py-0.5 pr-3 pl-0.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-[10px] text-primary">
                    {initials}
                  </span>
                  <span className="min-w-0 truncate text-sm">
                    {recipientName ? <span className="font-medium">{recipientName}</span> : null}
                    <span className="text-muted-foreground">{recipientName ? ` <${entity.email}>` : entity.email}</span>
                  </span>
                </span>
              ) : (
                <span className="text-destructive text-sm">{t("noAddress")}</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!showCc && (
                <Button type="button" variant="ghost" size="xs" onClick={() => setShowCc(true)}>
                  {t("cc")}
                </Button>
              )}
              {!showBcc && (
                <Button type="button" variant="ghost" size="xs" onClick={() => setShowBcc(true)}>
                  {t("bcc")}
                </Button>
              )}
            </div>
          </div>

          {showCc && (
            <div className={fieldRow}>
              <label className={fieldLabel} htmlFor="email-cc">
                {t("cc")}
              </label>
              <div className="flex-1">
                <Input
                  id="email-cc"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder={t("copiesPlaceholder")}
                  className={bareInput}
                  aria-invalid={Boolean(errors.cc)}
                />
                {errors.cc && <p className="pb-2 text-destructive text-xs">{errors.cc}</p>}
              </div>
            </div>
          )}
          {showBcc && (
            <div className={fieldRow}>
              <label className={fieldLabel} htmlFor="email-bcc">
                {t("bcc")}
              </label>
              <div className="flex-1">
                <Input
                  id="email-bcc"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder={t("copiesPlaceholder")}
                  className={bareInput}
                  aria-invalid={Boolean(errors.bcc)}
                />
                {errors.bcc && <p className="pb-2 text-destructive text-xs">{errors.bcc}</p>}
              </div>
            </div>
          )}

          <div className={fieldRow}>
            <label className={fieldLabel} htmlFor="email-subject">
              {tc("subject")}
            </label>
            <div className="flex-1">
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setPreview(null);
                  if (errors.subject) setErrors((p) => ({ ...p, subject: false }));
                }}
                placeholder={t("subjectPlaceholder")}
                className={cn(bareInput, "font-medium")}
                aria-invalid={errors.subject}
              />
              {errors.subject && <p className="pb-2 text-destructive text-xs">{t("subjectRequired")}</p>}
            </div>
          </div>

          {doc?.parts && doc.parts.length > 0 && (
            <div className={cn(fieldRow, "min-h-10 py-1.5")}>
              <span className={fieldLabel}>{t("partsLabel")}</span>
              <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {doc.parts.map((part) => (
                  <li
                    key={part.label}
                    className="flex min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
                  >
                    {part.kind === "link" ? (
                      <LinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="truncate">{part.label}</span>
                  </li>
                ))}
                <li className="text-muted-foreground text-xs">
                  {t("partsHint")}{" "}
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={() => void openPreview()}
                  >
                    {t("partsSeePreview")}
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* ── Tools ──────────────────────────────────────────────────────── */}
        {/* One row on a phone too: short labels below sm, and "save as template" as an icon. */}
        <div className="flex shrink-0 flex-nowrap items-center gap-2 border-b bg-muted/30 px-4 py-2 md:px-5">
          {aiEntry && aiSubject && (
            <Button
              type="button"
              variant={aiOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setAiOpen((v) => !v)}
              aria-expanded={aiOpen}
              aria-label={t("writeWithAi")}
            >
              <SparklesIcon className="text-primary" />
              <span className="sm:hidden">{t("writeWithAiShort")}</span>
              <span className="hidden sm:inline">{t("writeWithAi")}</span>
            </Button>
          )}
          <EmailTemplatePicker templates={safeTemplates} onPick={pickTemplate} />
          <div className="ml-auto shrink-0">
            <SaveAsTemplateButton
              subject={subject}
              body={currentHtml}
              disabled={!subject.trim() || !hasText || designed}
              onSaved={(tpl) => {
                setSavedTemplates((prev) => [tpl, ...prev]);
                setTemplateId(tpl.id);
              }}
            />
          </div>
        </div>

        <AlertDialog open={unfilled !== null} onOpenChange={(v) => !v && setUnfilled(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("unfilledTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("unfilledDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex flex-wrap gap-1.5">
              {(unfilled ?? []).map((field) => (
                <li key={field}>
                  <code className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 text-xs dark:bg-amber-950/40 dark:text-amber-200">
                    {field}
                  </code>
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("unfilledBack")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setUnfilled(null);
                  void send(true);
                }}
              >
                {t("unfilledSendAnyway")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={pendingTemplate !== null} onOpenChange={(v) => !v && setPendingTemplate(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("replaceTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("replaceDescription", { name: pendingTemplate?.name ?? "" })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("replaceCancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingTemplate) applyTemplate(pendingTemplate);
                  setPendingTemplate(null);
                }}
              >
                {t("replaceConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {aiEntry && aiSubject && aiOpen && (
          <AiEmailDraft
            entityType={aiSubject.type}
            entityId={aiSubject.id}
            entry={aiEntry}
            hasText={hasText}
            currentHtml={currentHtml}
            onDraft={handleAiDraft}
            onClose={() => setAiOpen(false)}
          />
        )}

        {restored && (
          <div className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-4 py-2 text-amber-900 text-xs md:px-5 dark:bg-amber-950/30 dark:text-amber-200">
            <RotateCcwIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {t("restored", { time: format.dateTime(new Date(restored), { dateStyle: "short", timeStyle: "short" }) })}
            </span>
            <Button type="button" variant="ghost" size="xs" onClick={discard}>
              {t("discardDraft")}
            </Button>
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {preview && (
            <div className="flex min-h-full flex-col gap-3 bg-muted/30 p-3 sm:p-5 dark:bg-muted/10">
              <div className="rounded-md border bg-background p-3 text-sm">
                <p className="font-medium">{t("previewTitle")}</p>
                <p className="text-muted-foreground text-xs">{t("previewHint")}</p>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("to")}</dt>
                  <dd className="break-all">{toAddress || "—"}</dd>
                  {cc.trim() && (
                    <>
                      <dt className="text-muted-foreground">{t("cc")}</dt>
                      <dd className="break-all">{cc}</dd>
                    </>
                  )}
                  {bcc.trim() && (
                    <>
                      <dt className="text-muted-foreground">{t("bcc")}</dt>
                      <dd className="break-all">{bcc}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{tc("subject")}</dt>
                  <dd className="font-medium">{preview.subject}</dd>
                  {files.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t("previewAttachments")}</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        {files.map((file) => (
                          <span
                            key={file}
                            className="flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5"
                          >
                            <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                            {file}
                          </span>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
                {preview.unfilled.length > 0 && (
                  <p className="mt-3 rounded bg-amber-100 px-2 py-1.5 text-amber-900 text-xs dark:bg-amber-950/40 dark:text-amber-200">
                    {t("previewUnfilled", { list: preview.unfilled.join(", ") })}
                  </p>
                )}
              </div>
              {/* Its own document: the email's styles cannot reach the dialog, nor the dialog's the email. */}
              <iframe
                title={t("previewTitle")}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={previewDocument(preview.html)}
                className="min-h-[420px] w-full flex-1 rounded-md border bg-white"
              />
            </div>
          )}
          <div className={cn(preview && "hidden")}>
            {loading ? (
              <div className="flex min-h-[320px] items-center justify-center gap-2 text-muted-foreground text-sm">
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
                {t("loadingText")}
              </div>
            ) : designed ? (
              <div className="flex min-h-full flex-col">
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2 text-xs backdrop-blur md:px-5">
                  <PaletteIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 text-muted-foreground">{t("designedHint")}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      if (!htmlSource && previewRef.current) setBody(previewRef.current.innerHTML);
                      if (htmlSource) setPreviewKey((k) => k + 1);
                      setHtmlSource((v) => !v);
                    }}
                  >
                    {htmlSource ? <EyeIcon /> : <CodeIcon />}
                    {htmlSource ? tc("preview") : t("editHtml")}
                  </Button>
                  <Button type="button" variant="ghost" size="xs" onClick={leaveDesign}>
                    {t("plainEmail")}
                  </Button>
                </div>
                {htmlSource ? (
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    spellCheck={false}
                    aria-label={t("editHtml")}
                    className="min-h-[360px] w-full flex-1 resize-none border-0 bg-background px-4 py-4 font-mono text-xs leading-relaxed outline-none focus:ring-0 md:px-5"
                  />
                ) : (
                  <div className="flex-1 bg-muted/30 px-3 py-4 sm:px-6 dark:bg-muted/10">
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: a designed email is arbitrary HTML edited in place; no form element can hold it */}
                    <div
                      key={previewKey}
                      ref={previewRef}
                      contentEditable
                      suppressContentEditableWarning
                      onPaste={pastePlainText}
                      onBlur={() => previewRef.current && setBody(previewRef.current.innerHTML)}
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: an email body is HTML by definition; sanitised
                      dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(body) }}
                      className="mx-auto max-w-[680px] rounded-md bg-white shadow-sm outline-none focus:ring-2 focus:ring-primary/20 [&_*]:cursor-text"
                    />
                  </div>
                )}
              </div>
            ) : (
              <RichTextEditor
                variant="email"
                value={body}
                onChange={(html) => {
                  setBody(html);
                  if (errors.body) setErrors((p) => ({ ...p, body: false }));
                }}
                placeholder={t("bodyPlaceholder")}
                className="rounded-none border-0"
                editorClassName="min-h-[320px] px-4 md:px-5"
              />
            )}
          </div>
          {errors.body && (
            <p className="sticky bottom-0 bg-background px-4 py-2 text-destructive text-xs md:px-5">{t("emptyBody")}</p>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-3 border-t bg-background px-4 py-3 md:px-5">
          <p className="hidden min-w-0 flex-1 text-muted-foreground text-xs sm:block">{t("footerHint")}</p>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={discard} aria-label={t("discard")}>
              <Trash2Icon />
              <span className="hidden sm:inline">{t("discard")}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (preview ? setPreview(null) : void openPreview())}
              disabled={previewing || loading}
            >
              {previewing ? <Loader2Icon className="animate-spin" /> : preview ? <PencilIcon /> : <EyeIcon />}
              {preview ? t("backToEdit") : t("preview")}
            </Button>
            <Button type="button" size="sm" onClick={() => void send()} disabled={sending || loading || !toAddress}>
              {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {doc?.submitLabel ?? tc("send")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

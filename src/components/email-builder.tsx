"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import {
  AlignLeft,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Code2,
  Columns,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Mail,
  Minus,
  Monitor,
  MousePointer,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Smartphone,
  Trash2,
  Type,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createEmailTemplate, updateEmailTemplate } from "@/actions/marketing";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type Block,
  type BlockProps,
  type BlockType,
  type ButtonProps,
  blockTextDefaults,
  compileToHtml,
  type DividerProps,
  type EmailDesign,
  type EmailSettings,
  emptyDesign,
  estimateHtmlSize,
  type FooterProps,
  type HeadingProps,
  type HtmlProps,
  type ImageProps,
  newBlock,
  type SpacerProps,
  type TextProps,
  type TwoColumnProps,
  unsubscribeLabel,
  VARIABLES,
} from "@/lib/email-builder";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";
import { cn } from "@/lib/utils";

/** Text placed into the preview's HTML, which the sanitiser would not escape. */
function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Block palette config ─────────────────────────────────────────────────────

/** Label and description: marketing.emailBuilder.blocks.<type>.label / .desc */
const PALETTE: { type: BlockType; icon: React.ReactNode }[] = [
  { type: "heading", icon: <Type className="h-4 w-4" /> },
  { type: "text", icon: <AlignLeft className="h-4 w-4" /> },
  { type: "image", icon: <ImageIcon className="h-4 w-4" /> },
  { type: "button", icon: <MousePointer className="h-4 w-4" /> },
  { type: "divider", icon: <Minus className="h-4 w-4" /> },
  { type: "spacer", icon: <LayoutTemplate className="h-4 w-4" /> },
  { type: "two_column", icon: <Columns className="h-4 w-4" /> },
  { type: "footer", icon: <Mail className="h-4 w-4" /> },
  { type: "html", icon: <Code2 className="h-4 w-4" /> },
];

// ─── Canvas block preview ─────────────────────────────────────────────────────

function BlockPreview({ block }: { block: Block }) {
  const t = useTranslations("marketing.emailBuilder");
  const { type, props } = block;

  switch (type) {
    case "heading": {
      const p = props as HeadingProps;
      const Tag = p.level;
      return (
        <div
          style={{
            background: p.backgroundColor,
            padding: `${p.paddingTop}px 24px ${p.paddingBottom}px`,
            textAlign: p.align,
          }}
        >
          <Tag style={{ margin: 0, color: p.color, fontWeight: "bold", lineHeight: 1.3 }}>
            {p.text || t("blocks.heading.label")}
          </Tag>
        </div>
      );
    }
    case "text": {
      const p = props as TextProps;
      return (
        <div
          style={{
            background: p.backgroundColor,
            padding: `${p.paddingTop}px 24px ${p.paddingBottom}px`,
            textAlign: p.align,
            color: p.color,
            fontSize: p.fontSize,
            lineHeight: p.lineHeight,
          }}
          // A block's HTML is written by one member of the workspace and previewed
          // by another, which makes it stored XSS unless something removes what
          // executes. The same sanitiser the ticket thread uses; the CSP in
          // src/proxy.ts is the second line behind it.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: composed email HTML; sanitised
          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(p.html || `<p>${t("canvas.textPlaceholder")}</p>`) }}
        />
      );
    }
    case "image": {
      const p = props as ImageProps;
      return (
        <div
          style={{
            background: p.backgroundColor,
            padding: `${p.paddingTop}px 0 ${p.paddingBottom}px`,
            textAlign: p.align,
          }}
        >
          {p.src ? (
            <img src={p.src} alt={p.alt} style={{ maxWidth: `${p.width}%`, display: "inline-block" }} />
          ) : (
            <div
              style={{
                height: 80,
                background: "#f3f4f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#9ca3af",
                fontSize: 13,
              }}
            >
              <ImageIcon className="h-5 w-5 mr-2" /> {t("canvas.imagePlaceholder")}
            </div>
          )}
        </div>
      );
    }
    case "button": {
      const p = props as ButtonProps;
      return (
        <div style={{ background: p.blockBg, padding: "16px 24px", textAlign: p.align }}>
          <span
            style={{
              display: "inline-block",
              background: p.bgColor,
              color: p.textColor,
              borderRadius: p.borderRadius,
              padding: `${p.paddingV}px ${p.paddingH}px`,
              fontSize: p.fontSize,
              fontWeight: "bold",
              cursor: "default",
            }}
          >
            {p.label || t("blocks.button.label")}
          </span>
        </div>
      );
    }
    case "divider": {
      const p = props as DividerProps;
      return (
        <div style={{ background: p.backgroundColor, padding: `${p.paddingTop}px 24px ${p.paddingBottom}px` }}>
          <hr style={{ border: "none", borderTop: `${p.thickness}px solid ${p.color}`, margin: 0 }} />
        </div>
      );
    }
    case "spacer": {
      const p = props as SpacerProps;
      return (
        <div
          style={{
            background: p.backgroundColor,
            height: p.height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 10, color: "#d1d5db" }}>{t("canvas.spacer", { height: p.height })}</span>
        </div>
      );
    }
    case "two_column": {
      const p = props as TwoColumnProps;
      return (
        <div style={{ background: p.backgroundColor, display: "flex", gap: p.gap }}>
          <div
            style={{ flex: 1, background: p.leftBg, padding: 16, fontSize: 13, color: "#374151" }}
            // A block's HTML is written by one member of the workspace and previewed
            // by another, which makes it stored XSS unless something removes what
            // executes. The same sanitiser the ticket thread uses; the CSP in
            // src/proxy.ts is the second line behind it.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: composed email HTML; sanitised
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(p.leftHtml) }}
          />
          <div
            style={{ flex: 1, background: p.rightBg, padding: 16, fontSize: 13, color: "#374151" }}
            // A block's HTML is written by one member of the workspace and previewed
            // by another, which makes it stored XSS unless something removes what
            // executes. The same sanitiser the ticket thread uses; the CSP in
            // src/proxy.ts is the second line behind it.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: composed email HTML; sanitised
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(p.rightHtml) }}
          />
        </div>
      );
    }
    case "footer": {
      const p = props as FooterProps;
      return (
        <div
          style={{
            background: p.backgroundColor,
            padding: "20px 24px",
            textAlign: "center",
            color: p.textColor,
            fontSize: p.fontSize,
          }}
          // A block's HTML is written by one member of the workspace and previewed
          // by another, which makes it stored XSS unless something removes what
          // executes. The same sanitiser the ticket thread uses; the CSP in
          // src/proxy.ts is the second line behind it.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: composed email HTML; sanitised
          dangerouslySetInnerHTML={{
            __html: sanitizeEmailHtml(
              p.html +
                (p.showUnsubscribe
                  ? `<p style="margin:8px 0 0 0;"><a href="#" style="color:inherit;">${escapeText(unsubscribeLabel(p))}</a></p>`
                  : ""),
            ),
          }}
        />
      );
    }
    case "html": {
      const p = props as HtmlProps;
      return (
        <div style={{ background: p.backgroundColor, padding: "8px 24px" }}>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "#6b7280",
              padding: 8,
              background: "#f9fafb",
              borderRadius: 4,
              overflow: "hidden",
              maxHeight: 80,
            }}
          >
            {p.html || `<!-- ${t("canvas.htmlPlaceholder")} →`}
          </div>
        </div>
      );
    }
    default:
      return <div className="h-8 bg-muted/30" />;
  }
}

// ─── Inspector fields ─────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded border border-input p-0.5 md:h-7"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 flex-1 font-mono md:h-7 md:text-xs"
      />
    </div>
  );
}

function AlignButtons({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("marketing.emailBuilder");
  return (
    <div className="flex gap-1">
      {(["left", "center", "right"] as const).map((a) => (
        <Button
          key={a}
          variant={value === a ? "default" : "outline"}
          size="sm"
          className="h-7 px-3 text-xs capitalize flex-1"
          onClick={() => onChange(a)}
        >
          {t(`align.${a}`)}
        </Button>
      ))}
    </div>
  );
}

function BlockInspector({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const t = useTranslations("marketing.emailBuilder");
  const tPlaceholders = useTranslations("placeholders");
  const set = (patch: Partial<BlockProps>) => onChange({ ...block, props: { ...block.props, ...patch } });

  const p = block.props;

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-2">
        {t("inspector.properties", { block: t(`blocks.${block.type}.label`) })}
      </p>

      {block.type === "heading" &&
        (() => {
          const hp = p as HeadingProps;
          return (
            <>
              <Row label={t("fields.text")}>
                <Input
                  value={hp.text}
                  onChange={(e) => set({ text: e.target.value } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.level")}>
                <select
                  value={hp.level}
                  onChange={(e) => set({ level: e.target.value } as any)}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
                >
                  <option value="h1">{t("levels.h1")}</option>
                  <option value="h2">{t("levels.h2")}</option>
                  <option value="h3">{t("levels.h3")}</option>
                </select>
              </Row>
              <Row label={t("fields.alignment")}>
                <AlignButtons value={hp.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label={t("fields.textColor")}>
                <ColorInput value={hp.color} onChange={(v) => set({ color: v } as any)} />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={hp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label={t("fields.paddingTop")}>
                <Input
                  type="number"
                  value={hp.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingBottom")}>
                <Input
                  type="number"
                  value={hp.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
            </>
          );
        })()}

      {block.type === "text" &&
        (() => {
          const tp = p as TextProps;
          return (
            <>
              <Row label={t("fields.content")}>
                <Textarea
                  value={tp.html}
                  onChange={(e) => set({ html: e.target.value } as any)}
                  className="min-h-[120px] resize-y font-mono md:text-xs"
                />
              </Row>
              <Row label={t("fields.alignment")}>
                <AlignButtons value={tp.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label={t("fields.color")}>
                <ColorInput value={tp.color} onChange={(v) => set({ color: v } as any)} />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={tp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label={t("fields.fontSize")}>
                <Input
                  type="number"
                  value={tp.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.lineHeight")}>
                <Input
                  type="number"
                  step="0.1"
                  value={tp.lineHeight}
                  onChange={(e) => set({ lineHeight: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingTop")}>
                <Input
                  type="number"
                  value={tp.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingBottom")}>
                <Input
                  type="number"
                  value={tp.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
            </>
          );
        })()}

      {block.type === "image" &&
        (() => {
          const ip = p as ImageProps;
          return (
            <>
              <Row label={t("fields.imageUrl")}>
                <Input
                  value={ip.src}
                  onChange={(e) => set({ src: e.target.value } as any)}
                  className="h-8 md:text-sm"
                  placeholder="https://…"
                />
              </Row>
              <Row label={t("fields.altText")}>
                <Input
                  value={ip.alt}
                  onChange={(e) => set({ alt: e.target.value } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.link")}>
                <Input
                  value={ip.href}
                  onChange={(e) => set({ href: e.target.value } as any)}
                  className="h-8 md:text-sm"
                  placeholder="https://…"
                />
              </Row>
              <Row label={t("fields.width")}>
                <Input
                  type="number"
                  min={10}
                  max={100}
                  value={ip.width}
                  onChange={(e) => set({ width: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.alignment")}>
                <AlignButtons value={ip.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={ip.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label={t("fields.paddingTop")}>
                <Input
                  type="number"
                  value={ip.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingBottom")}>
                <Input
                  type="number"
                  value={ip.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
            </>
          );
        })()}

      {block.type === "button" &&
        (() => {
          const bp = p as ButtonProps;
          return (
            <>
              <Row label={t("fields.label")}>
                <Input
                  value={bp.label}
                  onChange={(e) => set({ label: e.target.value } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.link")}>
                <Input
                  value={bp.href}
                  onChange={(e) => set({ href: e.target.value } as any)}
                  className="h-8 md:text-sm"
                  placeholder="https://…"
                />
              </Row>
              <Row label={t("fields.alignment")}>
                <AlignButtons value={bp.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label={t("fields.buttonColor")}>
                <ColorInput value={bp.bgColor} onChange={(v) => set({ bgColor: v } as any)} />
              </Row>
              <Row label={t("fields.textColor")}>
                <ColorInput value={bp.textColor} onChange={(v) => set({ textColor: v } as any)} />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={bp.blockBg} onChange={(v) => set({ blockBg: v } as any)} />
              </Row>
              <Row label={t("fields.borderRadius")}>
                <Input
                  type="number"
                  value={bp.borderRadius}
                  onChange={(e) => set({ borderRadius: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.fontSize")}>
                <Input
                  type="number"
                  value={bp.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingH")}>
                <Input
                  type="number"
                  value={bp.paddingH}
                  onChange={(e) => set({ paddingH: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingV")}>
                <Input
                  type="number"
                  value={bp.paddingV}
                  onChange={(e) => set({ paddingV: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
            </>
          );
        })()}

      {block.type === "divider" &&
        (() => {
          const dp = p as DividerProps;
          return (
            <>
              <Row label={t("fields.color")}>
                <ColorInput value={dp.color} onChange={(v) => set({ color: v } as any)} />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={dp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label={t("fields.thickness")}>
                <Input
                  type="number"
                  min={1}
                  value={dp.thickness}
                  onChange={(e) => set({ thickness: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingTop")}>
                <Input
                  type="number"
                  value={dp.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.paddingBottom")}>
                <Input
                  type="number"
                  value={dp.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
            </>
          );
        })()}

      {block.type === "spacer" &&
        (() => {
          const sp = p as SpacerProps;
          return (
            <>
              <Row label={t("fields.height")}>
                <Input
                  type="number"
                  min={4}
                  value={sp.height}
                  onChange={(e) => set({ height: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={sp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
            </>
          );
        })()}

      {block.type === "two_column" &&
        (() => {
          const tp = p as TwoColumnProps;
          return (
            <>
              <Row label={t("fields.leftContent")}>
                <Textarea
                  value={tp.leftHtml}
                  onChange={(e) => set({ leftHtml: e.target.value } as any)}
                  className="min-h-[80px] resize-y font-mono md:text-xs"
                />
              </Row>
              <Row label={t("fields.rightContent")}>
                <Textarea
                  value={tp.rightHtml}
                  onChange={(e) => set({ rightHtml: e.target.value } as any)}
                  className="min-h-[80px] resize-y font-mono md:text-xs"
                />
              </Row>
              <Row label={t("fields.leftBackground")}>
                <ColorInput value={tp.leftBg} onChange={(v) => set({ leftBg: v } as any)} />
              </Row>
              <Row label={t("fields.rightBackground")}>
                <ColorInput value={tp.rightBg} onChange={(v) => set({ rightBg: v } as any)} />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={tp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label={t("fields.gap")}>
                <Input
                  type="number"
                  value={tp.gap}
                  onChange={(e) => set({ gap: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
            </>
          );
        })()}

      {block.type === "footer" &&
        (() => {
          const fp = p as FooterProps;
          return (
            <>
              <Row label={t("fields.content")}>
                <Textarea
                  value={fp.html}
                  onChange={(e) => set({ html: e.target.value } as any)}
                  className="min-h-[80px] resize-y font-mono md:text-xs"
                />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={fp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label={t("fields.textColor")}>
                <ColorInput value={fp.textColor} onChange={(v) => set({ textColor: v } as any)} />
              </Row>
              <Row label={t("fields.fontSize")}>
                <Input
                  type="number"
                  value={fp.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) } as any)}
                  className="h-8 md:text-sm"
                />
              </Row>
              <Row label={t("fields.showUnsubscribe")}>
                <Switch
                  checked={fp.showUnsubscribe}
                  onCheckedChange={(v) => set({ showUnsubscribe: v } as any)}
                  aria-label={t("fields.showUnsubscribe")}
                />
              </Row>
              {fp.showUnsubscribe && (
                <Row label={t("fields.unsubscribeLabel")}>
                  <Input
                    value={fp.unsubscribeLabel ?? ""}
                    placeholder={unsubscribeLabel(fp)}
                    onChange={(e) => set({ unsubscribeLabel: e.target.value } as any)}
                    className="h-8 md:text-sm"
                  />
                </Row>
              )}
            </>
          );
        })()}

      {block.type === "html" &&
        (() => {
          const hp = p as HtmlProps;
          return (
            <>
              <Row label="HTML">
                <Textarea
                  value={hp.html}
                  onChange={(e) => set({ html: e.target.value } as any)}
                  className="min-h-[200px] resize-y font-mono md:text-xs"
                  placeholder="<table>…</table>"
                />
              </Row>
              <Row label={t("fields.background")}>
                <ColorInput value={hp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
            </>
          );
        })()}

      {/* Variables helper */}
      <Separator />
      <div className="space-y-1">
        <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
          {t("inspector.insertVariable")}
        </p>
        <div className="flex flex-wrap gap-1">
          {VARIABLES.map((v) => (
            <Badge
              key={v.key}
              variant="outline"
              className="cursor-pointer font-mono text-[9px] hover:bg-primary hover:text-primary-foreground transition-colors"
              title={`${tPlaceholders(`catalogue.${v.placeholder}.label`)} — ${tPlaceholders(`catalogue.${v.placeholder}.description`)}`}
              onClick={() => {
                // Copy to clipboard
                navigator.clipboard.writeText(v.key).then(() => toast.success(t("copied", { variable: v.key })));
              }}
            >
              {v.key}
            </Badge>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground">{t("inspector.copyHint")}</p>
      </div>
    </div>
  );
}

// ─── Settings inspector ───────────────────────────────────────────────────────

function SettingsInspector({ settings, onChange }: { settings: EmailSettings; onChange: (s: EmailSettings) => void }) {
  const t = useTranslations("marketing.emailBuilder");
  const set = (patch: Partial<EmailSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="space-y-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-2">
        {t("globalSettings")}
      </p>
      <Row label={t("fields.backgroundColor")}>
        <ColorInput value={settings.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
      </Row>
      <Row label={t("fields.contentWidth")}>
        <div className="flex gap-2">
          {[480, 600, 640].map((w) => (
            <Button
              key={w}
              variant={settings.contentWidth === w ? "default" : "outline"}
              size="sm"
              className="h-7 flex-1 text-xs"
              onClick={() => set({ contentWidth: w })}
            >
              {w}
            </Button>
          ))}
        </div>
      </Row>
      <Row label={t("fields.fontFamily")}>
        <select
          value={settings.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
        >
          <option value="Arial, Helvetica, sans-serif">{t("settings.arialRecommended")}</option>
          <option value="Georgia, 'Times New Roman', serif">Georgia</option>
          <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
          <option value="Verdana, Geneva, sans-serif">Verdana</option>
        </select>
      </Row>
      <Row label={t("fields.previewText")}>
        <Input
          value={settings.previewText}
          onChange={(e) => set({ previewText: e.target.value })}
          className="h-8 md:text-sm"
          placeholder={t("settings.previewTextPlaceholder")}
        />
      </Row>
    </div>
  );
}

// ─── Main EmailBuilder ────────────────────────────────────────────────────────

interface EmailBuilderProps {
  templateId?: string;
  initialName?: string;
  initialSubject?: string;
  initialDesign?: EmailDesign;
  initialCategory?: string;
  /** The template had no saved design and opens as its HTML, in one block. */
  fromHtml?: boolean;
}

type MobilePanel = "email" | "add" | "edit" | "settings";

/** How long a run of edits to one field counts as one step to undo. */
const COALESCE_MS = 1500;

export function EmailBuilder({
  templateId,
  initialName = "",
  initialSubject = "",
  initialDesign,
  initialCategory = "general",
  fromHtml = false,
}: EmailBuilderProps) {
  const t = useTranslations("marketing.emailBuilder");
  const tm = useTranslations("marketing");
  const tc = useTranslations("common");
  const router = useRouter();
  const [start] = useState<EmailDesign>(() => initialDesign ?? emptyDesign(blockTextDefaults(t)));
  const [design, setDesign] = useState<EmailDesign>(start);
  // The design as of the last change, for the history: read here rather than inside a
  // state updater, which React may run twice and which must not set other state.
  const designRef = useRef(design);
  designRef.current = design;
  const [selectedId, setSelectedId] = useState<string | "settings" | null>("settings");
  const [preview, setPreview] = useState<"desktop" | "mobile" | null>(null);
  const [name, setName] = useState(initialName);
  const [subject, setSubject] = useState(initialSubject);
  const [category, setCategory] = useState(initialCategory);
  const [saving, setSaving] = useState(false);
  // ⚠️ The designs *before* each change. It used to hold the design after it, so the
  // first press of Undo put back what was already on screen and did nothing.
  const [history, setHistory] = useState<EmailDesign[]>([]);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const [panel, setPanel] = useState<MobilePanel>("email");
  const [leaving, setLeaving] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The name and subject are typed in the bar on a desktop and in the details panel on
  // a phone: two fields each, and a failed save focuses the one on screen.
  const fieldRefs = useRef<
    Record<"bar" | "panel", { name: HTMLInputElement | null; subject: HTMLInputElement | null }>
  >({
    bar: { name: null, subject: null },
    panel: { name: null, subject: null },
  });

  // What was loaded, to know whether anything would be lost by leaving.
  const [savedState, setSavedState] = useState(() =>
    JSON.stringify({ design: start, name: initialName, subject: initialSubject, category: initialCategory }),
  );
  const current = JSON.stringify({ design, name, subject, category });
  const dirty = current !== savedState;

  // A closed tab or a reload asks first while there is something unsaved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** A change that is one step of its own: adding, removing, moving a block. */
  const commit = useCallback((next: EmailDesign) => {
    lastEdit.current = null;
    const prev = designRef.current;
    setHistory((h) => [...h.slice(-29), prev]);
    designRef.current = next;
    setDesign(next);
  }, []);

  /**
   * A change typed into a field. Keystrokes into the same field within a moment of
   * each other are one step, or Undo would take a heading back one letter at a time.
   */
  const edit = useCallback((key: string, apply: (d: EmailDesign) => EmailDesign) => {
    const now = Date.now();
    const same = lastEdit.current?.key === key && now - lastEdit.current.at < COALESCE_MS;
    lastEdit.current = { key, at: now };
    const prev = designRef.current;
    if (!same) setHistory((h) => [...h.slice(-29), prev]);
    const next = apply(prev);
    designRef.current = next;
    setDesign(next);
  }, []);

  const undo = () => {
    if (history.length === 0) return;
    lastEdit.current = null;
    const prev = history[history.length - 1];
    designRef.current = prev;
    setDesign(prev);
    setHistory((h) => h.slice(0, -1));
  };

  const updateBlock = useCallback(
    (updated: Block) =>
      edit(`block:${updated.id}`, (d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === updated.id ? updated : b)) })),
    [edit],
  );

  const updateSettings = useCallback((s: EmailSettings) => edit("settings", (d) => ({ ...d, settings: s })), [edit]);

  const addBlock = (type: BlockType) => {
    const block = newBlock(type, blockTextDefaults(t));
    commit({ ...design, blocks: [...design.blocks, block] });
    setSelectedId(block.id);
    // On a phone the new block is filled in straight away: that is why it was added.
    setPanel("edit");
  };

  const deleteBlock = (id: string) => {
    commit({ ...design, blocks: design.blocks.filter((b) => b.id !== id) });
    setSelectedId(null);
  };

  const duplicateBlock = (id: string) => {
    const idx = design.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const clone = { ...design.blocks[idx], id: Math.random().toString(36).slice(2, 9) };
    const next = [...design.blocks];
    next.splice(idx + 1, 0, clone);
    commit({ ...design, blocks: next });
    setSelectedId(clone.id);
  };

  /** One place up or down: the move a finger makes without a drag, and a keyboard too. */
  const moveBlock = (id: string, by: -1 | 1) => {
    const idx = design.blocks.findIndex((b) => b.id === id);
    const to = idx + by;
    if (idx < 0 || to < 0 || to >= design.blocks.length) return;
    const blocks = [...design.blocks];
    const [moved] = blocks.splice(idx, 1);
    blocks.splice(to, 0, moved);
    commit({ ...design, blocks });
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const blocks = [...design.blocks];
    const [moved] = blocks.splice(result.source.index, 1);
    blocks.splice(result.destination.index, 0, moved);
    commit({ ...design, blocks });
  };

  const html = compileToHtml(design, subject);
  const sizeInfo = estimateHtmlSize(html);

  // Live preview. ⚠️ Sized to the email, not to a fixed 600px: a long email was cut off
  // at the bottom of the frame, and a short one sat in a tall empty box.
  useEffect(() => {
    const frame = iframeRef.current;
    if (!preview || !frame) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    const fit = () => {
      // The body's height, not the document's: the document is at least as tall as
      // the frame, so measuring it could only ever grow the frame, never shrink it.
      frame.style.height = `${Math.max(200, doc.body?.scrollHeight ?? 0)}px`;
    };
    fit();
    // Images arrive after the write and change the height again.
    for (const img of Array.from(doc.images)) img.addEventListener("load", fit, { once: true });
  }, [preview, html]);

  const leave = () => router.push("/dashboard/marketing/templates");

  const handleSave = async () => {
    // A missing name or subject is shown where it is typed. On a phone that field is
    // in the details panel, so that is where the save goes.
    if (!name.trim() || !subject.trim()) {
      toast.error(name.trim() ? t("subjectRequired") : t("nameRequired"));
      setPanel("settings");
      setSelectedId("settings");
      const field = name.trim() ? "subject" : "name";
      requestAnimationFrame(() => {
        const { bar, panel } = fieldRefs.current;
        // Whichever is laid out: a field inside a hidden panel has no offsetParent.
        const target = [bar[field], panel[field]].find((el) => el && el.offsetParent !== null);
        target?.focus();
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        subject: subject.trim(),
        body: html,
        design: JSON.stringify(design),
        category,
        isHtml: true,
        previewText: design.settings.previewText,
      };
      if (templateId) {
        await updateEmailTemplate(templateId, payload);
        toast.success(tm("templates.updateSuccess"));
      } else {
        await createEmailTemplate(payload);
        toast.success(tm("templates.createSuccess"));
      }
      // Saved: nothing is lost by leaving now, so leaving does not ask.
      setSavedState(current);
      leave();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const selectedBlock = design.blocks.find((b) => b.id === selectedId);

  const detailsFields = (layout: "bar" | "panel") => (
    <>
      <Input
        ref={(el) => {
          fieldRefs.current[layout].name = el;
        }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("namePlaceholder")}
        aria-label={t("namePlaceholder")}
        className={cn("min-w-0 font-medium", layout === "bar" ? "h-8 max-w-48 text-sm" : "h-11")}
      />
      <Input
        ref={(el) => {
          fieldRefs.current[layout].subject = el;
        }}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t("subjectPlaceholder")}
        aria-label={t("subjectPlaceholder")}
        className={cn("min-w-0", layout === "bar" ? "h-8 max-w-72 text-sm" : "h-11")}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label={t("category")}
        className={cn(
          "shrink-0 rounded-md border border-input bg-background px-2",
          layout === "bar" ? "h-8 text-xs" : "h-11 w-full text-base",
        )}
      >
        {["general", "welcome", "followup", "promotional", "transactional"].map((c) => (
          <option key={c} value={c}>
            {tm(`templateCategories.${c}`)}
          </option>
        ))}
      </select>
    </>
  );

  const palette = (
    <div className="p-3">
      <p className="mb-2 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">{t("addBlock")}</p>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
        {PALETTE.map((item) => (
          <button
            type="button"
            key={item.type}
            onClick={() => addBlock(item.type)}
            className="group flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-primary/10 hover:text-primary max-lg:min-h-12"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-background group-hover:border-primary/30">
              {item.icon}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-xs leading-tight max-lg:text-sm">{t(`blocks.${item.type}.label`)}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug max-lg:text-xs">
                {t(`blocks.${item.type}.desc`)}
              </p>
            </div>
          </button>
        ))}
      </div>

      <Separator className="my-3 max-lg:hidden" />
      <p className="mb-2 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide max-lg:hidden">
        {t("design")}
      </p>
      <button
        type="button"
        onClick={() => setSelectedId("settings")}
        className={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-left font-medium text-xs transition-colors max-lg:hidden",
          selectedId === "settings" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
        )}
      >
        <LayoutTemplate className="h-4 w-4 shrink-0" />
        {t("globalSettings")}
      </button>
    </div>
  );

  const canvas = preview ? (
    <div className="flex flex-1 flex-col items-center overflow-y-auto bg-muted/40 p-3 lg:p-6">
      <p className="mb-4 text-muted-foreground text-xs">
        {preview === "mobile" ? t("mobilePreview") : t("desktopPreview")}
      </p>
      {/* No wider than the screen it is on: a 600px frame on a 375px phone was cut off. */}
      <div
        className="max-w-full overflow-hidden rounded bg-white shadow-xl"
        style={{ width: preview === "mobile" ? 375 : 600 }}
      >
        <iframe
          ref={iframeRef}
          style={{ width: "100%", height: 600, border: "none", display: "block" }}
          title={t("emailPreview")}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  ) : (
    <div className="flex-1 overflow-y-auto bg-muted/40 p-3 lg:p-6">
      {fromHtml && (
        <p className="mx-auto mb-3 max-w-[640px] rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {t("fromHtmlNotice")}
        </p>
      )}
      <div
        className="mx-auto shadow-xl"
        style={{ maxWidth: design.settings.contentWidth, backgroundColor: design.settings.backgroundColor }}
      >
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="blocks">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {design.blocks.length === 0 && (
                  <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
                    <Plus className="h-8 w-8 opacity-30" />
                    {t("emptyCanvas")}
                  </div>
                )}
                {design.blocks.map((block, index) => {
                  const selected = selectedId === block.id;
                  const control =
                    "flex size-9 items-center justify-center rounded border bg-background hover:bg-muted disabled:opacity-40 lg:size-6";
                  return (
                    <Draggable key={block.id} draggableId={block.id} index={index}>
                      {(drag, snapshot) => (
                        // biome-ignore lint/a11y/useSemanticElements: a <button> may neither contain the buttons this block already has nor carry the drag props
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={cn(
                            "group relative cursor-pointer border-2 transition-colors",
                            selected ? "border-primary" : "border-transparent hover:border-primary/30",
                            snapshot.isDragging && "opacity-80 shadow-2xl",
                          )}
                          // Selecting a block is the canvas's primary action and it
                          // was mouse-only. It cannot become a <button> — it carries
                          // the drag props and contains its own controls — so it gets
                          // the role, the focus and the keys a button would have.
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          aria-label={t(`blocks.${block.type}.label`)}
                          onClick={() => setSelectedId(block.id)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setSelectedId(block.id);
                          }}
                        >
                          <BlockPreview block={block} />

                          {/* The block's controls. On a desktop they float over its corner,
                              revealed by hover. Below lg only the selected block has them,
                              in a row of their own under it: shown on every block (a
                              touchscreen has no hover, and globals.css reveals hover
                              controls there) they covered the email being written. */}
                          <div
                            className={cn(
                              "flex items-center gap-0.5 p-1 transition-opacity",
                              "lg:absolute lg:top-0 lg:right-0",
                              "max-lg:justify-end max-lg:gap-1 max-lg:border-primary/20 max-lg:border-t max-lg:bg-primary/5",
                              selected ? "lg:opacity-100" : "max-lg:hidden lg:opacity-0 lg:group-hover:opacity-100",
                            )}
                          >
                            {/* biome-ignore lint/a11y/noStaticElementInteractions: dragHandleProps supplies the role and the tabIndex; these handlers only stop propagation */}
                            <div
                              {...drag.dragHandleProps}
                              className="flex size-9 cursor-grab items-center justify-center rounded bg-primary text-primary-foreground active:cursor-grabbing max-lg:hidden lg:size-6"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </div>
                            <button
                              type="button"
                              className={control}
                              disabled={index === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveBlock(block.id, -1);
                              }}
                              title={t("moveUp")}
                              aria-label={t("moveUp")}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={control}
                              disabled={index === design.blocks.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveBlock(block.id, 1);
                              }}
                              title={t("moveDown")}
                              aria-label={t("moveDown")}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={cn(control, "lg:hidden")}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(block.id);
                                setPanel("edit");
                              }}
                              title={t("editBlock")}
                              aria-label={t("editBlock")}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={control}
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateBlock(block.id);
                              }}
                              title={t("duplicate")}
                              aria-label={t("duplicate")}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              className={cn(control, "hover:bg-destructive hover:text-destructive-foreground")}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteBlock(block.id);
                              }}
                              title={tc("delete")}
                              aria-label={tc("delete")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>

                          {selected && (
                            <div className="absolute top-0 left-0 bg-primary px-1.5 py-0.5 font-semibold text-[10px] text-primary-foreground leading-none">
                              {t(`blocks.${block.type}.label`)}
                            </div>
                          )}
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  );

  const inspector =
    selectedId === "settings" ? (
      <SettingsInspector settings={design.settings} onChange={updateSettings} />
    ) : selectedBlock ? (
      <BlockInspector block={selectedBlock} onChange={updateBlock} />
    ) : (
      <div className="mt-8 p-4 text-center text-muted-foreground text-sm">
        <p>{t("inspector.empty")}</p>
      </div>
    );

  const MOBILE_TABS: { key: MobilePanel; icon: React.ReactNode; label: string }[] = [
    { key: "email", icon: <Mail className="size-5" />, label: t("tabs.email") },
    { key: "add", icon: <Plus className="size-5" />, label: t("tabs.add") },
    { key: "edit", icon: <Pencil className="size-5" />, label: t("tabs.edit") },
    { key: "settings", icon: <Settings2 className="size-5" />, label: t("tabs.settings") },
  ];

  return (
    // `data-fullscreen-editor`: the chat bubble steps aside (chat-widget.tsx), since it
    // would sit on the inspector and, on a phone, on this editor's own tab bar.
    <div data-fullscreen-editor="" className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ── Top bar ── */}
      {/* ⚠️ Below lg the fields leave the bar: three inputs beside five controls were
          ~50px each on a phone ("Nome mode…"). They live in the details panel there,
          and the bar keeps the name as a title, undo, preview and save. */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-2 py-2 sm:px-4 lg:gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 lg:size-8"
          onClick={() => (dirty ? setLeaving(true) : leave())}
          aria-label={tc("back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="min-w-0 flex-1 truncate font-semibold text-sm lg:hidden">{name.trim() || t("untitled")}</p>
        <div className="flex min-w-0 flex-1 items-center gap-3 max-lg:hidden">{detailsFields("bar")}</div>

        <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
          <Badge
            variant={sizeInfo.warning ? "destructive" : "secondary"}
            className="font-mono text-[10px] max-sm:hidden"
            title={t("sizeHint")}
          >
            {sizeInfo.kb} KB
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 lg:size-8"
            onClick={undo}
            disabled={history.length === 0}
            title={t("undo")}
            aria-label={t("undo")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          {/* On a phone one preview, the phone's: a 600px desktop frame is not
              something a 375px screen can show. */}
          <Button
            variant={preview ? "default" : "outline"}
            size="icon"
            className="size-9 lg:hidden"
            onClick={() => {
              setPreview(preview ? null : "mobile");
              setPanel("email");
            }}
            aria-label={t("preview")}
            aria-pressed={preview !== null}
            title={t("preview")}
          >
            {preview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            variant={preview === "desktop" ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1 text-xs max-lg:hidden"
            onClick={() => setPreview(preview === "desktop" ? null : "desktop")}
            aria-label={t("desktop")}
            aria-pressed={preview === "desktop"}
          >
            <Monitor className="h-3.5 w-3.5" />
            {t("desktop")}
          </Button>
          <Button
            variant={preview === "mobile" ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1 text-xs max-lg:hidden"
            onClick={() => setPreview(preview === "mobile" ? null : "mobile")}
            aria-label={t("mobile")}
            aria-pressed={preview === "mobile"}
          >
            <Smartphone className="h-3.5 w-3.5" />
            {t("mobile")}
          </Button>

          <Button size="sm" className="h-9 gap-1 text-xs lg:h-8" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {tc("save")}
          </Button>
        </div>
      </div>

      {/* ── Main area ── */}
      {/* ⚠️ lg and up: palette, canvas and inspector side by side. Below lg one of
          four panels at a time behind a tab bar — the email, add a block, edit the
          selected one, the details — instead of the three stacked in one scroll, where
          the canvas collapsed to a strip under the palette. Every field is controlled,
          so the phone's copy of the inspector and the desktop's share one state. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className={cn(
            "shrink-0 overflow-y-auto bg-muted/30 lg:w-52 lg:border-r",
            panel === "add" ? "max-lg:flex-1" : "max-lg:hidden",
          )}
        >
          {palette}
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col", panel !== "email" && "max-lg:hidden")}>{canvas}</div>

        <div
          className={cn(
            "shrink-0 overflow-y-auto bg-card lg:w-64 lg:border-l",
            panel === "edit" || panel === "settings" ? "max-lg:flex-1" : "max-lg:hidden",
          )}
        >
          {/* A desktop's inspector: the selected block, or the global settings. */}
          <div className="max-lg:hidden">{inspector}</div>

          {/* A phone's two panels here. The details come first in theirs: a template
              cannot be saved without a name and a subject. "Edit" is always a block;
              the global settings have their own tab. */}
          <div className="lg:hidden">
            {panel === "settings" && (
              <>
                <div className="space-y-3 border-b p-4">
                  <p className="border-b pb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    {t("templateDetails")}
                  </p>
                  {detailsFields("panel")}
                  <p className="text-muted-foreground text-xs">
                    {t("sizeLabel", { kb: sizeInfo.kb })}
                    {sizeInfo.warning && ` · ${t("sizeHint")}`}
                  </p>
                </div>
                <SettingsInspector settings={design.settings} onChange={updateSettings} />
              </>
            )}
            {panel === "edit" &&
              (selectedBlock ? (
                <BlockInspector block={selectedBlock} onChange={updateBlock} />
              ) : (
                <div className="mt-8 p-4 text-center text-muted-foreground text-sm">
                  <p>{t("inspector.emptyMobile")}</p>
                  <Button variant="outline" className="mt-4 h-11" onClick={() => setPanel("email")}>
                    {t("tabs.email")}
                  </Button>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Phone and tablet: the four panels ── */}
      <nav aria-label={t("tabs.label")} className="grid shrink-0 grid-cols-4 border-t bg-card lg:hidden">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={panel === tab.key ? "page" : undefined}
            onClick={() => {
              setPanel(tab.key);
              if (tab.key === "settings") setSelectedId("settings");
            }}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 font-medium text-[11px] transition-colors",
              panel === tab.key ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("leaveBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("stay")}</AlertDialogCancel>
            <AlertDialogAction onClick={leave} className="bg-destructive text-white hover:bg-destructive/90">
              {t("leaveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

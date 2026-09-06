"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import {
  AlignLeft,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
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
  Plus,
  RotateCcw,
  Save,
  Smartphone,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";

import { createEmailTemplate, updateEmailTemplate } from "@/actions/marketing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  type Block,
  type BlockProps,
  type BlockType,
  type ButtonProps,
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
  VARIABLES,
} from "@/lib/email-builder";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";

// ─── Block palette config ─────────────────────────────────────────────────────

const PALETTE: { type: BlockType; label: string; icon: React.ReactNode; desc: string }[] = [
  { type: "heading", label: "Heading", icon: <Type className="h-4 w-4" />, desc: "Title or section header" },
  { type: "text", label: "Text", icon: <AlignLeft className="h-4 w-4" />, desc: "Paragraph or body copy" },
  { type: "image", label: "Image", icon: <ImageIcon className="h-4 w-4" />, desc: "Full-width image" },
  { type: "button", label: "Button", icon: <MousePointer className="h-4 w-4" />, desc: "Call-to-action button" },
  { type: "divider", label: "Divider", icon: <Minus className="h-4 w-4" />, desc: "Horizontal separator" },
  { type: "spacer", label: "Spacer", icon: <LayoutTemplate className="h-4 w-4" />, desc: "Vertical whitespace" },
  { type: "two_column", label: "2 Columns", icon: <Columns className="h-4 w-4" />, desc: "Side-by-side layout" },
  { type: "footer", label: "Footer", icon: <Mail className="h-4 w-4" />, desc: "Footer with unsubscribe" },
  { type: "html", label: "Custom HTML", icon: <Code2 className="h-4 w-4" />, desc: "Raw HTML block" },
];

// ─── Canvas block preview ─────────────────────────────────────────────────────

function BlockPreview({ block }: { block: Block }) {
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
          <Tag style={{ margin: 0, color: p.color, fontWeight: "bold", lineHeight: 1.3 }}>{p.text || "Heading"}</Tag>
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
          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(p.html || "<p>Text block</p>") }}
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
              <ImageIcon className="h-5 w-5 mr-2" /> Set image URL in panel →
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
            {p.label || "Button"}
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
          <span style={{ fontSize: 10, color: "#d1d5db" }}>spacer {p.height}px</span>
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
                  ? '<p style="margin:8px 0 0 0;"><a href="#" style="color:inherit;">Unsubscribe</a></p>'
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
            {p.html || "<!-- HTML block →"}
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
        className="h-7 w-10 rounded cursor-pointer border border-input p-0.5"
      />
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-7 text-xs font-mono flex-1" />
    </div>
  );
}

function AlignButtons({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
          {a}
        </Button>
      ))}
    </div>
  );
}

function BlockInspector({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const set = (patch: Partial<BlockProps>) => onChange({ ...block, props: { ...block.props, ...patch } });

  const p = block.props;

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-2">
        {PALETTE.find((x) => x.type === block.type)?.label ?? block.type} Properties
      </p>

      {block.type === "heading" &&
        (() => {
          const hp = p as HeadingProps;
          return (
            <>
              <Row label="Text">
                <Input value={hp.text} onChange={(e) => set({ text: e.target.value } as any)} className="h-8 text-sm" />
              </Row>
              <Row label="Level">
                <select
                  value={hp.level}
                  onChange={(e) => set({ level: e.target.value } as any)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="h1">H1 — Large</option>
                  <option value="h2">H2 — Medium</option>
                  <option value="h3">H3 — Small</option>
                </select>
              </Row>
              <Row label="Alignment">
                <AlignButtons value={hp.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label="Text Color">
                <ColorInput value={hp.color} onChange={(v) => set({ color: v } as any)} />
              </Row>
              <Row label="Background">
                <ColorInput value={hp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label="Padding Top">
                <Input
                  type="number"
                  value={hp.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding Bottom">
                <Input
                  type="number"
                  value={hp.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
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
              <Row label="Content">
                <Textarea
                  value={tp.html}
                  onChange={(e) => set({ html: e.target.value } as any)}
                  className="text-xs font-mono min-h-[120px] resize-y"
                />
              </Row>
              <Row label="Alignment">
                <AlignButtons value={tp.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label="Color">
                <ColorInput value={tp.color} onChange={(v) => set({ color: v } as any)} />
              </Row>
              <Row label="Background">
                <ColorInput value={tp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label="Font Size (px)">
                <Input
                  type="number"
                  value={tp.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Line Height">
                <Input
                  type="number"
                  step="0.1"
                  value={tp.lineHeight}
                  onChange={(e) => set({ lineHeight: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding Top">
                <Input
                  type="number"
                  value={tp.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding Bottom">
                <Input
                  type="number"
                  value={tp.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
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
              <Row label="Image URL">
                <Input
                  value={ip.src}
                  onChange={(e) => set({ src: e.target.value } as any)}
                  className="h-8 text-sm"
                  placeholder="https://…"
                />
              </Row>
              <Row label="Alt Text">
                <Input value={ip.alt} onChange={(e) => set({ alt: e.target.value } as any)} className="h-8 text-sm" />
              </Row>
              <Row label="Link (href)">
                <Input
                  value={ip.href}
                  onChange={(e) => set({ href: e.target.value } as any)}
                  className="h-8 text-sm"
                  placeholder="https://…"
                />
              </Row>
              <Row label="Width (%)">
                <Input
                  type="number"
                  min={10}
                  max={100}
                  value={ip.width}
                  onChange={(e) => set({ width: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Alignment">
                <AlignButtons value={ip.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label="Background">
                <ColorInput value={ip.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label="Padding Top">
                <Input
                  type="number"
                  value={ip.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding Bottom">
                <Input
                  type="number"
                  value={ip.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
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
              <Row label="Label">
                <Input
                  value={bp.label}
                  onChange={(e) => set({ label: e.target.value } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Link (href)">
                <Input
                  value={bp.href}
                  onChange={(e) => set({ href: e.target.value } as any)}
                  className="h-8 text-sm"
                  placeholder="https://…"
                />
              </Row>
              <Row label="Alignment">
                <AlignButtons value={bp.align} onChange={(v) => set({ align: v } as any)} />
              </Row>
              <Row label="Button Color">
                <ColorInput value={bp.bgColor} onChange={(v) => set({ bgColor: v } as any)} />
              </Row>
              <Row label="Text Color">
                <ColorInput value={bp.textColor} onChange={(v) => set({ textColor: v } as any)} />
              </Row>
              <Row label="Background">
                <ColorInput value={bp.blockBg} onChange={(v) => set({ blockBg: v } as any)} />
              </Row>
              <Row label="Border Radius (px)">
                <Input
                  type="number"
                  value={bp.borderRadius}
                  onChange={(e) => set({ borderRadius: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Font Size (px)">
                <Input
                  type="number"
                  value={bp.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding H (px)">
                <Input
                  type="number"
                  value={bp.paddingH}
                  onChange={(e) => set({ paddingH: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding V (px)">
                <Input
                  type="number"
                  value={bp.paddingV}
                  onChange={(e) => set({ paddingV: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
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
              <Row label="Color">
                <ColorInput value={dp.color} onChange={(v) => set({ color: v } as any)} />
              </Row>
              <Row label="Background">
                <ColorInput value={dp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label="Thickness (px)">
                <Input
                  type="number"
                  min={1}
                  value={dp.thickness}
                  onChange={(e) => set({ thickness: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding Top">
                <Input
                  type="number"
                  value={dp.paddingTop}
                  onChange={(e) => set({ paddingTop: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Padding Bottom">
                <Input
                  type="number"
                  value={dp.paddingBottom}
                  onChange={(e) => set({ paddingBottom: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
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
              <Row label="Height (px)">
                <Input
                  type="number"
                  min={4}
                  value={sp.height}
                  onChange={(e) => set({ height: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Background">
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
              <Row label="Left Content">
                <Textarea
                  value={tp.leftHtml}
                  onChange={(e) => set({ leftHtml: e.target.value } as any)}
                  className="text-xs font-mono min-h-[80px] resize-y"
                />
              </Row>
              <Row label="Right Content">
                <Textarea
                  value={tp.rightHtml}
                  onChange={(e) => set({ rightHtml: e.target.value } as any)}
                  className="text-xs font-mono min-h-[80px] resize-y"
                />
              </Row>
              <Row label="Left Background">
                <ColorInput value={tp.leftBg} onChange={(v) => set({ leftBg: v } as any)} />
              </Row>
              <Row label="Right Background">
                <ColorInput value={tp.rightBg} onChange={(v) => set({ rightBg: v } as any)} />
              </Row>
              <Row label="Background">
                <ColorInput value={tp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label="Gap (px)">
                <Input
                  type="number"
                  value={tp.gap}
                  onChange={(e) => set({ gap: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
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
              <Row label="Content">
                <Textarea
                  value={fp.html}
                  onChange={(e) => set({ html: e.target.value } as any)}
                  className="text-xs font-mono min-h-[80px] resize-y"
                />
              </Row>
              <Row label="Background">
                <ColorInput value={fp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
              <Row label="Text Color">
                <ColorInput value={fp.textColor} onChange={(v) => set({ textColor: v } as any)} />
              </Row>
              <Row label="Font Size (px)">
                <Input
                  type="number"
                  value={fp.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) } as any)}
                  className="h-8 text-sm"
                />
              </Row>
              <Row label="Show Unsubscribe">
                <button
                  type="button"
                  onClick={() => set({ showUnsubscribe: !fp.showUnsubscribe } as any)}
                  className={`h-8 w-12 rounded-full transition-colors relative ${fp.showUnsubscribe ? "bg-primary" : "bg-muted"}`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${fp.showUnsubscribe ? "translate-x-5" : "translate-x-1"}`}
                  />
                </button>
              </Row>
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
                  className="text-xs font-mono min-h-[200px] resize-y"
                  placeholder="<table>…</table>"
                />
              </Row>
              <Row label="Background">
                <ColorInput value={hp.backgroundColor} onChange={(v) => set({ backgroundColor: v } as any)} />
              </Row>
            </>
          );
        })()}

      {/* Variables helper */}
      <Separator />
      <div className="space-y-1">
        <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">Insert Variable</p>
        <div className="flex flex-wrap gap-1">
          {VARIABLES.map((v) => (
            <Badge
              key={v.key}
              variant="outline"
              className="cursor-pointer font-mono text-[9px] hover:bg-primary hover:text-primary-foreground transition-colors"
              title={v.label}
              onClick={() => {
                // Copy to clipboard
                navigator.clipboard.writeText(v.key).then(() => toast.success(`Copied ${v.key}`));
              }}
            >
              {v.key}
            </Badge>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground">Click to copy, then paste in text fields above.</p>
      </div>
    </div>
  );
}

// ─── Settings inspector ───────────────────────────────────────────────────────

function SettingsInspector({ settings, onChange }: { settings: EmailSettings; onChange: (s: EmailSettings) => void }) {
  const set = (patch: Partial<EmailSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="space-y-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-2">
        Global Settings
      </p>
      <Row label="Background Color">
        <ColorInput value={settings.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
      </Row>
      <Row label="Content Width (px)">
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
      <Row label="Font Family">
        <select
          value={settings.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
          className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="Arial, Helvetica, sans-serif">Arial (recommended)</option>
          <option value="Georgia, 'Times New Roman', serif">Georgia</option>
          <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
          <option value="Verdana, Geneva, sans-serif">Verdana</option>
        </select>
      </Row>
      <Row label="Preview Text (hidden pre-header)">
        <Input
          value={settings.previewText}
          onChange={(e) => set({ previewText: e.target.value })}
          className="h-8 text-sm"
          placeholder="A short preview shown in inbox…"
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
}

export function EmailBuilder({
  templateId,
  initialName = "",
  initialSubject = "",
  initialDesign,
  initialCategory = "general",
}: EmailBuilderProps) {
  const router = useRouter();
  const [design, setDesign] = useState<EmailDesign>(initialDesign ?? emptyDesign());
  const [selectedId, setSelectedId] = useState<string | "settings" | null>("settings");
  const [preview, setPreview] = useState<"desktop" | "mobile" | null>(null);
  const [name, setName] = useState(initialName);
  const [subject, setSubject] = useState(initialSubject);
  const [category, setCategory] = useState(initialCategory);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<EmailDesign[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const pushHistory = useCallback((d: EmailDesign) => {
    setHistory((h) => [...h.slice(-19), d]);
    setDesign(d);
  }, []);

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setDesign(prev);
  };

  const updateBlock = useCallback((updated: Block) => {
    setDesign((d) => ({
      ...d,
      blocks: d.blocks.map((b) => (b.id === updated.id ? updated : b)),
    }));
  }, []);

  const addBlock = (type: BlockType) => {
    const block = newBlock(type);
    pushHistory({ ...design, blocks: [...design.blocks, block] });
    setSelectedId(block.id);
  };

  const deleteBlock = (id: string) => {
    pushHistory({ ...design, blocks: design.blocks.filter((b) => b.id !== id) });
    setSelectedId(null);
  };

  const duplicateBlock = (id: string) => {
    const idx = design.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const clone = { ...design.blocks[idx], id: Math.random().toString(36).slice(2, 9) };
    const next = [...design.blocks];
    next.splice(idx + 1, 0, clone);
    pushHistory({ ...design, blocks: next });
    setSelectedId(clone.id);
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const blocks = [...design.blocks];
    const [moved] = blocks.splice(result.source.index, 1);
    blocks.splice(result.destination.index, 0, moved);
    pushHistory({ ...design, blocks });
  };

  // Live preview update
  useEffect(() => {
    if (preview && iframeRef.current) {
      const html = compileToHtml(design, subject);
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
      }
    }
  }, [preview, design, subject]);

  const html = compileToHtml(design, subject);
  const sizeInfo = estimateHtmlSize(html);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Enter a template name.");
      return;
    }
    if (!subject.trim()) {
      toast.error("Enter a subject line.");
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
        toast.success("Template updated.");
      } else {
        await createEmailTemplate(payload);
        toast.success("Template created.");
      }
      router.push("/dashboard/marketing/templates");
    } catch {
      toast.error("Failed to save template.");
    } finally {
      setSaving(false);
    }
  };

  const selectedBlock = design.blocks.find((b) => b.id === selectedId);

  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-card shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push("/dashboard/marketing/templates")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name…"
            className="h-8 text-sm max-w-48 font-medium"
          />
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line…"
            className="h-8 text-sm max-w-72"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {["general", "welcome", "followup", "promotional", "transactional"].map((c) => (
              <option key={c} value={c} className="capitalize">
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Size indicator */}
          <Badge variant={sizeInfo.warning ? "destructive" : "secondary"} className="text-[10px] font-mono">
            {sizeInfo.kb} KB
          </Badge>

          {/* Undo */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={undo}
            disabled={history.length === 0}
            title="Undo"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>

          {/* Preview */}
          <Button
            variant={preview === "desktop" ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setPreview(preview === "desktop" ? null : "desktop")}
          >
            <Monitor className="h-3.5 w-3.5" />
            Desktop
          </Button>
          <Button
            variant={preview === "mobile" ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setPreview(preview === "mobile" ? null : "mobile")}
          >
            <Smartphone className="h-3.5 w-3.5" />
            Mobile
          </Button>

          <Button size="sm" className="h-8 gap-1 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>

      {/* ── Main area ── */}
      {/* ⚠️ Three columns of 208, flexible and 256 pixels is a layout for a
          desktop. Below lg they stack and the page scrolls — canvas first,
          because that is what is being looked at, then the palette and the
          inspector under it. Not delightful on a phone, but usable, which is
          more than three columns sharing 343px manage. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ── Left: Block palette ── */}
        <div className="order-2 w-full shrink-0 overflow-y-auto border-t bg-muted/30 lg:order-none lg:w-52 lg:border-t-0 lg:border-r">
          <div className="p-3">
            <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground mb-2">Add Block</p>
            <div className="space-y-1">
              {PALETTE.map((item) => (
                <button
                  type="button"
                  key={item.type}
                  onClick={() => addBlock(item.type)}
                  className="w-full flex items-center gap-2.5 p-2 rounded-md text-left hover:bg-primary/10 hover:text-primary transition-colors group"
                >
                  <span className="h-7 w-7 rounded flex items-center justify-center bg-background border group-hover:border-primary/30 shrink-0">
                    {item.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-none">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            <Separator className="my-3" />
            <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground mb-2">Design</p>
            <button
              type="button"
              onClick={() => setSelectedId("settings")}
              className={`w-full flex items-center gap-2 p-2 rounded-md text-left text-xs font-medium transition-colors ${selectedId === "settings" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <LayoutTemplate className="h-4 w-4 shrink-0" />
              Global Settings
            </button>
          </div>
        </div>

        {/* ── Center: Canvas or Preview ── */}
        {preview ? (
          <div className="order-1 flex flex-1 flex-col items-center overflow-y-auto bg-muted/40 p-4 lg:order-none lg:p-6">
            <p className="text-xs text-muted-foreground mb-4">
              {preview === "mobile" ? "Mobile preview (375px)" : "Desktop preview (600px)"}
            </p>
            <div
              className="shadow-xl rounded overflow-hidden bg-white"
              style={{ width: preview === "mobile" ? 375 : 600 }}
            >
              <iframe
                ref={iframeRef}
                style={{ width: "100%", height: 600, border: "none", display: "block" }}
                title="Email preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-muted/40 overflow-y-auto p-6">
            <div
              className="mx-auto shadow-xl"
              style={{ maxWidth: design.settings.contentWidth, backgroundColor: design.settings.backgroundColor }}
            >
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="blocks">
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                      {design.blocks.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
                          <Plus className="h-8 w-8 opacity-30" />
                          Click a block in the left panel to add it
                        </div>
                      )}
                      {design.blocks.map((block, index) => (
                        <Draggable key={block.id} draggableId={block.id} index={index}>
                          {(drag, snapshot) => (
                            // biome-ignore lint/a11y/useSemanticElements: a <button> may neither contain the buttons this block already has nor carry the drag props
                            <div
                              ref={drag.innerRef}
                              {...drag.draggableProps}
                              className={`relative group cursor-pointer border-2 transition-colors ${
                                selectedId === block.id
                                  ? "border-primary"
                                  : "border-transparent hover:border-primary/30"
                              } ${snapshot.isDragging ? "opacity-80 shadow-2xl" : ""}`}
                              // Selecting a block is the canvas's primary action and it
                              // was mouse-only. It cannot become a <button> — it carries
                              // the drag props and contains its own controls — so it gets
                              // the role, the focus and the keys a button would have.
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedId(block.id)}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                setSelectedId(block.id);
                              }}
                            >
                              {/* Block preview */}
                              <BlockPreview block={block} />

                              {/* Controls overlay */}
                              <div
                                className={`absolute top-0 right-0 flex items-center gap-0.5 p-1 transition-opacity ${selectedId === block.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                              >
                                {/* biome-ignore lint/a11y/noStaticElementInteractions: dragHandleProps supplies the role and the tabIndex; these handlers only stop propagation */}
                                <div
                                  {...drag.dragHandleProps}
                                  className="h-6 w-6 flex items-center justify-center rounded bg-primary text-primary-foreground cursor-grab active:cursor-grabbing"
                                  // The handle only stops the click reaching the block
                                  // behind it; the library supplies its own role, focus
                                  // and drag keys through dragHandleProps.
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  <GripVertical className="h-3.5 w-3.5" />
                                </div>
                                <button
                                  type="button"
                                  className="h-6 w-6 flex items-center justify-center rounded bg-background border hover:bg-muted"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    duplicateBlock(block.id);
                                  }}
                                  title="Duplicate"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  className="h-6 w-6 flex items-center justify-center rounded bg-background border hover:bg-destructive hover:text-destructive-foreground"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteBlock(block.id);
                                  }}
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>

                              {/* Type label */}
                              {selectedId === block.id && (
                                <div className="absolute top-0 left-0 bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                                  {PALETTE.find((x) => x.type === block.type)?.label}
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>
        )}

        {/* ── Right: Inspector ── */}
        <div className="order-3 w-full shrink-0 overflow-y-auto border-t bg-card lg:order-none lg:w-64 lg:border-t-0 lg:border-l">
          {selectedId === "settings" ? (
            <SettingsInspector settings={design.settings} onChange={(s) => setDesign((d) => ({ ...d, settings: s }))} />
          ) : selectedBlock ? (
            <BlockInspector block={selectedBlock} onChange={updateBlock} />
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center mt-8">
              <p>Select a block on the canvas to edit its properties.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

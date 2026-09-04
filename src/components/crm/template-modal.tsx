"use client";

import { useState } from "react";

import { toast } from "sonner";

import { createEmailTemplate, updateEmailTemplate } from "@/actions/marketing";
import { PlaceholderHelp } from "@/components/crm/placeholder-help";
import { RichTextEditor } from "@/components/crm/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { renderPlaceholders, sampleValues } from "@/lib/email-placeholders";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";

interface TemplateModalProps {
  template?: {
    id: string;
    name: string;
    description?: string;
    subject: string;
    body: string;
    isHtml?: boolean;
    category?: string;
    previewText?: string;
    tags?: string[];
  };
  onSuccess?: () => void;
}

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "welcome", label: "Welcome" },
  { value: "followup", label: "Follow-up" },
  { value: "promotional", label: "Promotional" },
  { value: "transactional", label: "Transactional" },
];

export function TemplateModal({ template, onSuccess }: TemplateModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("editor");
  const [formData, setFormData] = useState({
    name: template?.name || "",
    description: template?.description || "",
    subject: template?.subject || "",
    body: template?.body || "",
    isHtml: template?.isHtml !== false,
    category: template?.category || "general",
    previewText: template?.previewText || "",
    tags: template?.tags || [],
  });
  const [tagInput, setTagInput] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (template) {
        await updateEmailTemplate(template.id, formData);
        toast.success("Template updated successfully");
      } else {
        await createEmailTemplate(formData);
        toast.success("Template created successfully");
      }
      setOpen(false);
      setFormData({
        name: "",
        description: "",
        subject: "",
        body: "",
        isHtml: true,
        category: "general",
        previewText: "",
        tags: [],
      });
      onSuccess?.();
    } catch (_error) {
      toast.error("Failed to save template");
    } finally {
      setLoading(false);
    }
  }

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({
        ...formData,
        tags: [...formData.tags, tagInput.trim()],
      });
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((t) => t !== tag),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => setOpen(true)}
        variant={template ? "ghost" : "default"}
        size={template ? "icon" : "default"}
        className={template ? "h-8 w-8" : "gap-2"}
      >
        {template ? (
          <>📝</>
        ) : (
          <>
            <span>➕</span> New Template
          </>
        )}
      </Button>

      <DialogContent className="!max-w-7xl flex max-h-[95vh] w-[90vw] flex-col p-0">
        <DialogHeader className="flex-shrink-0 border-b px-8 py-6">
          <DialogTitle className="text-2xl">
            {template ? "Edit Email Template" : "Create New Email Template"}
          </DialogTitle>
          <DialogDescription>
            Design a professional email template with HTML support and dynamic placeholders.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 pb-6">
          {/* Basic Info - Compact Grid */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="font-semibold text-sm">
                Template Name *
              </Label>
              <Input
                id="name"
                placeholder="e.g., Welcome Email"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category" className="font-semibold text-sm">
                Category
              </Label>
              <select
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="subject" className="font-semibold text-sm">
                Subject Line *
              </Label>
              <Input
                id="subject"
                placeholder="e.g., Welcome to Flux, {{nome}}!"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>

            <div className="flex items-end">
              <Label
                htmlFor="isHtml"
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950"
              >
                <input
                  id="isHtml"
                  type="checkbox"
                  checked={formData.isHtml}
                  onChange={(e) => setFormData({ ...formData, isHtml: e.target.checked })}
                  className="h-4 w-4 cursor-pointer"
                />
                <span className="font-semibold">{formData.isHtml ? "HTML" : "Plain Text"}</span>
              </Label>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="font-semibold text-sm">
              Description (Internal Notes)
            </Label>
            <Textarea
              id="description"
              placeholder="Internal notes about this template, usage guidelines, target audience..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="h-20 resize-none text-sm"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Tags (Organization)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Add tag (e.g., sales, onboarding, q2-2026) and press Enter"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                className="h-9 flex-1 text-sm"
              />
              <Button type="button" variant="outline" onClick={addTag} className="h-9 px-4 text-sm">
                Add Tag
              </Button>
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {formData.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="cursor-pointer text-sm hover:bg-secondary/80"
                    onClick={() => removeTag(tag)}
                  >
                    {tag} ✕
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Editor & Preview - Full Width Tabs */}
          <div className="flex flex-1 flex-col overflow-auto rounded-lg border">
            <Tabs defaultValue="visual" value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
              <TabsList className="w-full justify-start rounded-none border-b bg-muted/50">
                <TabsTrigger value="visual" className="font-semibold text-sm">
                  ✏️ Visual Editor
                </TabsTrigger>
                <TabsTrigger value="editor" className="font-semibold text-sm">
                  📝 HTML Source
                </TabsTrigger>
                <TabsTrigger value="preview" className="font-semibold text-sm">
                  👁️ Preview
                </TabsTrigger>
              </TabsList>

              {/* Visual (TipTap) Editor */}
              <TabsContent value="visual" className="min-h-0 flex-1 overflow-auto p-2">
                <RichTextEditor
                  value={formData.body}
                  onChange={(html) => setFormData((f) => ({ ...f, body: html }))}
                  placeholder="Write your email content using the toolbar above…"
                  className="min-h-[320px] border-0"
                />
              </TabsContent>

              {/* HTML Source */}
              <TabsContent value="editor" className="min-h-0 flex-1 overflow-auto">
                <Textarea
                  placeholder='<div style="font-family: Arial, sans-serif; padding: 20px;"><h1>Hello {{nome}}!</h1></div>'
                  value={formData.body}
                  onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                  className="h-full min-h-[320px] w-full resize-none rounded-none border-0 p-4 font-mono text-sm"
                  required
                />
              </TabsContent>

              {/* Preview */}
              <TabsContent
                value="preview"
                className="flex-1 overflow-auto bg-gradient-to-b from-muted/20 to-muted/40 p-8"
              >
                <div className="mx-auto max-w-3xl">
                  {/* Three of the eight placeholders, substituted here with a
                      different set from the one the send path used — so the
                      preview agreed with neither (audit rilievo S-08). Both now
                      come from the same catalogue. */}
                  <div
                    className="rounded-lg bg-white p-8 font-sans text-sm shadow-lg"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: an email body is HTML by definition; sanitised
                    dangerouslySetInnerHTML={{
                      __html: sanitizeEmailHtml(renderPlaceholders(formData.body, sampleValues())),
                    }}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* This used to advertise five placeholder names — firstName, lastName,
              email, companyName, phone — that the send path substituted none of.
              Anybody who followed the hint sent them to a customer verbatim. They
              are real names now, and this panel also says what will not resolve
              and whether there is a way to unsubscribe. */}
          <PlaceholderHelp subject={formData.subject} body={formData.body} />

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-10 px-6 text-sm">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="h-10 px-6 font-semibold text-sm">
              {loading ? "Saving..." : template ? "Update Template" : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

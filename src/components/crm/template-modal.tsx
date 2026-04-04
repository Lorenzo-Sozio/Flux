"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { createEmailTemplate, updateEmailTemplate } from "@/actions/marketing";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor } from "@/components/crm/rich-text-editor";

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
    } catch (error) {
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

      <DialogContent className="!max-w-7xl w-[90vw] max-h-[95vh] flex flex-col p-0">
        <DialogHeader className="px-8 py-6 border-b flex-shrink-0">
          <DialogTitle className="text-2xl">{template ? "Edit Email Template" : "Create New Email Template"}</DialogTitle>
          <DialogDescription>
            Design a professional email template with HTML support and dynamic placeholders.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1 overflow-y-auto px-8 pb-6">
          {/* Basic Info - Compact Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-semibold">Template Name *</Label>
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
              <Label htmlFor="category" className="text-sm font-semibold">Category</Label>
              <select
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="subject" className="text-sm font-semibold">Subject Line *</Label>
              <Input
                id="subject"
                placeholder="e.g., Welcome to Flux, {firstName}!"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>

            <div className="flex items-end">
              <Label htmlFor="isHtml" className="text-sm cursor-pointer flex items-center gap-2 bg-blue-50 dark:bg-blue-950 p-3 rounded-md border border-blue-200 dark:border-blue-800 w-full justify-center">
                <input
                  id="isHtml"
                  type="checkbox"
                  checked={formData.isHtml}
                  onChange={(e) => setFormData({ ...formData, isHtml: e.target.checked })}
                  className="cursor-pointer w-4 h-4"
                />
                <span className="font-semibold">{formData.isHtml ? "HTML" : "Plain Text"}</span>
              </Label>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-semibold">Description (Internal Notes)</Label>
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
            <Label className="text-sm font-semibold">Tags (Organization)</Label>
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
                className="h-9 text-sm flex-1"
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
                    className="text-sm cursor-pointer hover:bg-secondary/80"
                    onClick={() => removeTag(tag)}
                  >
                    {tag} ✕
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Editor & Preview - Full Width Tabs */}
          <div className="flex-1 overflow-auto border rounded-lg flex flex-col">
            <Tabs defaultValue="visual" value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b bg-muted/50">
                <TabsTrigger value="visual" className="text-sm font-semibold">✏️ Visual Editor</TabsTrigger>
                <TabsTrigger value="editor" className="text-sm font-semibold">📝 HTML Source</TabsTrigger>
                <TabsTrigger value="preview" className="text-sm font-semibold">👁️ Preview</TabsTrigger>
              </TabsList>

              {/* Visual (TipTap) Editor */}
              <TabsContent value="visual" className="flex-1 overflow-auto min-h-0 p-2">
                <RichTextEditor
                  value={formData.body}
                  onChange={(html) => setFormData((f) => ({ ...f, body: html }))}
                  placeholder="Write your email content using the toolbar above…"
                  className="min-h-[320px] border-0"
                />
              </TabsContent>

              {/* HTML Source */}
              <TabsContent value="editor" className="flex-1 overflow-auto min-h-0">
                <Textarea
                  placeholder='<div style="font-family: Arial, sans-serif; padding: 20px;"><h1>Hello {{nome}}!</h1></div>'
                  value={formData.body}
                  onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                  className="w-full h-full min-h-[320px] font-mono text-sm border-0 rounded-none resize-none p-4"
                  required
                />
              </TabsContent>

              {/* Preview */}
              <TabsContent value="preview" className="flex-1 overflow-auto p-8 bg-gradient-to-b from-muted/20 to-muted/40">
                <div className="max-w-3xl mx-auto">
                  <div className="bg-white rounded-lg shadow-lg p-8 font-sans text-sm"
                    dangerouslySetInnerHTML={{
                      __html: formData.body
                        .replace(/\{\{nome\}\}/gi, "Mario")
                        .replace(/\{\{cognome\}\}/gi, "Rossi")
                        .replace(/\{\{email\}\}/gi, "mario.rossi@example.com")
                    }}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Footer Info */}
          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">
              💡 Available placeholders: <code className="bg-muted px-2 py-1 rounded text-xs font-mono">firstName</code> <code className="bg-muted px-2 py-1 rounded text-xs font-mono">lastName</code> <code className="bg-muted px-2 py-1 rounded text-xs font-mono">email</code> <code className="bg-muted px-2 py-1 rounded text-xs font-mono">companyName</code> <code className="bg-muted px-2 py-1 rounded text-xs font-mono">phone</code>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-10 px-6 text-sm">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="h-10 px-6 text-sm font-semibold">
              {loading ? "Saving..." : template ? "Update Template" : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

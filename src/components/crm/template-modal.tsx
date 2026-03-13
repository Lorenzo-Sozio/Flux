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

      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{template ? "Edit Email Template" : "Create New Email Template"}</DialogTitle>
          <DialogDescription>
            Design a professional email template with HTML support and dynamic placeholders.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1 overflow-hidden px-6 pb-6">
          {/* Basic Info - Compact Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs">Template Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Welcome Email"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-8 text-sm"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category" className="text-xs">Category</Label>
              <select
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="subject" className="text-xs">Subject Line *</Label>
              <Input
                id="subject"
                placeholder="e.g., Welcome to Flux, {firstName}!"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="h-8 text-sm"
                required
              />
            </div>
          </div>

          {/* Description & Preview - Compact */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="description" className="text-xs">Description</Label>
              <Textarea
                id="description"
                placeholder="Internal notes about this template..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="h-16 resize-none text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="previewText" className="text-xs">Preview Text</Label>
              <Textarea
                id="previewText"
                placeholder="Short text shown in email preview"
                value={formData.previewText}
                onChange={(e) => setFormData({ ...formData, previewText: e.target.value })}
                className="h-16 resize-none text-xs"
              />
            </div>
          </div>

          {/* Tags & Checkbox - Horizontal */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 space-y-2">
              <Label className="text-xs">Tags</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add tag and press Enter"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  className="h-8 text-sm flex-1"
                />
                <Button type="button" variant="outline" onClick={addTag} className="h-8 px-3 text-xs">
                  Add
                </Button>
              </div>
              {formData.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {formData.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-xs cursor-pointer hover:bg-secondary/80"
                      onClick={() => removeTag(tag)}
                    >
                      {tag} ✕
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-end">
              <Label htmlFor="isHtml" className="text-xs cursor-pointer flex items-center gap-2 bg-muted p-2 rounded">
                <input
                  id="isHtml"
                  type="checkbox"
                  checked={formData.isHtml}
                  onChange={(e) => setFormData({ ...formData, isHtml: e.target.checked })}
                  className="cursor-pointer"
                />
                <span>HTML Format</span>
              </Label>
            </div>
          </div>

          {/* Editor & Preview - Full Width Tabs */}
          <div className="flex-1 overflow-hidden border rounded-lg flex flex-col">
            <Tabs defaultValue="editor" value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b">
                <TabsTrigger value="editor" className="text-xs">HTML Editor</TabsTrigger>
                <TabsTrigger value="preview" className="text-xs">Live Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="editor" className="flex-1 overflow-hidden">
                <Textarea
                  placeholder={`${
                    formData.isHtml
                      ? '<div style="font-family: Arial, sans-serif; padding: 20px;"><h1>Welcome, {firstName}!</h1><p>Your account is ready.</p></div>'
                      : "Write your email content here. Use {firstName}, {lastName}, {email}, {companyName} for placeholders."
                  }`}
                  value={formData.body}
                  onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                  className="w-full h-full font-mono text-xs border-0 rounded-none resize-none"
                  required
                />
              </TabsContent>

              <TabsContent value="preview" className="flex-1 overflow-auto p-6 bg-muted/20">
                <div className="max-w-2xl">
                  {formData.isHtml ? (
                    <div
                      className="bg-white rounded-lg shadow-sm p-6 font-sans text-sm"
                      dangerouslySetInnerHTML={{ __html: formData.body }}
                    />
                  ) : (
                    <div className="bg-white rounded-lg shadow-sm p-6 font-sans whitespace-pre-wrap text-sm">
                      {formData.body}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Info & Footer */}
          <div className="text-xs text-muted-foreground">
            💡 Available placeholders: firstName, lastName, email, companyName, phone
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9 text-sm">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="h-9 text-sm">
              {loading ? "Saving..." : template ? "Update Template" : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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

      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{template ? "Edit Email Template" : "Create New Email Template"}</DialogTitle>
          <DialogDescription>
            Design a professional email template with HTML support and dynamic placeholders.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1 overflow-hidden">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Welcome Email"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
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

            <div className="space-y-2">
              <Label htmlFor="subject">Subject Line *</Label>
              <Input
                id="subject"
                placeholder="e.g., Welcome to Flux, {firstName}!"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Description & Preview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Internal notes about this template..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="h-20 resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="previewText">Preview Text (Email Client)</Label>
              <Textarea
                id="previewText"
                placeholder="Short text shown in email preview (50-100 chars)"
                value={formData.previewText}
                onChange={(e) => setFormData({ ...formData, previewText: e.target.value })}
                className="h-20 resize-none"
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Add tag and press Enter or Add"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTag}>
                Add
              </Button>
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="cursor-pointer hover:bg-secondary/80"
                    onClick={() => removeTag(tag)}
                  >
                    {tag} ✕
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Editor & Preview Tabs */}
          <div className="flex-1 overflow-hidden border rounded-lg">
            <Tabs defaultValue="editor" value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b">
                <TabsTrigger value="editor">HTML Editor</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <div className="ml-auto flex items-center gap-2 pr-4">
                  <Label htmlFor="isHtml" className="text-xs cursor-pointer flex items-center gap-1">
                    <input
                      id="isHtml"
                      type="checkbox"
                      checked={formData.isHtml}
                      onChange={(e) => setFormData({ ...formData, isHtml: e.target.checked })}
                    />
                    HTML Format
                  </Label>
                </div>
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
                  className="w-full h-full font-mono text-sm border-0 rounded-none resize-none"
                  required
                />
              </TabsContent>

              <TabsContent value="preview" className="flex-1 overflow-auto p-4 bg-muted/20">
                {formData.isHtml ? (
                  <div
                    className="bg-white rounded-lg shadow-sm p-6 font-sans"
                    dangerouslySetInnerHTML={{ __html: formData.body }}
                  />
                ) : (
                  <div className="bg-white rounded-lg shadow-sm p-6 font-sans whitespace-pre-wrap">
                    {formData.body}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Info */}
          <div className="text-xs text-muted-foreground">
            💡 Available placeholders: firstName, lastName, email, companyName, phone
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : template ? "Update Template" : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

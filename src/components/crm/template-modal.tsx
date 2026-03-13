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
import { toast } from "sonner";
import { createEmailTemplate, updateEmailTemplate } from "@/actions/marketing";

interface TemplateModalProps {
  template?: {
    id: string;
    name: string;
    subject: string;
    body: string;
  };
  onSuccess?: () => void;
}

export function TemplateModal({ template, onSuccess }: TemplateModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: template?.name || "",
    subject: template?.subject || "",
    body: template?.body || "",
  });

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
      setFormData({ name: "", subject: "", body: "" });
      onSuccess?.();
    } catch (error) {
      toast.error("Failed to save template");
    } finally {
      setLoading(false);
    }
  }

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

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edit Template" : "Create New Template"}</DialogTitle>
          <DialogDescription>
            Design your email template with dynamic placeholders like {"{firstName}"} and {"{lastName}"}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Template Name</Label>
            <Input
              id="name"
              placeholder="e.g., Welcome Email, Follow-up"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Email Subject Line</Label>
            <Input
              id="subject"
              placeholder="e.g., Welcome to Flux CRM, {firstName}!"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Email Body</Label>
            <Textarea
              id="body"
              placeholder="Write your email content here. Use {firstName}, {lastName}, {email}, {companyName} for dynamic placeholders."
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              className="min-h-[300px]"
              required
            />
            <p className="text-xs text-muted-foreground">
              Available placeholders: firstName, lastName, email, companyName
            </p>
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

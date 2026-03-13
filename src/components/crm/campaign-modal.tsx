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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createMarketingCampaign, updateMarketingCampaign } from "@/actions/marketing";

interface CampaignModalProps {
  campaign?: {
    id: string;
    name: string;
    description?: string;
    status: string;
    templateId?: string;
  };
  onSuccess?: () => void;
}

export function CampaignModal({ campaign, onSuccess }: CampaignModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: campaign?.name || "",
    description: campaign?.description || "",
    status: campaign?.status || "draft",
    templateId: campaign?.templateId || "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (campaign) {
        await updateMarketingCampaign(campaign.id, formData);
        toast.success("Campaign updated successfully");
      } else {
        await createMarketingCampaign({
          ...formData,
          ownerId: "", // Will be set by server action
        });
        toast.success("Campaign created successfully");
      }
      setOpen(false);
      setFormData({ name: "", description: "", status: "draft", templateId: "" });
      onSuccess?.();
    } catch (error) {
      toast.error("Failed to save campaign");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => setOpen(true)}
        variant={campaign ? "ghost" : "default"}
        size={campaign ? "icon" : "default"}
        className={campaign ? "h-8 w-8" : "gap-2"}
      >
        {campaign ? (
          <>✏️</>
        ) : (
          <>
            <span>➕</span> New Campaign
          </>
        )}
      </Button>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{campaign ? "Edit Campaign" : "Create New Campaign"}</DialogTitle>
          <DialogDescription>
            Set up a new marketing campaign to reach your leads and contacts.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Campaign Name</Label>
            <Input
              id="name"
              placeholder="e.g., Q2 Product Launch, Summer Promotion"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe the goal and target audience for this campaign..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="min-h-[120px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template">Email Template (Optional)</Label>
              <Input
                id="template"
                placeholder="Template ID"
                value={formData.templateId}
                onChange={(e) => setFormData({ ...formData, templateId: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : campaign ? "Update Campaign" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

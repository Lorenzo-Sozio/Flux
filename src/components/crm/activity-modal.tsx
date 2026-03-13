"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { PencilIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateActivity } from "@/actions/activities";

const activitySchema = z.object({
  type: z.string().min(1, "Type is required"),
  content: z.string().min(1, "Content is required"),
  date: z.string().optional(),
});

type ActivityFormValues = z.infer<typeof activitySchema>;

export function ActivityModal({ activity, revalidatePathStr }: { activity: any; revalidatePathStr: string }) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Format date for datetime-local input (YYYY-MM-DDThh:mm)
  const formatDateTime = (date: Date | null) => {
    if (!date) return "";
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      type: activity.type,
      content: activity.content || "",
      date: formatDateTime(activity.date || activity.createdAt),
    },
  });

  const onSubmit = async (data: ActivityFormValues) => {
    try {
      setIsSubmitting(true);
      const payload = {
        ...data,
        date: data.date ? new Date(data.date) : null,
      };
      await updateActivity(activity.id, payload as any, revalidatePathStr);
      toast.success("Activity updated successfully!");
      setOpen(false);
    } catch (error) {
      toast.error("Failed to update activity.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="capitalize">Edit {activity.type}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Activity Type</label>
              <Select 
                onValueChange={(val) => form.setValue("type", val)} 
                defaultValue={form.getValues("type")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Date & Time</label>
              <Input {...form.register("date")} type="datetime-local" className="h-9" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Content</label>
            <Textarea 
              {...form.register("content")} 
              placeholder="What happened?" 
              className="min-h-[120px]"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

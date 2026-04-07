"use client";

import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTask } from "@/actions/tasks";

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  dueDate: z.string().optional(),
  assigneeId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  users: { id: string; name: string | null }[];
  currentUserId: string;
  onCreated: () => void;
}

export function NewTaskDialog({ users, currentUserId, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", priority: "normal", dueDate: "", assigneeId: "" },
  });

  const onSubmit = (data: FormValues) => {
    startTransition(async () => {
      try {
        await createTask({
          title: data.title,
          description: data.description || undefined,
          priority: data.priority,
          dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
          ownerId: currentUserId,
          assigneeId: data.assigneeId || undefined,
        });
        toast.success("Task created.");
        setOpen(false);
        form.reset();
        onCreated();
      } catch {
        toast.error("Failed to create task.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-lg">New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input {...form.register("title")} placeholder="Task title…" autoFocus />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea {...form.register("description")} placeholder="Details…" className="resize-none min-h-[80px]" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Assign to</Label>
                <Controller
                  control={form.control}
                  name="assigneeId"
                  render={({ field }) => (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Unassigned</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Due date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <input
                type="datetime-local"
                {...form.register("dueDate")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/10">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
              {form.formState.isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

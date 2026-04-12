"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2Icon, Users } from "lucide-react";
import { getAllUsers } from "@/actions/crm";
import {
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
  type UserGroupFormData,
} from "@/actions/user-groups";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#0ea5e9", "#64748b", "#1e293b",
];

const groupSchema = z.object({
  name:        z.string().min(1, "Group name is required").max(100),
  description: z.string().max(255).optional(),
  color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
  memberIds:   z.array(z.string()).default([]),
});

type GroupFormValues = z.infer<typeof groupSchema>;

type UserOption = { id: string; name: string | null; email: string | null };

interface Props {
  group?: {
    id: string;
    name: string;
    description?: string | null;
    color: string;
    members: { id: string; name: string | null; email: string | null }[];
  };
  children: React.ReactNode;
  onSaved?: () => void;
}

export function GroupModal({ group, children, onSaved }: Props) {
  const [open, setOpen]       = useState(false);
  const [users, setUsers]     = useState<UserOption[]>([]);
  const [search, setSearch]   = useState("");
  const isEditing = !!group;

  useEffect(() => {
    if (open) getAllUsers().then(setUsers);
  }, [open]);

  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name:        group?.name        ?? "",
      description: group?.description ?? "",
      color:       group?.color       ?? "#6366f1",
      memberIds:   group?.members.map((m) => m.id) ?? [],
    },
  });

  const { register, control, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = form;
  const watchedColor     = watch("color");
  const watchedMemberIds = watch("memberIds");

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    return (u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
  });

  const toggleMember = (userId: string) => {
    const ids = watchedMemberIds.includes(userId)
      ? watchedMemberIds.filter((id) => id !== userId)
      : [...watchedMemberIds, userId];
    setValue("memberIds", ids, { shouldDirty: true });
  };

  const onSubmit = async (data: GroupFormValues) => {
    try {
      const result = isEditing
        ? await updateUserGroup(group.id, data as UserGroupFormData)
        : await createUserGroup(data as UserGroupFormData);

      if (!result.success) {
        toast.error(result.error ?? "Failed to save group.");
        return;
      }

      toast.success(isEditing ? "Group updated." : "Group created.");
      setOpen(false);
      form.reset();
      setSearch("");
      onSaved?.();
    } catch {
      toast.error("Failed to save group.");
    }
  };

  const handleDelete = async () => {
    if (!group) return;
    if (!confirm(`Delete group "${group.name}"? Records assigned to it will become unassigned.`)) return;
    try {
      await deleteUserGroup(group.id);
      toast.success("Group deleted.");
      setOpen(false);
      onSaved?.();
    } catch {
      toast.error("Failed to delete group.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { form.reset(); setSearch(""); } }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full"
              style={{ backgroundColor: watchedColor }}
            >
              <Users className="h-3.5 w-3.5 text-white" />
            </span>
            {isEditing ? `Edit Group — ${group.name}` : "New Group"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Group Name <span className="text-destructive">*</span>
              </Label>
              <Input {...register("name")} placeholder="e.g. Sales Team" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Description
              </Label>
              <Textarea
                {...register("description")}
                placeholder="Briefly describe this group's purpose…"
                className="resize-none"
                rows={2}
              />
            </div>

            {/* Color */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Color
              </Label>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setValue("color", c, { shouldDirty: true })}
                    className={`h-6 w-6 rounded-full transition-all ${
                      watchedColor === c ? "ring-2 ring-offset-2 ring-primary scale-110" : "opacity-80 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <Input
                  {...register("color")}
                  type="color"
                  className="h-6 w-10 cursor-pointer p-0.5 rounded-full border"
                />
              </div>
            </div>

            {/* Members */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Members
                </Label>
                <Badge variant="secondary" className="text-xs">
                  {watchedMemberIds.length} selected
                </Badge>
              </div>
              <Input
                placeholder="Search users…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
              <ScrollArea className="h-48 rounded-md border">
                <div className="p-2 space-y-0.5">
                  {filteredUsers.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      {users.length === 0 ? "Loading users…" : "No users match your search."}
                    </p>
                  )}
                  {filteredUsers.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
                    >
                      <Controller
                        control={control}
                        name="memberIds"
                        render={() => (
                          <Checkbox
                            checked={watchedMemberIds.includes(u.id)}
                            onCheckedChange={() => toggleMember(u.id)}
                          />
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-none truncate">
                          {u.name || u.email || u.id}
                        </p>
                        {u.name && u.email && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{u.email}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/30 flex-row items-center">
            {isEditing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mr-auto text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                onClick={handleDelete}
              >
                Delete Group
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[100px]">
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";

import { Plus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { addTaskAssignee, getTaskAssignees, removeTaskAssignee } from "@/actions/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Assignee = {
  id: string;
  userId: string;
  role: string;
  userName: string | null;
};

const ROLE_COLORS: Record<string, string> = {
  responsible: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  accountable: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  consulted: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  informed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const ROLE_LABELS: Record<string, string> = {
  responsible: "Responsible (R)",
  accountable: "Accountable (A)",
  consulted: "Consulted (C)",
  informed: "Informed (I)",
};

const ROLE_SHORT: Record<string, string> = {
  responsible: "R",
  accountable: "A",
  consulted: "C",
  informed: "I",
};

interface Props {
  taskId: string;
  users: { id: string; name: string | null }[];
}

export function MultiAssigneeSelect({ taskId, users }: Props) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [adding, setAdding] = useState(false);
  const [selectedUser, setSelectedUser] = useState("_none");
  const [selectedRole, setSelectedRole] = useState("responsible");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getTaskAssignees(taskId)
      .then(setAssignees)
      .catch(() => {});
  }, [taskId]);

  const handleAdd = async () => {
    if (!selectedUser || selectedUser === "_none") return;
    setLoading(true);
    try {
      await addTaskAssignee(taskId, selectedUser, selectedRole);
      const updated = await getTaskAssignees(taskId);
      setAssignees(updated);
      setAdding(false);
      setSelectedUser("_none");
      setSelectedRole("responsible");
    } catch {
      toast.error("Failed to add assignee.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeTaskAssignee(taskId, userId);
      setAssignees((prev) => prev.filter((a) => a.userId !== userId));
    } catch {
      toast.error("Failed to remove assignee.");
    }
  };

  const availableUsers = users.filter((u) => !assignees.some((a) => a.userId === u.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          RACI Assignees
        </span>
        {!adding && availableUsers.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      {assignees.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground/60 pl-1">No RACI assignees yet.</p>
      )}

      <div className="space-y-1">
        {assignees.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-muted/30 group">
            <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
              {(a.userName ?? "?")[0].toUpperCase()}
            </div>
            <span className="flex-1 text-xs truncate">{a.userName ?? a.userId}</span>
            <Badge
              variant="outline"
              className={cn("text-[9px] px-1.5 py-0 h-4 font-semibold", ROLE_COLORS[a.role] ?? ROLE_COLORS.responsible)}
            >
              {ROLE_SHORT[a.role] ?? a.role}
            </Badge>
            <button
              type="button"
              onClick={() => handleRemove(a.userId)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {adding && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <SearchableSelect
                options={[
                  { value: "_none", label: "Select user…" },
                  ...availableUsers.map((u) => ({ value: u.id, label: u.name ?? u.id })),
                ]}
                value={selectedUser}
                onChange={setSelectedUser}
                placeholder="Select user…"
                searchPlaceholder="Search users…"
                emptyText="No users found."
              />
            </div>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="h-9 w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>
                    <span className={cn("text-xs px-1 rounded", ROLE_COLORS[val])}>{label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={handleAdd}
              disabled={loading || selectedUser === "_none"}
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setAdding(false);
                setSelectedUser("_none");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { createSubtask, deleteTask, updateTaskStatus } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Subtask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  depth: number;
  progressPct: number;
  dueDate: Date | null;
  assigneeName: string | null;
  ownerName: string | null;
};

interface Props {
  parentId: string;
  parentDepth: number;
  subtasks: Subtask[];
  onChanged: () => void;
}

export function SubtaskList({ parentId, parentDepth, subtasks: initial, onChanged }: Props) {
  const [subtasks, setSubtasks] = useState(initial);
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [, startTransition] = useTransition();

  const canAddMore = parentDepth < 3;

  const handleToggle = (sub: Subtask) => {
    const next = sub.status === "done" ? "todo" : "done";
    startTransition(async () => {
      await updateTaskStatus(sub.id, next, "/dashboard/tasks");
      setSubtasks((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status: next } : s)));
      onChanged();
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteTask(id, "/dashboard/tasks");
      setSubtasks((prev) => prev.filter((s) => s.id !== id));
      onChanged();
    });
  };

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    startTransition(async () => {
      try {
        await createSubtask(parentId, { title: newTitle.trim() });
        toast.success("Subtask created.");
        setNewTitle("");
        setAdding(false);
        onChanged();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Failed to create subtask.");
      }
    });
  };

  if (subtasks.length === 0 && !adding && !canAddMore) return null;

  return (
    <div className="mt-2 pl-5 border-l-2 border-muted space-y-1">
      {subtasks.length > 0 && (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""}
          <span className="ml-1 text-muted-foreground/60">
            ({subtasks.filter((s) => s.status === "done").length}/{subtasks.length} done)
          </span>
        </button>
      )}

      {!collapsed && (
        <div className="space-y-1 pt-1">
          {subtasks.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center gap-2 group rounded px-2 py-1 hover:bg-muted/40 transition-colors"
            >
              <button
                type="button"
                onClick={() => handleToggle(sub)}
                className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
              >
                {sub.status === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Circle className="h-3.5 w-3.5" />
                )}
              </button>
              <span
                className={cn(
                  "flex-1 text-xs leading-snug min-w-0 truncate",
                  sub.status === "done" && "line-through text-muted-foreground",
                )}
              >
                {sub.title}
              </span>
              {sub.dueDate && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(sub.dueDate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleDelete(sub.id)}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
        <div className="pt-1">
          {adding ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewTitle("");
                  }
                }}
                placeholder="Subtask title…"
                className="h-7 text-xs"
                autoFocus
              />
              <Button size="sm" className="h-7 px-2 text-xs" onClick={handleAdd}>
                <Loader2 className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setAdding(false);
                  setNewTitle("");
                }}
              >
                ✕
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add subtask
            </button>
          )}
        </div>
      )}
    </div>
  );
}

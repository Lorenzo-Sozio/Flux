"use client";

import { useState } from "react";

import { Trash2, UserCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StatusOption {
  value: string;
  label: string;
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
}

interface Props {
  count: number;
  statusOptions: StatusOption[];
  users: User[];
  onClear: () => void;
  onDelete: () => Promise<void>;
  onStatusChange: (status: string) => Promise<void>;
  onAssign: (userId: string) => Promise<void>;
}

export function BulkActionBar({ count, statusOptions, users, onClear, onDelete, onStatusChange, onAssign }: Props) {
  const t = useTranslations("bulkActions");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);

  async function handle(fn: () => Promise<void>) {
    setLoading(true);
    try {
      await fn();
    } finally {
      setLoading(false);
    }
  }

  return (
    // ⚠️ On a phone it floats above the bottom bar instead of sitting at the top
    // of the list: somebody selects rows while scrolling down, and a bar that
    // scrolled away with the first row is a set of actions they cannot find.
    <div
      role="toolbar"
      aria-label={t("selected", { count })}
      className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-sm max-md:fixed max-md:inset-x-3 max-md:bottom-[calc(var(--mobile-nav-height)+var(--safe-bottom)+0.75rem)] max-md:z-40 max-md:shadow-lg md:gap-3 md:bg-primary/5 md:px-4 md:py-2.5"
    >
      <span className="shrink-0 font-medium text-sm">{t("selected", { count })}</span>

      <div className="flex min-w-0 items-center gap-2 overflow-x-auto md:ml-2">
        {/* Change status */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={loading}>
              {t("setStatus")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("changeStatusTo")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {statusOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => handle(() => onStatusChange(opt.value))}
                className="capitalize"
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assign to */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={loading} aria-label={t("assign")}>
              <UserCheck className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="max-sm:sr-only">{t("assign")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-56 overflow-y-auto">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("assignTo")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {users.map((u) => (
              <DropdownMenuItem key={u.id} onSelect={() => handle(() => onAssign(u.id))}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mr-2">
                  {(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                </span>
                {u.name ?? u.email}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Delete — asked first, with the count and what goes with them. It deleted on one
            click: dozens of records and every activity, task and note under them, with no
            way back. */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-600 hover:bg-red-50"
              disabled={loading}
              aria-label={tc("delete")}
            >
              <Trash2 className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="max-sm:sr-only">{tc("delete")}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("confirmDeleteTitle", { count })}</AlertDialogTitle>
              <AlertDialogDescription>{t("confirmDeleteBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => handle(onDelete)}>
                {tc("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto size-9 shrink-0 p-0 md:h-7 md:w-auto md:px-2"
        onClick={onClear}
        disabled={loading}
        aria-label={tc("cancel")}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

"use client";

import { useState } from "react";

import { Trash2, UserCheck, X } from "lucide-react";

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
    <div className="flex items-center gap-3 rounded-lg border bg-primary/5 px-4 py-2.5 shadow-sm">
      <span className="text-sm font-medium">{count} selected</span>

      <div className="flex items-center gap-2 ml-2">
        {/* Change status */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={loading}>
              Set Status
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Change status to</DropdownMenuLabel>
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
            <Button variant="outline" size="sm" disabled={loading}>
              <UserCheck className="h-3.5 w-3.5 mr-1.5" />
              Assign
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-56 overflow-y-auto">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Assign to</DropdownMenuLabel>
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

        {/* Delete */}
        <Button
          variant="outline"
          size="sm"
          className="border-red-300 text-red-600 hover:bg-red-50"
          disabled={loading}
          onClick={() => handle(onDelete)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Delete
        </Button>
      </div>

      <Button variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={onClear} disabled={loading}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

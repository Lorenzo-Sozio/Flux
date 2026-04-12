"use client";

import { useEffect, useState } from "react";
import { Users, User } from "lucide-react";
import { getAllUsers } from "@/actions/crm";
import { getGroupsForSelect } from "@/actions/user-groups";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Encoding helpers ─────────────────────────────────────────────────────────

/** Encode ownerId / groupId pair into a single select value string. */
export function encodeAssignee(ownerId?: string | null, groupId?: string | null): string {
  if (groupId) return `g:${groupId}`;
  if (ownerId) return `u:${ownerId}`;
  return "__none__";
}

/** Decode a select value string back into ownerId / groupId. */
export function decodeAssignee(encoded: string | null | undefined): {
  ownerId: string | null;
  groupId: string | null;
} {
  if (!encoded || encoded === "__none__") return { ownerId: null, groupId: null };
  if (encoded.startsWith("g:")) return { ownerId: null, groupId: encoded.slice(2) };
  if (encoded.startsWith("u:")) return { ownerId: encoded.slice(2), groupId: null };
  // Fallback: treat bare IDs as userId (legacy ownerId values)
  return { ownerId: encoded, groupId: null };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Encoded value: "u:<userId>", "g:<groupId>", or "__none__" / null */
  value: string | null;
  onChange: (encoded: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

type UserOption  = { id: string; name: string | null; email: string | null };
type GroupOption = { id: string; name: string; color: string; memberCount: number };

export function AssigneeSelect({
  value,
  onChange,
  disabled,
  placeholder = "— Unassigned —",
}: Props) {
  const [users,  setUsers]  = useState<UserOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);

  useEffect(() => {
    Promise.all([getAllUsers(), getGroupsForSelect()]).then(([u, g]) => {
      setUsers(u);
      setGroups(g);
    });
  }, []);

  const safeValue = value ?? "__none__";

  return (
    <Select
      value={safeValue}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{placeholder}</SelectItem>

        {groups.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5 text-xs">
              <Users className="h-3 w-3" /> Groups
            </SelectLabel>
            {groups.map((g) => (
              <SelectItem key={`g:${g.id}`} value={`g:${g.id}`}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: g.color }}
                  />
                  <span>{g.name}</span>
                  <span className="text-muted-foreground text-[10px]">
                    ({g.memberCount})
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {users.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5 text-xs">
              <User className="h-3 w-3" /> Users
            </SelectLabel>
            {users.map((u) => (
              <SelectItem key={`u:${u.id}`} value={`u:${u.id}`}>
                {u.name || u.email || u.id}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

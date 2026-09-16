"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "next-intl";

import { getAllUsers } from "@/actions/crm";
import { getGroupsForSelect } from "@/actions/user-groups";
import { SearchableSelect } from "@/components/ui/searchable-select";

// ─── Encoding helpers ─────────────────────────────────────────────────────────

export function encodeAssignee(ownerId?: string | null, groupId?: string | null): string {
  if (groupId) return `g:${groupId}`;
  if (ownerId) return `u:${ownerId}`;
  return "__none__";
}

export function decodeAssignee(encoded: string | null | undefined): {
  ownerId: string | null;
  groupId: string | null;
} {
  if (!encoded || encoded === "__none__") return { ownerId: null, groupId: null };
  if (encoded.startsWith("g:")) return { ownerId: null, groupId: encoded.slice(2) };
  if (encoded.startsWith("u:")) return { ownerId: encoded.slice(2), groupId: null };
  return { ownerId: encoded, groupId: null };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  value: string | null;
  onChange: (encoded: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

type UserOption = { id: string; name: string | null; email: string | null };
type GroupOption = { id: string; name: string; color: string; memberCount: number };

export function AssigneeSelect({ value, onChange, disabled, placeholder: placeholderProp }: Props) {
  const t = useTranslations("assignees");
  const placeholder = placeholderProp ?? t("unassigned");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);

  useEffect(() => {
    Promise.all([getAllUsers(), getGroupsForSelect()]).then(([u, g]) => {
      setUsers(u);
      setGroups(g);
    });
  }, []);

  const options = [
    { value: "__none__", label: placeholder },
    ...groups.map((g) => ({
      value: `g:${g.id}`,
      label: g.name,
      sublabel: t("groupMembers", { count: g.memberCount }),
    })),
    ...users.map((u) => ({
      value: `u:${u.id}`,
      label: u.name || u.email || u.id,
      sublabel: u.email && u.name ? u.email : undefined,
    })),
  ];

  return (
    <SearchableSelect
      options={options}
      value={value ?? "__none__"}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      searchPlaceholder={t("searchUsersAndGroups")}
      emptyText={t("noResults")}
    />
  );
}

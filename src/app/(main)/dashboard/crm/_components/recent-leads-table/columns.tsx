"use client";
"use no memo";

import type { ColumnDef } from "@tanstack/react-table";
import { EllipsisVertical } from "lucide-react";
import type { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { RecentLeadRow } from "./schema";

export function getRecentLeadsColumns(t: ReturnType<typeof useTranslations>): ColumnDef<RecentLeadRow>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t("selectAll")}
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={t("selectRow")}
          />
        </div>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "id",
      header: t("columns.ref"),
      cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: t("columns.name"),
      cell: ({ row }) => row.original.name,
      enableHiding: false,
    },
    {
      accessorKey: "company",
      header: t("columns.company"),
      cell: ({ row }) => row.original.company,
    },
    {
      accessorKey: "status",
      header: t("columns.status"),
      cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
    },
    {
      accessorKey: "source",
      header: t("columns.source"),
      cell: ({ row }) => <Badge variant="outline">{row.original.source}</Badge>,
    },
    {
      accessorKey: "lastActivity",
      header: t("columns.lastActivity"),
      cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{row.original.lastActivity}</span>,
    },
    {
      id: "actions",
      cell: () => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="flex size-8 text-muted-foreground">
              <EllipsisVertical />
              <span className="sr-only">{t("openMenu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuGroup>
              <DropdownMenuItem>{t("view")}</DropdownMenuItem>
              <DropdownMenuItem>{t("assign")}</DropdownMenuItem>
              <DropdownMenuItem>{t("archive")}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive">{t("delete")}</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      enableHiding: false,
    },
  ];
}

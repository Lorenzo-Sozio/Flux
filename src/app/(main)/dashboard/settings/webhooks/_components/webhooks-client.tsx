"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Webhook, Copy, CheckCircle } from "lucide-react";
import { createWebhook, deleteWebhook, updateWebhook } from "@/actions/webhooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type WebhookEventKey =
  | "contactCreated" | "contactUpdated" | "contactDeleted"
  | "leadCreated" | "leadConverted"
  | "dealCreated" | "dealStageChanged" | "dealWon" | "dealLost"
  | "taskCompleted";

const AVAILABLE_EVENTS: { value: string; key: WebhookEventKey }[] = [
  { value: "contact.created",   key: "contactCreated" },
  { value: "contact.updated",   key: "contactUpdated" },
  { value: "contact.deleted",   key: "contactDeleted" },
  { value: "lead.created",      key: "leadCreated" },
  { value: "lead.converted",    key: "leadConverted" },
  { value: "deal.created",      key: "dealCreated" },
  { value: "deal.stage_changed",key: "dealStageChanged" },
  { value: "deal.won",          key: "dealWon" },
  { value: "deal.lost",         key: "dealLost" },
  { value: "task.completed",    key: "taskCompleted" },
];

type WebhookType = {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string | null;
  isActive: boolean;
  createdAt: Date;
};

interface Props {
  webhooks: WebhookType[];
  currentUserId: string;
}

export function WebhooksClient({ webhooks: initial, currentUserId }: Props) {
  const t = useTranslations("settings.webhooks");
  const tc = useTranslations("common");
  const [webhooks, setWebhooks] = useState(initial);
  const [addOpen, setAddOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", events: [] as string[] });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!form.name || !form.url || form.events.length === 0) {
      toast.error(t("fillAllFields"));
      return;
    }
    setIsPending(true);
    try {
      const wh = await createWebhook({ ...form, ownerId: currentUserId });
      setWebhooks((prev) => [...prev, wh as WebhookType]);
      toast.success(t("createSuccess"));
      setAddOpen(false);
      setForm({ name: "", url: "", events: [] });
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("deleteWebhook"))) return;
    try {
      await deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  const handleToggleActive = async (wh: WebhookType) => {
    try {
      await updateWebhook(wh.id, { isActive: !wh.isActive });
      setWebhooks((prev) => prev.map((w) => w.id === wh.id ? { ...w, isActive: !wh.isActive } : w));
    } catch {
      toast.error(t("updateFailed"));
    }
  };

  const copySecret = (id: string, secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(t("secretCopied"));
  };

  const toggleEvent = (ev: string) => {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("addWebhook")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            {t("activeTitle", { count: webhooks.length })}
          </CardTitle>
          <CardDescription>
            {t("activeDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">{t("noWebhooksYet")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.url")}</TableHead>
                  <TableHead>{t("columns.events")}</TableHead>
                  <TableHead>{t("columns.secret")}</TableHead>
                  <TableHead>{t("columns.active")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((wh) => (
                  <TableRow key={wh.id}>
                    <TableCell className="font-medium">{wh.name}</TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground truncate max-w-xs block">
                        {wh.url}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {wh.events.slice(0, 3).map((ev) => (
                          <Badge key={ev} variant="outline" className="text-[10px]">
                            {ev}
                          </Badge>
                        ))}
                        {wh.events.length > 3 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t("moreEvents", { count: wh.events.length - 3 })}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {wh.secret && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 text-xs"
                          onClick={() => copySecret(wh.id, wh.secret!)}
                        >
                          {copiedId === wh.id ? (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {t("copy")}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={wh.isActive}
                        onCheckedChange={() => handleToggleActive(wh)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(wh.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("dialog.nameLabel")}</Label>
              <Input
                placeholder="e.g. Slack notifications"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.endpointUrl")}</Label>
              <Input
                placeholder="https://hooks.slack.com/services/..."
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("dialog.eventsLabel")}</Label>
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                {AVAILABLE_EVENTS.map((ev) => (
                  <label key={ev.value} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={form.events.includes(ev.value)}
                      onCheckedChange={() => toggleEvent(ev.value)}
                    />
                    {t(`webhookEvents.${ev.key}`)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{tc("cancel")}</Button>
            <Button onClick={handleAdd} disabled={isPending}>
              {isPending ? t("dialog.creating") : t("dialog.createWebhook")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

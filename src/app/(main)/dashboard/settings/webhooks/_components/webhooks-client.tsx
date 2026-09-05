"use client";

import { useState } from "react";

import { CheckCircle, Copy, Plus, Trash2, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createWebhook, deleteWebhook, getWebhookSecret, updateWebhook } from "@/actions/webhooks";
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
  | "contactCreated"
  | "contactUpdated"
  | "contactDeleted"
  | "leadCreated"
  | "leadConverted"
  | "dealCreated"
  | "dealStageChanged"
  | "dealWon"
  | "dealLost"
  | "taskCompleted";

const AVAILABLE_EVENTS: { value: string; key: WebhookEventKey }[] = [
  { value: "contact.created", key: "contactCreated" },
  { value: "contact.updated", key: "contactUpdated" },
  { value: "contact.deleted", key: "contactDeleted" },
  { value: "lead.created", key: "leadCreated" },
  { value: "lead.converted", key: "leadConverted" },
  { value: "deal.created", key: "dealCreated" },
  { value: "deal.stage_changed", key: "dealStageChanged" },
  { value: "deal.won", key: "dealWon" },
  { value: "deal.lost", key: "dealLost" },
  { value: "task.completed", key: "taskCompleted" },
];

type WebhookType = {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  // secret is no longer returned by getWebhooks() — use getWebhookSecret(id) when needed
  secret?: string | null;
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
      setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? { ...w, isActive: !wh.isActive } : w)));
    } catch {
      toast.error(t("updateFailed"));
    }
  };

  /**
   * ⚠️⚠️ **The secret was generated and then unreachable.** A webhook gets a random signing
   * secret when it is created, and the receiving end needs the same string to verify what
   * arrives — but the list strips it and nothing ever asked for it back, so the copy button
   * could not render. Whoever configured an integration hit a wall with no way past it and
   * no message explaining why.
   *
   * ⚠️ It is fetched **on demand**, not carried in the listing: a secret in a bulk response
   * is a secret in every log, cache and browser history of every page that shows the table.
   */
  const copySecret = async (id: string) => {
    try {
      const secret = await getWebhookSecret(id);
      if (!secret) {
        toast.error(t("secretMissing"));
        return;
      }
      await navigator.clipboard.writeText(secret);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast.success(t("secretCopied"));
    } catch {
      toast.error(t("secretUnavailable"));
    }
  };

  const toggleEvent = (ev: string) => {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
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
          <CardDescription>{t("activeDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">{t("noWebhooksYet")}</p>
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
                      <code className="block max-w-xs truncate text-muted-foreground text-xs">{wh.url}</code>
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
                      {/* Always shown: the secret exists for every webhook — it is
                          created with it — and hiding the button behind a field the
                          listing deliberately strips meant hiding it always. */}
                      {
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 text-xs"
                          onClick={() => copySecret(wh.id)}
                        >
                          {copiedId === wh.id ? (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {t("copy")}
                        </Button>
                      }
                    </TableCell>
                    <TableCell>
                      <Switch checked={wh.isActive} onCheckedChange={() => handleToggleActive(wh)} />
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
                  // ⚠️ `htmlFor` and an id, not a nested control: `Checkbox` renders a
                  // button with a role, so a label wrapping it binds to nothing — the click
                  // works by accident and a screen reader announces an unlabelled control.
                  <label
                    key={ev.value}
                    htmlFor={`webhook-event-${ev.value}`}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`webhook-event-${ev.value}`}
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
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleAdd} disabled={isPending}>
              {isPending ? t("dialog.creating") : t("dialog.createWebhook")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Webhook, Copy, CheckCircle, XCircle } from "lucide-react";
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

const AVAILABLE_EVENTS = [
  { value: "contact.created", label: "Contact Created" },
  { value: "contact.updated", label: "Contact Updated" },
  { value: "contact.deleted", label: "Contact Deleted" },
  { value: "lead.created", label: "Lead Created" },
  { value: "lead.converted", label: "Lead Converted" },
  { value: "deal.created", label: "Deal Created" },
  { value: "deal.stage_changed", label: "Deal Stage Changed" },
  { value: "deal.won", label: "Deal Won" },
  { value: "deal.lost", label: "Deal Lost" },
  { value: "task.completed", label: "Task Completed" },
];

type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string | null;
  isActive: boolean;
  createdAt: Date;
};

interface Props {
  webhooks: Webhook[];
  currentUserId: string;
}

export function WebhooksClient({ webhooks: initial, currentUserId }: Props) {
  const [webhooks, setWebhooks] = useState(initial);
  const [addOpen, setAddOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", events: [] as string[] });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!form.name || !form.url || form.events.length === 0) {
      toast.error("Please fill all fields and select at least one event.");
      return;
    }
    setIsPending(true);
    try {
      const wh = await createWebhook({ ...form, ownerId: currentUserId });
      setWebhooks((prev) => [...prev, wh as Webhook]);
      toast.success("Webhook created.");
      setAddOpen(false);
      setForm({ name: "", url: "", events: [] });
    } catch {
      toast.error("Failed to create webhook.");
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this webhook?")) return;
    try {
      await deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      toast.success("Webhook deleted.");
    } catch {
      toast.error("Failed to delete webhook.");
    }
  };

  const handleToggleActive = async (wh: Webhook) => {
    try {
      await updateWebhook(wh.id, { isActive: !wh.isActive });
      setWebhooks((prev) => prev.map((w) => w.id === wh.id ? { ...w, isActive: !wh.isActive } : w));
    } catch {
      toast.error("Failed to update webhook.");
    }
  };

  const copySecret = (id: string, secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Secret copied to clipboard.");
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
          <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
          <p className="text-muted-foreground">
            Send automated HTTP POST requests to external services when events occur.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Webhook
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Active Webhooks ({webhooks.length})
          </CardTitle>
          <CardDescription>
            Each request includes an <code>X-Webhook-Signature</code> header (HMAC-SHA256) for verification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">No webhooks configured yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Secret</TableHead>
                  <TableHead>Active</TableHead>
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
                            +{wh.events.length - 3} more
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
                          Copy
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

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Webhook</DialogTitle>
            <DialogDescription>
              We'll POST a JSON payload to your URL whenever the selected events occur.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Slack notifications"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Endpoint URL</Label>
              <Input
                placeholder="https://hooks.slack.com/services/..."
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Events to subscribe</Label>
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                {AVAILABLE_EVENTS.map((ev) => (
                  <label key={ev.value} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={form.events.includes(ev.value)}
                      onCheckedChange={() => toggleEvent(ev.value)}
                    />
                    {ev.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={isPending}>
              {isPending ? "Creating…" : "Create Webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

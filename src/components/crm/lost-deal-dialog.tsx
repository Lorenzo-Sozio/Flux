"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface LossReason {
  id: string;
  name: string;
}

export interface LossAnswer {
  lossReasonId: string;
  lostCompetitor: string | null;
  note: string | null;
}

/**
 * Asks why, at the only moment anyone still knows.
 *
 * The product recorded how much was lost and never why: `lostReason` was a
 * column nothing wrote (audit rilievo S-09). Asked a week later at a sales
 * meeting, nobody remembers; asked as the card is dropped, it costs one click.
 *
 * The reason comes from a list rather than a box, because free text does not
 * aggregate — "price", "Price" and "too expensive" are three rows in any
 * analysis. The box is still there underneath for the detail a list cannot hold.
 */
export function LostDealDialog({
  open,
  dealName,
  reasons,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  dealName: string;
  reasons: LossReason[];
  onCancel: () => void;
  onConfirm: (answer: LossAnswer) => Promise<void> | void;
}) {
  const [reasonId, setReasonId] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Cleared on each open, or the previous deal's answer is pre-filled for the
  // next one and gets confirmed without being read.
  useEffect(() => {
    if (open) {
      setReasonId("");
      setCompetitor("");
      setNote("");
      setSaving(false);
    }
  }, [open]);

  const selected = reasons.find((r) => r.id === reasonId);
  const asksForCompetitor = /competitor/i.test(selected?.name ?? "");

  const submit = async () => {
    if (!reasonId) return;
    setSaving(true);
    try {
      await onConfirm({
        lossReasonId: reasonId,
        lostCompetitor: competitor.trim() || null,
        note: note.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Why was it lost?</DialogTitle>
          <DialogDescription>
            Closing “{dealName}”. This is the one moment the answer is still known, and it is what makes win/loss
            analysis possible later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="loss-reason">Reason</Label>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger id="loss-reason">
                <SelectValue placeholder="Pick a reason" />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {asksForCompetitor && (
            <div className="space-y-1.5">
              <Label htmlFor="loss-competitor">Who won it?</Label>
              <Input
                id="loss-competitor"
                value={competitor}
                onChange={(e) => setCompetitor(e.target.value)}
                placeholder="Competitor name"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="loss-note">Anything worth remembering?</Label>
            <Textarea
              id="loss-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!reasonId || saving}>
            {saving ? "Closing…" : "Close as lost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

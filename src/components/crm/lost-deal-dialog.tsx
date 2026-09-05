"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "next-intl";

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
  const t = useTranslations("lostDeal");

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

  // ⚠️ This used to appear only when the chosen reason's name contained the word
  // "competitor", which is the English wording of a seeded row. A workspace that
  // renames it — into Italian, or into anything of its own — lost the field, and
  // the loss was recorded without the one fact the sales meeting asks for first.
  // Behaviour must not hang off a string somebody is invited to edit, so the
  // field is simply always there and always optional.

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
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { name: dealName })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="loss-reason">{t("reason")}</Label>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger id="loss-reason">
                <SelectValue placeholder={t("reasonPlaceholder")} />
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

          <div className="space-y-1.5">
            <Label htmlFor="loss-competitor">{t("competitor")}</Label>
            <Input
              id="loss-competitor"
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              placeholder={t("competitorPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loss-note">{t("note")}</Label>
            <Textarea
              id="loss-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={!reasonId || saving}>
            {saving ? t("closing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

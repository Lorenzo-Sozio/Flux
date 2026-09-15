"use client";

import { useState } from "react";

import Link from "next/link";

import { ListOrdered } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { enrollRecord, getEnrollmentsForRecord, getSequencesForEnrolling, stopEnrollment } from "@/actions/sequences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Enrollments = Awaited<ReturnType<typeof getEnrollmentsForRecord>>;

/** The "Sequence" button on a lead or contact: what it is enrolled in, and enrolling it in another. */
export function EnrollInSequence({ entity, recordId }: { entity: "lead" | "contact"; recordId: string }) {
  const t = useTranslations("sequences");
  const [open, setOpen] = useState(false);
  const [sequences, setSequences] = useState<{ id: string; name: string }[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollments>([]);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [s, e] = await Promise.all([getSequencesForEnrolling(entity), getEnrollmentsForRecord(entity, recordId)]);
    setSequences(s);
    setEnrollments(e);
  };

  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const result = await enrollRecord(chosen, entity, recordId);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(t("enrolledToast"));
        setChosen("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          load().catch(() => toast.error(t("failed")));
        }}
      >
        <ListOrdered className="mr-1.5 h-4 w-4" />
        {t("sequenceButton")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("sequenceButton")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {enrollments.length > 0 && (
              <ul className="space-y-2">
                {enrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/marketing/sequences/${e.sequenceId}`}
                        className="font-medium hover:underline"
                      >
                        {e.name}
                      </Link>
                      <div>
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          {e.status === "stopped" && e.stopReason
                            ? t(`reasons.${e.stopReason}` as "reasons.manual")
                            : t(`statuses.${e.status}` as "statuses.active")}
                        </Badge>
                      </div>
                    </div>
                    {e.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await stopEnrollment(e.id);
                          await load();
                        }}
                      >
                        {t("stop")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sequences.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noSequencesFor")}</p>
            ) : (
              <Select value={chosen} onValueChange={setChosen}>
                <SelectTrigger>
                  <SelectValue placeholder={t("chooseSequence")} />
                </SelectTrigger>
                <SelectContent>
                  {sequences.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("close")}
            </Button>
            <Button onClick={submit} disabled={!chosen || busy}>
              {t("enroll")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

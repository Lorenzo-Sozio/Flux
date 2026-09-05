"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { GitMerge, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Source = "keep" | "merge";

export interface MergeField<T> {
  key: keyof T & string;
  label: string;
  display?: (entity: T) => string;
  hasValue?: (entity: T) => boolean;
  mergeValue?: (entity: T) => unknown;
}

interface Props<T extends object> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  keepId: string;
  mergeId: string;
  fields: MergeField<T>[];
  fetchEntity: (id: string) => Promise<T | null | undefined>;
  onMerge: (keepId: string, mergeId: string, fields: Record<string, unknown>) => Promise<void>;
  getDisplayName: (entity: T) => string;
  reassignedDescription: (keep: T, merge: T) => React.ReactNode;
}

function getDisplayValue<T>(entity: T, field: MergeField<T>): string {
  if (field.display) return field.display(entity) || "—";
  const v = entity[field.key];
  return v ? String(v) : "—";
}

function getHasValue<T>(entity: T, field: MergeField<T>): boolean {
  if (field.hasValue) return field.hasValue(entity);
  return !!entity[field.key];
}

export function MergeEntityModal<T extends object>({
  open,
  onOpenChange,
  title,
  keepId,
  mergeId,
  fields,
  fetchEntity,
  onMerge,
  getDisplayName,
  reassignedDescription,
}: Props<T>) {
  const router = useRouter();
  const t = useTranslations("merge.modal");
  const [keepEntity, setKeepEntity] = useState<T | null>(null);
  const [mergeEntity, setMergeEntity] = useState<T | null>(null);
  const [choices, setChoices] = useState<Record<string, Source>>({});
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    Promise.all([fetchEntity(keepId), fetchEntity(mergeId)])
      .then(([k, m]) => {
        setKeepEntity(k ?? null);
        setMergeEntity(m ?? null);
        const defaults: Record<string, Source> = {};
        for (const { key } of fields) defaults[key] = "keep";
        setChoices(defaults);
      })
      .catch(() => toast.error(t("failedToLoad")))
      .finally(() => setFetching(false));
  }, [open, keepId, mergeId, fetchEntity, fields, t]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMerge() {
    if (!keepEntity || !mergeEntity) return;
    setLoading(true);
    try {
      const merged: Record<string, unknown> = {};
      for (const field of fields) {
        if ((choices[field.key] ?? "keep") === "merge") {
          merged[field.key] = field.mergeValue ? field.mergeValue(mergeEntity) : mergeEntity[field.key as keyof T];
        }
      }
      await onMerge(keepId, mergeId, merged);
      toast.success(t("mergedSuccess"));
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("mergeFailed"));
    } finally {
      setLoading(false);
    }
  }

  const diffFields =
    keepEntity && mergeEntity
      ? fields.filter((f) => getDisplayValue(keepEntity, f) !== getDisplayValue(mergeEntity, f))
      : [];
  const sameFields =
    keepEntity && mergeEntity
      ? fields.filter((f) => getDisplayValue(keepEntity, f) === getDisplayValue(mergeEntity, f))
      : [];
  const identicalWithValue = keepEntity ? sameFields.filter((f) => getHasValue(keepEntity, f)) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {fetching ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : keepEntity && mergeEntity ? (
          <div className="space-y-4">
            <div className="grid grid-cols-[140px_1fr_1fr] gap-3 border-b pb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              <div />
              <div className="text-center">
                {t("keep")}
                <div className="mt-0.5 font-normal text-foreground normal-case">{getDisplayName(keepEntity)}</div>
              </div>
              <div className="text-center">
                {t("mergeWillBeDeleted")}
                <div className="mt-0.5 font-normal text-foreground normal-case">{getDisplayName(mergeEntity)}</div>
              </div>
            </div>

            {diffFields.length > 0 && (
              <div className="space-y-1">
                <p className="mb-2 font-medium text-muted-foreground text-xs">{t("clickToSelect")}</p>
                {diffFields.map((field) => (
                  <div key={field.key} className="grid grid-cols-[140px_1fr_1fr] items-start gap-3 py-1.5">
                    <span className="pt-1 text-muted-foreground text-xs">{field.label}</span>
                    {(["keep", "merge"] as const).map((side) => {
                      const entity = side === "keep" ? keepEntity : mergeEntity;
                      const selected = (choices[field.key] ?? "keep") === side;
                      return (
                        <button
                          key={side}
                          type="button"
                          onClick={() => setChoices((c) => ({ ...c, [field.key]: side }))}
                          className={`rounded border px-2 py-1.5 text-left text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary/5 font-medium"
                              : "border-transparent text-muted-foreground hover:border-muted-foreground/30"
                          }`}
                        >
                          {getHasValue(entity, field) ? (
                            getDisplayValue(entity, field)
                          ) : (
                            <span className="text-muted-foreground/50 text-xs italic">{t("empty")}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {identicalWithValue.length > 0 && (
              <details className="text-muted-foreground text-xs">
                <summary className="cursor-pointer hover:text-foreground">
                  {t("identicalFields", { count: identicalWithValue.length })}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-2">
                  {identicalWithValue.map((field) => (
                    <li key={field.key}>
                      {field.label}: {getDisplayValue(keepEntity, field)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="border-t pt-3 text-muted-foreground text-xs">
              {reassignedDescription(keepEntity, mergeEntity)}
            </p>
          </div>
        ) : (
          <p className="py-4 text-muted-foreground text-sm">{t("couldNotLoad")}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleMerge}
            disabled={loading || fetching || !keepEntity || !mergeEntity}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("mergeAndDelete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRef, useState } from "react";

import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

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

const IMPORT_HINTS: Record<string, { required: string; optional: string; dedup: string }> = {
  contacts: {
    required: "firstName, lastName",
    optional:
      "email, phone, company, jobTitle, city, country, source, tags (;-separated), notes, marketingConsent (yes/no)",
    dedup: "email",
  },
  leads: {
    required: "firstName, lastName",
    optional:
      "email, phone, companyName, jobTitle, city, country, source, rating (hot/warm/cold), tags (;-separated), notes",
    dedup: "email",
  },
  companies: {
    required: "name",
    optional:
      "industry, website, type, city, country, mainEmail, mainPhone, vatNumber, sdiCode, source, tags (;-separated)",
    dedup: "name",
  },
};

interface Props {
  entityType: "contacts" | "leads" | "companies";
  onImportSuccess?: (result: { created: number; skipped: number; duplicates: string[] }) => void;
}

export function ImportExportButtons({ entityType, onImportSuccess }: Props) {
  const t = useTranslations("importExport");
  const tc = useTranslations("common");
  const [importOpen, setImportOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    window.open(`/api/${entityType}/export`, "_blank");
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error(t("selectFile"));
      return;
    }
    if (!file.name.endsWith(".csv")) {
      toast.error(t("csvOnly"));
      return;
    }

    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/${entityType}/import`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? t("importFailed"));
        return;
      }

      toast.success(
        data.duplicates?.length > 0
          ? t("completeWithDuplicates", {
              created: data.created,
              skipped: data.skipped,
              duplicates: data.duplicates.length,
            })
          : t("complete", { created: data.created, skipped: data.skipped }),
      );
      setImportOpen(false);
      onImportSuccess?.(data);
    } catch {
      toast.error(t("importFailedRetry"));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      {/* Icon-only on a phone. Two labelled buttons are 200px of a 343px header
          row spent on the two things nobody does from a phone — but hiding them
          outright would remove the capability, and the icons are unambiguous. */}
      <Button variant="outline" size="sm" onClick={handleExport} aria-label={t("exportCsv")}>
        <Download className="h-4 w-4 sm:mr-2" />
        <span className="max-sm:sr-only">{t("exportCsv")}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} aria-label={t("importCsv")}>
        <Upload className="h-4 w-4 sm:mr-2" />
        <span className="max-sm:sr-only">{t("importCsv")}</span>
      </Button>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t(
                ["contacts", "leads", "companies"].includes(entityType)
                  ? (`titles.${entityType}` as "titles.contacts")
                  : "titles.other",
              )}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-1.5">
                <p>
                  <strong>{t("required")}</strong>{" "}
                  {IMPORT_HINTS[entityType]?.required.split(", ").map((c) => (
                    <code key={c} className="mx-0.5 bg-muted px-1 rounded text-xs">
                      {c}
                    </code>
                  ))}
                </p>
                <p>
                  <strong>{t("optional")}</strong>{" "}
                  {IMPORT_HINTS[entityType]?.optional.replaceAll("(;-separated)", `(${t("semicolonSeparated")})`)}
                </p>
                <p>
                  {t.rich("dedup", {
                    field: IMPORT_HINTS[entityType]?.dedup ?? "",
                    b: (chunks) => <strong>{chunks}</strong>,
                  })}
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="csv-file">{t("csvFile")}</Label>
              <Input id="csv-file" type="file" accept=".csv" ref={fileRef} className="mt-1.5 cursor-pointer" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleImport} disabled={isImporting}>
              {isImporting ? t("importing") : t("import")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

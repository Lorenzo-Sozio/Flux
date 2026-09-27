"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";

import { ImportWizard } from "@/components/crm/import-wizard";
import { Button } from "@/components/ui/button";

interface Props {
  entityType: "contacts" | "leads" | "companies";
  /**
   * Whether this person may import (`record:import`). The route refuses anyway; hiding the
   * button is so a viewer is not offered a dialog that can only end in "not allowed".
   */
  canImport: boolean;
  onImportSuccess?: (result: { created: number; updated: number; skipped: number; duplicates: string[] }) => void;
}

export function ImportExportButtons({ entityType, canImport, onImportSuccess }: Props) {
  const t = useTranslations("importExport");
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);

  const handleExport = () => {
    window.open(`/api/${entityType}/export`, "_blank");
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
      {canImport && (
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} aria-label={t("importCsv")}>
          <Upload className="h-4 w-4 sm:mr-2" />
          <span className="max-sm:sr-only">{t("importCsv")}</span>
        </Button>
      )}

      {/* Choose the file, say which column is which, see what would happen, import. */}
      {canImport && (
        <ImportWizard
          entity={entityType}
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={(result) => {
            // The list behind the dialog is a server page: without this it kept showing the
            // records from before the import until somebody reloaded.
            router.refresh();
            onImportSuccess?.(result);
          }}
        />
      )}
    </>
  );
}

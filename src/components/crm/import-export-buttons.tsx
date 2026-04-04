"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
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

interface Props {
  entityType: "contacts" | "leads";
  onImportSuccess?: (result: { created: number; skipped: number; duplicates: string[] }) => void;
}

export function ImportExportButtons({ entityType, onImportSuccess }: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    window.open(`/api/${entityType}/export`, "_blank");
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Please select a CSV file.");
      return;
    }
    if (!file.name.endsWith(".csv")) {
      toast.error("Only CSV files are supported.");
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
        toast.error(data.error ?? "Import failed.");
        return;
      }

      toast.success(
        `Import complete: ${data.created} created, ${data.skipped} skipped${
          data.duplicates?.length > 0 ? ` (${data.duplicates.length} duplicates)` : ""
        }.`
      );
      setImportOpen(false);
      onImportSuccess?.(data);
    } catch {
      toast.error("Import failed. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download className="mr-2 h-4 w-4" />
        Export CSV
      </Button>
      <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import CSV
      </Button>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import {entityType}</DialogTitle>
            <DialogDescription>
              Upload a CSV file. Required columns: <code>firstName</code>, <code>lastName</code>.
              Optional: <code>email</code>, <code>phone</code>, <code>company</code>, <code>jobTitle</code>,
              <code>city</code>, <code>country</code>, <code>source</code>, <code>tags</code> (semicolon-separated),
              <code>notes</code>, <code>marketingConsent</code> (yes/no).
              <br />
              <br />
              Duplicates are detected by <strong>email</strong> and skipped automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="csv-file">CSV File</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv"
                ref={fileRef}
                className="mt-1.5 cursor-pointer"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={isImporting}>
              {isImporting ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

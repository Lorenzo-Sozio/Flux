"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Download,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Image,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DocumentRecord {
  id: string;
  name: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}

interface Props {
  entityType: "contact" | "lead" | "company" | "deal";
  entityId: string;
}

/** Human-readable file size */
function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Icon based on MIME type */
function FileIcon({ mime }: { mime: string | null }) {
  if (!mime) return <File className="h-4 w-4 shrink-0" />;
  if (mime.startsWith("image/")) return <Image className="h-4 w-4 shrink-0 text-sky-500" />;
  if (mime === "application/pdf") return <FileText className="h-4 w-4 shrink-0 text-red-500" />;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv")
    return <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (mime.includes("word") || mime === "application/msword")
    return <FileText className="h-4 w-4 shrink-0 text-blue-500" />;
  return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

/** Accepted MIME types (must match server whitelist) */
const ACCEPT = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
].join(",");

const MAX_SIZE_MB = 10;

export function DocumentPanel({ entityType, entityId }: Props) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // ── Fetch docs ──────────────────────────────────────────────────────────────
  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDocs(data.documents ?? []);
    } catch {
      toast.error("Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // ── Upload ──────────────────────────────────────────────────────────────────
  const uploadFile = useCallback(
    (file: File) => {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        toast.error(`File exceeds ${MAX_SIZE_MB} MB limit.`);
        return;
      }

      setUploading(true);
      setProgress(0);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      formData.append("entityId", entityId);

      // Use XHR for upload progress events
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/documents/upload");

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener("load", () => {
        setUploading(false);
        setProgress(0);
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success) {
              toast.success(`"${file.name}" uploaded successfully.`);
              fetchDocs();
              return;
            }
            toast.error(data.error ?? "Upload failed.");
          } catch {
            toast.error("Upload failed.");
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            toast.error(data.error ?? `Upload failed (${xhr.status}).`);
          } catch {
            toast.error(`Upload failed (${xhr.status}).`);
          }
        }
      });

      xhr.addEventListener("error", () => {
        setUploading(false);
        setProgress(0);
        toast.error("Network error during upload.");
      });

      xhr.send(formData);
    },
    [entityType, entityId, fetchDocs],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (doc: DocumentRecord) => {
    if (!confirm(`Delete "${doc.name}"?`)) return;
    setDeletingId(doc.id);
    try {
      const res = await fetch(`/api/documents?id=${doc.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Delete failed.");
      toast.success(`"${doc.name}" deleted.`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err: any) {
      toast.error(err.message ?? "Failed to delete document.");
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" />
          Documents
          {docs.length > 0 && (
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
              {docs.length}
            </span>
          )}
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload
        </Button>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={handleFileChange} />
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Upload progress bar */}
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all duration-100" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => !uploading && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
            dragging
              ? "border-primary bg-primary/5 text-primary"
              : "border-border/60 text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30"
          }`}
        >
          <Upload className={`h-5 w-5 ${dragging ? "text-primary" : "text-muted-foreground/60"}`} />
          <p className="text-xs font-medium">{dragging ? "Drop to upload" : "Drag & drop or click to browse"}</p>
          <p className="text-[11px] text-muted-foreground/60">PDF, Word, Excel, images — max {MAX_SIZE_MB} MB</p>
        </div>

        {/* Document list */}
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : docs.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-2">No documents attached yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/30"
              >
                <FileIcon mime={doc.mimeType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight" title={doc.name}>
                    {doc.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtSize(doc.size)}
                    {doc.size ? " · " : ""}
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {/* View in new tab — PDFs only */}
                {doc.mimeType === "application/pdf" && (
                  <a
                    href={`/api/documents/${doc.id}?view=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open PDF"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </a>
                )}
                {/* Download — served via authenticated API route */}
                <a
                  href={`/api/documents/${doc.id}`}
                  download={doc.name}
                  title="Download"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  title="Delete"
                  disabled={deletingId === doc.id}
                  onClick={() => handleDelete(doc)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

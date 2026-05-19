"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ExternalLink, File, FileImage, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Document = {
  id: string;
  name: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
};

interface Props {
  entityType: "contact" | "lead" | "company" | "deal";
  entityId: string;
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  if (mimeType?.startsWith("image/")) return <FileImage className="h-4 w-4 text-blue-500" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4 text-red-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function fmtSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentManager({ entityType, entityId }: Props) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?entityType=${entityType}&entityId=${entityId}`);
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

  const uploadFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10 MB).");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", entityType);
      form.append("entityId", entityId);

      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Upload failed.");
        return;
      }

      setDocs((prev) => [...prev, data.document]);
      toast.success(`"${file.name}" uploaded.`);
    } catch {
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      setDocs((prev) => prev.filter((d) => d.id !== id));
      toast.success("Document deleted.");
    } catch {
      toast.error("Failed to delete document.");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Attachments
            {docs.length > 0 && <Badge variant="secondary">{docs.length}</Badge>}
          </span>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-2 h-3.5 w-3.5" />
            )}
            Upload
          </Button>
          <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-5 text-sm text-muted-foreground transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40 hover:bg-muted/30"
          }`}
        >
          <Upload className="mb-1 h-5 w-5" />
          <span>Drop files here or click to upload</span>
          <span className="text-xs">Max 10 MB · PDF, images, documents</span>
        </div>

        {/* Document List */}
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : docs.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">No attachments yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {docs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
                <FileIcon mimeType={doc.mimeType} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtSize(doc.size)} · {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={() => handleDelete(doc.id, doc.name)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What an uploaded file may be, checked three ways: the declared type against a
 * whitelist, the extension against that type, and the first bytes against both.
 *
 * Shared by every upload in the product — documents on a record, attachments in
 * the chat — so one of them cannot quietly accept what the other refuses. Moved
 * here from the document upload route when the chat started taking files.
 */

/**
 * The extension, lower-cased by the caller: `path.extname` without `node:path`, so
 * the composer in the browser can read the same whitelist the server enforces.
 */
function extname(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** 10 MB, the limit every upload has always had. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Strict whitelist: declared MIME → allowed file extensions. No SVG, HTML or scripts. */
export const ALLOWED_UPLOADS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
};

/** The types a browser may be shown inline: images, never anything that runs. */
export const INLINE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Verify file magic bytes against the declared MIME type.
 * Returns false if the content does not match the claimed type.
 */
export function verifyMagicBytes(buf: Uint8Array, mimeType: string): boolean {
  if (buf.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));

  switch (mimeType) {
    case "application/pdf":
      // %PDF
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;

    case "image/jpeg":
      // FF D8 FF
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

    case "image/png":
      // 89 50 4E 47 0D 0A 1A 0A
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

    case "image/gif":
      // GIF87a or GIF89a
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;

    case "image/webp":
      // RIFF....WEBP
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";

    // OOXML formats (docx / xlsx / pptx) are ZIP archives
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      // PK\x03\x04
      return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

    // Legacy Office formats (OLE Compound Document)
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      // D0 CF 11 E0
      return buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;

    // Text formats — no reliable magic bytes; rely on extension + MIME whitelist
    case "text/plain":
    case "text/csv":
      return true;

    default:
      return false;
  }
}

export type UploadCheck =
  | { ok: true; mime: string; bytes: Uint8Array }
  | {
      ok: false;
      /** A key under `serverErrors.documents`. */
      error: "noFile" | "emptyFile" | "tooLarge" | "typeNotAllowed" | "extensionMismatch" | "contentMismatch";
      status: number;
      values?: Record<string, string>;
    };

/** Every check a file has to pass before it is stored, in the order a person can fix them. */
export async function checkUpload(file: File | null): Promise<UploadCheck> {
  if (!file) return { ok: false, error: "noFile", status: 400 };
  if (file.size === 0) return { ok: false, error: "emptyFile", status: 400 };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "tooLarge", status: 413 };

  const mime = file.type.toLowerCase().split(";")[0].trim();
  const allowedExts = ALLOWED_UPLOADS[mime];
  if (!allowedExts) return { ok: false, error: "typeNotAllowed", status: 415, values: { type: mime } };

  const ext = extname(file.name).toLowerCase();
  if (!allowedExts.includes(ext))
    return { ok: false, error: "extensionMismatch", status: 415, values: { extension: ext } };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!verifyMagicBytes(bytes, mime)) return { ok: false, error: "contentMismatch", status: 415 };

  return { ok: true, mime, bytes };
}

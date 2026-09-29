import { unzipSync } from "fflate";

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const SOURCE_ACCEPT = ".pdf,.pptx,.docx,.png,.jpg,.jpeg,.webp,.txt,.md";

const formats = {
  pdf: { extension: "pdf", mimeType: "application/pdf", kind: "document" },
  pptx: { extension: "pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "office" },
  docx: { extension: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "office" },
  png: { extension: "png", mimeType: "image/png", kind: "image" },
  jpg: { extension: "jpg", mimeType: "image/jpeg", kind: "image" },
  jpeg: { extension: "jpeg", mimeType: "image/jpeg", kind: "image" },
  webp: { extension: "webp", mimeType: "image/webp", kind: "image" },
  txt: { extension: "txt", mimeType: "text/plain", kind: "text" },
  md: { extension: "md", mimeType: "text/markdown", kind: "text" },
} as const;
export type SourceFormat = (typeof formats)[keyof typeof formats];

// Extension is mandatory; a claimed MIME type never admits an arbitrary filename.
export function getSourceFormat(fileName: string, reportedMimeType: string): SourceFormat {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (!fileName.includes(".") || !extension || !Object.hasOwn(formats, extension)) {
    throw new SourcePreparationError("Supported sources: PDF, PPTX, DOCX, PNG, JPEG, WebP, TXT and Markdown.");
  }
  const format = formats[extension as keyof typeof formats];
  const mimeType = reportedMimeType.toLowerCase().split(";")[0].trim();
  const aliases = format.extension === "md" ? ["text/plain", "text/x-markdown"]
    : format.kind === "office" ? ["application/zip", "application/x-zip-compressed"] : [];
  if (mimeType && mimeType !== "application/octet-stream" && mimeType !== format.mimeType && !aliases.includes(mimeType)) {
    throw new SourcePreparationError("Source extension and MIME type do not match.");
  }
  return format;
}

// Only these fixed, application-owned messages may cross the worker error boundary.
export class SourcePreparationError extends Error {}

export function decodeSourceText(sourceBuffer: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sourceBuffer);
    if (!text.trim()) throw new Error("Empty text");
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code < 32 && ![9, 10, 12, 13].includes(code)) throw new Error("Not readable text");
    }
    return text;
  } catch {
    throw new SourcePreparationError("Text and Markdown sources must contain non-empty UTF-8 text, not binary data.");
  }
}

export function validateSourceBytes(sourceBuffer: Buffer, format: SourceFormat): void {
  if (!sourceBuffer.length || sourceBuffer.length > MAX_SOURCE_BYTES) {
    throw new SourcePreparationError("Source must be non-empty and 10 MB or smaller.");
  }
  let valid = false;
  switch (format.extension) {
    case "pdf": valid = sourceBuffer.subarray(0, 5).toString("ascii") === "%PDF-"; break;
    case "png": valid = sourceBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); break;
    case "jpg":
    case "jpeg": valid = sourceBuffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])); break;
    case "webp": valid = sourceBuffer.subarray(0, 4).toString("ascii") === "RIFF" && sourceBuffer.subarray(8, 12).toString("ascii") === "WEBP"; break;
    case "txt":
    case "md": decodeSourceText(sourceBuffer); return;
    case "pptx":
    case "docx": {
      // Inspect ZIP entry names only; never expand an untrusted archive onto disk.
      const names = new Set<string>();
      try {
        unzipSync(sourceBuffer, { filter: (entry) => { names.add(entry.name); return false; } });
        valid = names.has("[Content_Types].xml") && names.has(
          format.extension === "pptx" ? "ppt/presentation.xml" : "word/document.xml",
        );
      } catch { valid = false; }
      break;
    }
  }
  if (!valid) throw new SourcePreparationError("Source bytes do not match the supported file format, or the file is corrupt.");
}

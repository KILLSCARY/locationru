export interface PdfProcessingResult {
  /** False if the buffer doesn't actually parse as a structurally valid PDF. */
  valid: boolean;
  pageCount: number;
}

export interface PdfPreviewResult {
  /** A new single-page PDF containing only the first page — never the full original document, see docs/security/document-storage.md. */
  previewBuffer: Buffer;
}

export interface PdfProcessor {
  process(buffer: Buffer): Promise<PdfProcessingResult>;
  createPreview(buffer: Buffer): Promise<PdfPreviewResult>;
}

export const PDF_PROCESSOR = Symbol('PDF_PROCESSOR');

export interface GeneratedPreview {
  previewBuffer: Buffer;
  previewMimeType: string;
}

/** Dispatches to ImageProcessor or PdfProcessor based on MIME type — the only place that decision is made. */
export interface DocumentPreviewGenerator {
  generatePreview(
    sanitizedBuffer: Buffer,
    mimeType: string,
  ): Promise<GeneratedPreview>;
}

export const DOCUMENT_PREVIEW_GENERATOR = Symbol('DOCUMENT_PREVIEW_GENERATOR');

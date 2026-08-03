export interface FileTypeDetectionResult {
  /** The MIME type actually detected from the file's own bytes — never trusted from the client's declared Content-Type. */
  detectedMimeType: string | null;
  /** False when the detected type doesn't match one of the three allowed types, or doesn't match the client-declared type. */
  matchesDeclaredType: boolean;
}

/**
 * Never trust a client-supplied MIME type or file extension — this is the
 * only source of truth for "what kind of file is this, really", inspecting
 * the file's own magic bytes. See docs/security/document-processing.md.
 */
export interface FileTypeDetector {
  detect(
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<FileTypeDetectionResult>;
}

export const FILE_TYPE_DETECTOR = Symbol('FILE_TYPE_DETECTOR');

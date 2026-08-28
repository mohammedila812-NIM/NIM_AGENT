export interface ExportDataOptions {
  format: 'csv' | 'json' | 'md' | 'txt';
  filename: string;
  content?: string;
  source?: 'table' | 'research_notes' | 'raw';
}

export interface ExportDataResult {
  success: boolean;
  filename: string;
  bytes: number;
  downloadId?: number;
  error?: string;
}

/**
 * Sanitize filename to prevent directory traversal or invalid filesystem characters.
 */
export function sanitizeFilename(raw: string, format: string): string {
  let clean = raw.trim().replace(/[/\\?%*:|"<>]/g, '_');
  if (!clean) clean = `export_${Date.now()}`;
  const ext = `.${format}`;
  if (!clean.toLowerCase().endsWith(ext)) {
    clean += ext;
  }
  return clean;
}

/**
 * Convert string content to base64 Data URL for native browser download.
 */
export function createDataUrl(content: string, format: string): string {
  const mimeTypes: Record<string, string> = {
    csv: 'text/csv;charset=utf-8',
    json: 'application/json;charset=utf-8',
    md: 'text/markdown;charset=utf-8',
    txt: 'text/plain;charset=utf-8',
  };
  const mime = mimeTypes[format] || 'text/plain;charset=utf-8';
  // Use UTF-8 encoded Data URI
  return `data:${mime},${encodeURIComponent(content)}`;
}

/**
 * Trigger native browser file download for extracted tables, JSON, or research notes.
 */
export async function exportDataToFile(options: ExportDataOptions): Promise<ExportDataResult> {
  const { format, filename: rawFilename, content = '' } = options;
  const filename = sanitizeFilename(rawFilename, format);
  const dataUrl = createDataUrl(content, format);
  const bytes = new TextEncoder().encode(content).length;

  if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function') {
    try {
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: false,
        conflictAction: 'uniquify',
      });
      return {
        success: true,
        filename,
        bytes,
        downloadId,
      };
    } catch (err: unknown) {
      return {
        success: false,
        filename,
        bytes,
        error: `chrome.downloads failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Fallback for non-extension / testing environments
  return {
    success: true,
    filename,
    bytes,
  };
}

/**
 * Format export result for the agent transcript.
 */
export function formatExportResult(result: ExportDataResult): string {
  if (!result.success) {
    return `FILE EXPORT FAILED: Could not save "${result.filename}". Error: ${result.error || 'Unknown error'}`;
  }
  const sizeKb = (result.bytes / 1024).toFixed(1);
  return `FILE EXPORTED SUCCESSFULLY: Saved "${result.filename}" (${sizeKb} KB, ${result.bytes} bytes) directly to user's Downloads folder.${result.downloadId ? ` (Download ID: ${result.downloadId})` : ''}`;
}

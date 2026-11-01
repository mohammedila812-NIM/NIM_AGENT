/**
 * Virtual Workspace Exporter (Phase 4 Developer Superpower)
 *
 * Provides native client-side packaging of VFS folders and files:
 * 1. Pure-TypeScript in-memory ZIP bundle generator (zero external dependencies).
 * 2. Multi-file markdown dossier compiler.
 * 3. GitHub Gist payload builder for instant 1-click cloud synchronization.
 */

import { vfs, type VFSFile } from './vfs';

// CRC-32 lookup table for standard ZIP checksums
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

export function calculateCRC32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFileInput {
  path: string;
  content: string | Uint8Array;
}

/**
 * Creates a standard PKZIP archive (Store mode, uncompressed) in pure TypeScript.
 * Works natively in all browser contexts and Node.js without external dependencies.
 */
export function createZipArchive(files: ZipFileInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileEntries: Array<{
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    offset: number;
  }> = [];

  const chunks: Uint8Array[] = [];
  let currentOffset = 0;

  // 1. Write Local File Headers and Data
  for (const f of files) {
    const cleanPath = f.path.replace(/^\/+/, '');
    const nameBytes = encoder.encode(cleanPath);
    const dataBytes = typeof f.content === 'string' ? encoder.encode(f.content) : f.content;
    const crc = calculateCRC32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);

    // Signature 0x04034b50
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); // Version needed (2.0)
    view.setUint16(6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(8, 0, true); // Compression: Store (0)
    view.setUint16(10, 0, true); // Time
    view.setUint16(12, 0, true); // Date
    view.setUint32(14, crc, true); // CRC-32
    view.setUint32(18, dataBytes.length, true); // Compressed size
    view.setUint32(22, dataBytes.length, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // Name length
    view.setUint16(28, 0, true); // Extra length

    localHeader.set(nameBytes, 30);

    chunks.push(localHeader);
    chunks.push(dataBytes);

    fileEntries.push({
      nameBytes,
      dataBytes,
      crc,
      offset: currentOffset,
    });

    currentOffset += localHeader.length + dataBytes.length;
  }

  // 2. Write Central Directory Records
  const centralDirStart = currentOffset;
  let centralDirSize = 0;

  for (const entry of fileEntries) {
    const cdRecord = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(cdRecord.buffer);

    // Signature 0x02014b50
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed
    view.setUint16(8, 0x0800, true); // Flags: UTF-8
    view.setUint16(10, 0, true); // Compression: Store
    view.setUint16(12, 0, true); // Time
    view.setUint16(14, 0, true); // Date
    view.setUint32(16, entry.crc, true); // CRC-32
    view.setUint32(20, entry.dataBytes.length, true); // Compressed size
    view.setUint32(24, entry.dataBytes.length, true); // Uncompressed size
    view.setUint16(28, entry.nameBytes.length, true); // Name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // Comment length
    view.setUint16(34, 0, true); // Disk number
    view.setUint16(36, 0, true); // Internal attributes
    view.setUint32(38, 0, true); // External attributes
    view.setUint32(42, entry.offset, true); // Relative offset of local header

    cdRecord.set(entry.nameBytes, 46);

    chunks.push(cdRecord);
    centralDirSize += cdRecord.length;
    currentOffset += cdRecord.length;
  }

  // 3. Write End of Central Directory Record (EOCD)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  // Signature 0x06054b50
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, fileEntries.length, true); // Number of central directory records on this disk
  eocdView.setUint16(10, fileEntries.length, true); // Total number of central directory records
  eocdView.setUint32(12, centralDirSize, true); // Size of central directory
  eocdView.setUint32(16, centralDirStart, true); // Offset of start of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  chunks.push(eocd);

  // Merge all chunks into a single contiguous Uint8Array
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}

/**
 * Exports all files under a VFS directory (or all VFS files) as a standard ZIP archive.
 */
export async function exportVfsFolderAsZip(
  folderPath = '/',
): Promise<{ filename: string; zipBytes: Uint8Array; fileCount: number }> {
  const files = await vfs.listFiles(folderPath, true);
  const zipInputs: ZipFileInput[] = files.map((f) => ({
    path: f.path.startsWith(folderPath) && folderPath !== '/'
      ? f.path.slice(folderPath.length).replace(/^\/+/, '')
      : f.path.replace(/^\/+/, ''),
    content: f.content,
  }));

  const cleanName = folderPath.replace(/[/\\?%*:|"<>]/g, '_').replace(/^_+|_+$/g, '') || 'workspace';
  const filename = `nim_${cleanName}_${Date.now()}.zip`;
  const zipBytes = createZipArchive(zipInputs);

  return {
    filename,
    zipBytes,
    fileCount: files.length,
  };
}

/**
 * Builds a GitHub Gist API payload from a set of VFS files.
 */
export function buildGitHubGistPayload(
  files: VFSFile[],
  description = 'Exported from NIM Agent Virtual Workspace',
  isPublic = false,
): { description: string; public: boolean; files: Record<string, { content: string }> } {
  const gistFiles: Record<string, { content: string }> = {};

  for (const f of files) {
    const safeKey = f.path.replace(/[/\\?%*:|"<>]/g, '_').replace(/^_+/, '') || `${f.name}.${f.extension}`;
    gistFiles[safeKey] = {
      content: f.content || ' ',
    };
  }

  return {
    description,
    public: isPublic,
    files: gistFiles,
  };
}

/**
 * Consolidates multiple files into a single structured Markdown dossier.
 */
export async function compileFolderToMarkdownDossier(folderPath: string): Promise<string> {
  const files = await vfs.listFiles(folderPath, true);
  if (files.length === 0) {
    return `# Dossier: ${folderPath}\n\n*No files found in directory.*`;
  }

  const lines: string[] = [
    `# 📚 Consolidated Dossier: ${folderPath}`,
    `Generated: ${new Date().toISOString()}`,
    `Total Documents: ${files.length}`,
    '',
    '---',
    '',
  ];

  for (const f of files) {
    lines.push(`## 📄 File: \`${f.path}\``);
    lines.push(`*Last Updated: ${new Date(f.updatedAt).toLocaleString()} | Extension: \`.${f.extension}\`*`);
    lines.push('');
    if (['md', 'txt', 'csv'].includes(f.extension)) {
      lines.push(f.content);
    } else {
      lines.push('```' + f.extension);
      lines.push(f.content);
      lines.push('```');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

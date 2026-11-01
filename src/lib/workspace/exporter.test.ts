import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateCRC32,
  createZipArchive,
  exportVfsFolderAsZip,
  buildGitHubGistPayload,
  compileFolderToMarkdownDossier,
} from './exporter';
import { vfs } from './vfs';

describe('Virtual Workspace Exporter (Phase 4)', () => {
  beforeEach(async () => {
    await vfs.init();
  });

  describe('calculateCRC32', () => {
    it('calculates deterministic CRC32 for byte sequences', () => {
      const data = new TextEncoder().encode('Hello, World!');
      const crc = calculateCRC32(data);
      expect(crc).toBeTypeOf('number');
      expect(crc).toBe(0xec4ac3d0);
    });
  });

  describe('createZipArchive', () => {
    it('packages multiple files into a valid PKZIP binary structure', () => {
      const files = [
        { path: 'notes/test.txt', content: 'Hello World' },
        { path: 'code/app.js', content: 'console.log("ready");' },
      ];

      const zipBytes = createZipArchive(files);
      expect(zipBytes.length).toBeGreaterThan(100);

      // Verify ZIP Local Header Signature: 0x04034b50 (Little Endian: 0x50, 0x4b, 0x03, 0x04 = "PK\x03\x04")
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);
      expect(zipBytes[2]).toBe(0x03);
      expect(zipBytes[3]).toBe(0x04);

      // Verify End of Central Directory Record Signature: 0x06054b50 ("PK\x05\x06")
      const tail = zipBytes.slice(-22);
      expect(tail[0]).toBe(0x50);
      expect(tail[1]).toBe(0x4b);
      expect(tail[2]).toBe(0x05);
      expect(tail[3]).toBe(0x06);
    });
  });

  describe('exportVfsFolderAsZip', () => {
    it('exports all files from a directory into a zip archive', async () => {
      await vfs.writeFile('/notes/export1.md', '# Note 1');
      await vfs.writeFile('/notes/export2.md', '# Note 2');

      const result = await exportVfsFolderAsZip('/notes');
      expect(result.filename).toMatch(/^nim_notes_\d+\.zip$/);
      expect(result.fileCount).toBeGreaterThanOrEqual(2);
      expect(result.zipBytes.length).toBeGreaterThan(150);
    });
  });

  describe('buildGitHubGistPayload', () => {
    it('creates a formatted GitHub Gist API payload from VFS files', async () => {
      const file1 = await vfs.writeFile('/code/script.js', 'const x = 10;');
      const file2 = await vfs.writeFile('/research/summary.md', '# Summary');

      const payload = buildGitHubGistPayload([file1, file2], 'AI Research Bundle', false);
      expect(payload.description).toBe('AI Research Bundle');
      expect(payload.public).toBe(false);
      expect(payload.files['code_script.js']?.content).toBe('const x = 10;');
      expect(payload.files['research_summary.md']?.content).toBe('# Summary');
    });
  });

  describe('compileFolderToMarkdownDossier', () => {
    it('compiles folder files into a single publication-grade markdown document', async () => {
      await vfs.writeFile('/research/findings.md', 'Key discoveries on quantum.');
      await vfs.writeFile('/research/calc.py', 'print(42)');

      const dossier = await compileFolderToMarkdownDossier('/research');
      expect(dossier).toContain('# 📚 Consolidated Dossier: /research');
      expect(dossier).toContain('Key discoveries on quantum.');
      expect(dossier).toContain('```py');
      expect(dossier).toContain('print(42)');
    });
  });
});

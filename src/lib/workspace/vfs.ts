/**
 * NIM Virtual File System (VFS)
 * 100% in-browser persistent file system backed by IndexedDB.
 * Provides file & folder CRUD, search, append, tags, and JSON backup/restore.
 */

export interface VFSFile {
  id: string;
  path: string;          // e.g. "/research/quantum-computing/notes.md"
  name: string;          // "notes.md"
  parentDir: string;     // "/research/quantum-computing"
  extension: string;     // "md", "json", "js", "py", "csv", "html", "txt"
  mimeType: string;
  sizeBytes: number;
  content: string;       // UTF-8 string or serialized data
  createdAt: number;
  updatedAt: number;
  createdBy: 'user' | 'agent' | 'system';
  tags: string[];
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface VFSFolder {
  id: string;
  path: string;          // e.g. "/research"
  name: string;          // "research"
  parentDir: string;     // "/"
  createdAt: number;
  updatedAt: number;
}

export interface VFSStats {
  totalFiles: number;
  totalFolders: number;
  totalSizeBytes: number;
}

const DB_NAME = 'nim_workspace_db';
const DB_VERSION = 1;
const STORE_FILES = 'vfs_files';
const STORE_FOLDERS = 'vfs_folders';

// Fallback in-memory stores for environments without IndexedDB (e.g. basic Node/Vitest)
const memoryFiles = new Map<string, VFSFile>();
const memoryFolders = new Map<string, VFSFolder>();

let dbPromise: Promise<IDBDatabase> | null = null;

function normalizePath(rawPath: string): string {
  let p = rawPath.trim().replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  // Remove trailing slash unless it's root
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

function getParentPath(path: string): string {
  const norm = normalizePath(path);
  const lastSlash = norm.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return norm.substring(0, lastSlash);
}

function getFileName(path: string): string {
  const norm = normalizePath(path);
  const lastSlash = norm.lastIndexOf('/');
  return lastSlash >= 0 ? norm.substring(lastSlash + 1) : norm;
}

function getExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.substring(lastDot + 1).toLowerCase() : 'txt';
}

function getMimeType(ext: string): string {
  switch (ext) {
    case 'md': return 'text/markdown';
    case 'json': return 'application/json';
    case 'js':
    case 'ts': return 'text/javascript';
    case 'py': return 'text/x-python';
    case 'html': return 'text/html';
    case 'css': return 'text/css';
    case 'csv': return 'text/csv';
    default: return 'text/plain';
  }
}

function generateId(): string {
  return 'vfs_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
}

/** Check if IndexedDB is available in the current runtime context */
function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** Open or return the IndexedDB database instance */
function getDB(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error('IndexedDB not available in this environment'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          const fileStore = db.createObjectStore(STORE_FILES, { keyPath: 'path' });
          fileStore.createIndex('parentDir', 'parentDir', { unique: false });
          fileStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          fileStore.createIndex('extension', 'extension', { unique: false });
          fileStore.createIndex('createdBy', 'createdBy', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          const folderStore = db.createObjectStore(STORE_FOLDERS, { keyPath: 'path' });
          folderStore.createIndex('parentDir', 'parentDir', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

export class VirtualFileSystem {
  private initialized = false;

  /** Initialize VFS and ensure default directory scaffolding */
  public async init(): Promise<void> {
    if (this.initialized) return;

    // Create standard root folders
    const defaultFolders = ['/notes', '/research', '/code', '/data', '/trash'];
    for (const folder of defaultFolders) {
      await this.ensureFolder(folder);
    }

    // Check if welcome note exists, if not create it
    const welcome = await this.readFile('/notes/welcome.md');
    if (!welcome) {
      await this.writeFile(
        '/notes/welcome.md',
        `# Welcome to NIM Virtual Workspace! 🗂️

This is your autonomous in-browser desktop and persistent file system.

### What can you do here?
- **AI Agent Automation**: The agent automatically writes research notes, scraped tables, code snippets, and dossiers here.
- **Persistent Storage**: All files are stored client-side in IndexedDB with zero cloud requirement.
- **Timed Deep Research**: Let the agent crawl the web for 2, 5, or 10 minutes — watch notes appear here in real-time.
- **Coding Space**: Write, edit, and preview JavaScript, HTML, Python, and Markdown files.

*Created on ${new Date().toLocaleDateString()} by NIM Agent*
`,
        { createdBy: 'system', tags: ['getting-started', 'guide'] }
      );
    }

    this.initialized = true;
  }

  /** Ensure a folder exists, recursively creating parents */
  public async ensureFolder(path: string): Promise<VFSFolder> {
    const norm = normalizePath(path);
    if (norm === '/') {
      return { id: 'root', path: '/', name: '/', parentDir: '', createdAt: 0, updatedAt: 0 };
    }

    const existing = await this.getFolder(norm);
    if (existing) return existing;

    const parent = getParentPath(norm);
    if (parent !== '/') {
      await this.ensureFolder(parent);
    }

    const folder: VFSFolder = {
      id: generateId(),
      path: norm,
      name: getFileName(norm),
      parentDir: parent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (isIndexedDBAvailable()) {
      try {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_FOLDERS, 'readwrite');
          tx.objectStore(STORE_FOLDERS).put(folder);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        memoryFolders.set(norm, folder);
      }
    } else {
      memoryFolders.set(norm, folder);
    }

    return folder;
  }

  /** Get folder by exact path */
  public async getFolder(path: string): Promise<VFSFolder | null> {
    const norm = normalizePath(path);
    if (isIndexedDBAvailable()) {
      try {
        const db = await getDB();
        return await new Promise<VFSFolder | null>((resolve, reject) => {
          const tx = db.transaction(STORE_FOLDERS, 'readonly');
          const req = tx.objectStore(STORE_FOLDERS).get(norm);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return memoryFolders.get(norm) || null;
      }
    }
    return memoryFolders.get(norm) || null;
  }

  /** Write or overwrite a file in the workspace */
  public async writeFile(
    path: string,
    content: string,
    options?: {
      createdBy?: 'user' | 'agent' | 'system';
      tags?: string[];
      metadata?: Record<string, unknown>;
      overwrite?: boolean;
    }
  ): Promise<VFSFile> {
    const norm = normalizePath(path);
    const parentDir = getParentPath(norm);
    await this.ensureFolder(parentDir);

    const existing = await this.readFile(norm);
    if (existing && options?.overwrite === false) {
      throw new Error(`File already exists at ${norm} and overwrite is false`);
    }

    const name = getFileName(norm);
    const ext = getExtension(name);
    const now = Date.now();

    const file: VFSFile = {
      id: existing ? existing.id : generateId(),
      path: norm,
      name,
      parentDir,
      extension: ext,
      mimeType: getMimeType(ext),
      sizeBytes: new Blob([content]).size,
      content,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      createdBy: options?.createdBy ?? (existing ? existing.createdBy : 'user'),
      tags: options?.tags ?? (existing ? existing.tags : []),
      metadata: options?.metadata ?? (existing ? existing.metadata : undefined),
    };

    if (isIndexedDBAvailable()) {
      try {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_FILES, 'readwrite');
          tx.objectStore(STORE_FILES).put(file);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        memoryFiles.set(norm, file);
      }
    } else {
      memoryFiles.set(norm, file);
    }

    return file;
  }

  /** Append content to a file. Creates file if it doesn't exist. */
  public async appendFile(
    path: string,
    textToAppend: string,
    options?: {
      createdBy?: 'user' | 'agent' | 'system';
      separator?: string;
    }
  ): Promise<VFSFile> {
    const existing = await this.readFile(path);
    const separator = options?.separator ?? '\n\n';
    const newContent = existing ? existing.content + separator + textToAppend : textToAppend;
    return this.writeFile(path, newContent, {
      createdBy: options?.createdBy ?? (existing ? existing.createdBy : 'agent'),
    });
  }

  /** Read file content and metadata */
  public async readFile(path: string): Promise<VFSFile | null> {
    const norm = normalizePath(path);
    if (isIndexedDBAvailable()) {
      try {
        const db = await getDB();
        return await new Promise<VFSFile | null>((resolve, reject) => {
          const tx = db.transaction(STORE_FILES, 'readonly');
          const req = tx.objectStore(STORE_FILES).get(norm);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return memoryFiles.get(norm) || null;
      }
    }
    return memoryFiles.get(norm) || null;
  }

  /** Delete a file or move it to /trash/ */
  public async deleteFile(path: string, permanent = false): Promise<boolean> {
    const norm = normalizePath(path);
    const existing = await this.readFile(norm);
    if (!existing) return false;

    if (!permanent && !norm.startsWith('/trash/')) {
      // Move to trash
      const trashPath = `/trash/${existing.name}`;
      await this.writeFile(trashPath, existing.content, {
        createdBy: existing.createdBy,
        tags: existing.tags,
        metadata: { originalPath: norm, deletedAt: Date.now() },
      });
    }

    if (isIndexedDBAvailable()) {
      try {
        const db = await getDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_FILES, 'readwrite');
          tx.objectStore(STORE_FILES).delete(norm);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        memoryFiles.delete(norm);
      }
    } else {
      memoryFiles.delete(norm);
    }

    return true;
  }

  /** List all files optionally filtered by parent directory or tag */
  public async listFiles(parentDir?: string, recursive = false): Promise<VFSFile[]> {
    let allFiles: VFSFile[] = [];

    if (isIndexedDBAvailable()) {
      try {
        const db = await getDB();
        allFiles = await new Promise<VFSFile[]>((resolve, reject) => {
          const tx = db.transaction(STORE_FILES, 'readonly');
          const req = tx.objectStore(STORE_FILES).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      } catch {
        allFiles = Array.from(memoryFiles.values());
      }
    } else {
      allFiles = Array.from(memoryFiles.values());
    }

    if (!parentDir || parentDir === '/') {
      if (!recursive) {
        return allFiles.filter(f => f.parentDir === '/' || f.parentDir === '');
      }
      return allFiles;
    }

    const normParent = normalizePath(parentDir);
    if (recursive) {
      return allFiles.filter(f => f.parentDir === normParent || f.parentDir.startsWith(normParent + '/'));
    }
    return allFiles.filter(f => f.parentDir === normParent);
  }

  /** List folders directly under parentDir */
  public async listFolders(parentDir?: string): Promise<VFSFolder[]> {
    let allFolders: VFSFolder[] = [];

    if (isIndexedDBAvailable()) {
      try {
        const db = await getDB();
        allFolders = await new Promise<VFSFolder[]>((resolve, reject) => {
          const tx = db.transaction(STORE_FOLDERS, 'readonly');
          const req = tx.objectStore(STORE_FOLDERS).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      } catch {
        allFolders = Array.from(memoryFolders.values());
      }
    } else {
      allFolders = Array.from(memoryFolders.values());
    }

    const normParent = parentDir ? normalizePath(parentDir) : '/';
    return allFolders.filter(f => f.parentDir === normParent);
  }

  /** Search across file names and content */
  public async searchFiles(query: string): Promise<VFSFile[]> {
    const q = query.toLowerCase();
    const all = await this.listFiles('/', true);
    return all.filter(
      f =>
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.content.toLowerCase().includes(q) ||
        f.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /** Retrieve workspace statistics */
  public async getStats(): Promise<VFSStats> {
    const files = await this.listFiles('/', true);
    const folders = await this.listFolders('/');
    const totalSizeBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);
    return {
      totalFiles: files.length,
      totalFolders: folders.length,
      totalSizeBytes,
    };
  }

  /** Export entire workspace as serialized JSON string for backup */
  public async exportAsJson(): Promise<string> {
    const files = await this.listFiles('/', true);
    const folders = await this.listFolders('/');
    return JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      files,
      folders,
    }, null, 2);
  }

  /** Import files and folders from JSON backup */
  public async importFromJson(jsonString: string): Promise<number> {
    const data = JSON.parse(jsonString);
    if (!data.files || !Array.isArray(data.files)) {
      throw new Error('Invalid workspace JSON backup');
    }
    let count = 0;
    for (const f of data.files) {
      await this.writeFile(f.path, f.content, {
        createdBy: f.createdBy,
        tags: f.tags,
        metadata: f.metadata,
      });
      count++;
    }
    return count;
  }

  /** Empty all files in /trash/ */
  public async emptyTrash(): Promise<number> {
    const trashFiles = await this.listFiles('/trash', true);
    for (const f of trashFiles) {
      await this.deleteFile(f.path, true);
    }
    return trashFiles.length;
  }
}

// Singleton VFS instance
export const vfs = new VirtualFileSystem();

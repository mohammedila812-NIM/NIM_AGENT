import React, { useState, useEffect, useMemo } from 'react';
import {
  Folder,
  FileText,
  FileCode,
  Table,
  Trash2,
  Download,
  Plus,
  Search,
  Edit3,
  Eye,
  Check,
  Copy,
  Save,
  HardDrive,
  RefreshCw,
  FolderOpen,
  Code,
  Tag,
  Clock,
} from 'lucide-react';
import { vfs, type VFSFile, type VFSStats } from '../../../lib/workspace/vfs';
import { MarkdownMessage } from './MarkdownMessage';

export const WorkspacePanel: React.FC = () => {
  const [files, setFiles] = useState<VFSFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>('/notes/welcome.md');
  const [activeFolder, setActiveFolder] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [stats, setStats] = useState<VFSStats>({ totalFiles: 0, totalFolders: 0, totalSizeBytes: 0 });
  const [copied, setCopied] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadWorkspace = async () => {
    await vfs.init();
    const allFiles = await vfs.listFiles('/', true);
    setFiles(allFiles);
    const s = await vfs.getStats();
    setStats(s);

    if (selectedPath) {
      const current = await vfs.readFile(selectedPath);
      if (current) {
        setEditContent(current.content);
      } else if (allFiles.length > 0) {
        setSelectedPath(allFiles[0].path);
        setEditContent(allFiles[0].content);
      } else {
        setSelectedPath(null);
        setEditContent('');
      }
    } else if (allFiles.length > 0) {
      setSelectedPath(allFiles[0].path);
      setEditContent(allFiles[0].content);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const selectedFile = useMemo(() => {
    return files.find((f) => f.path === selectedPath) || null;
  }, [files, selectedPath]);

  const handleSelectFile = (file: VFSFile) => {
    setSelectedPath(file.path);
    setEditContent(file.content);
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedPath) return;
    await vfs.writeFile(selectedPath, editContent, { overwrite: true, createdBy: 'user' });
    setSaveMessage('Saved!');
    setTimeout(() => setSaveMessage(null), 2000);
    await loadWorkspace();
  };

  const handleDelete = async (path: string, permanent = false) => {
    await vfs.deleteFile(path, permanent);
    await loadWorkspace();
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) return;

    let path = newPath.trim();
    if (!path.startsWith('/')) path = '/' + path;

    const tags = newTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await vfs.writeFile(path, newContent, {
      createdBy: 'user',
      tags,
      overwrite: true,
    });

    setIsCreating(false);
    setNewPath('');
    setNewContent('');
    setNewTags('');
    await loadWorkspace();
    setSelectedPath(path);
    setEditContent(newContent);
  };

  const handleCopy = () => {
    if (!selectedFile) return;
    void navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = (file: VFSFile) => {
    const blob = new Blob([file.content], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportBackup = async () => {
    const json = await vfs.exportAsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nim-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEmptyTrash = async () => {
    await vfs.emptyTrash();
    await loadWorkspace();
  };

  // Filtered files list
  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      // Folder filter
      if (activeFolder !== 'all') {
        if (!f.parentDir.startsWith(activeFolder)) return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = f.name.toLowerCase().includes(q);
        const matchesPath = f.path.toLowerCase().includes(q);
        const matchesTag = f.tags.some((t) => t.toLowerCase().includes(q));
        const matchesContent = f.content.toLowerCase().includes(q);
        return matchesName || matchesPath || matchesTag || matchesContent;
      }
      return true;
    });
  }, [files, activeFolder, searchQuery]);

  const getFileIcon = (ext: string) => {
    switch (ext) {
      case 'md':
      case 'txt':
        return <FileText className="w-4 h-4 text-sky-400 shrink-0" />;
      case 'js':
      case 'ts':
        return <Code className="w-4 h-4 text-amber-400 shrink-0" />;
      case 'py':
        return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'csv':
        return <Table className="w-4 h-4 text-purple-400 shrink-0" />;
      case 'json':
        return <FileCode className="w-4 h-4 text-teal-400 shrink-0" />;
      case 'html':
      case 'css':
        return <FileCode className="w-4 h-4 text-rose-400 shrink-0" />;
      default:
        return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden text-xs">
      {/* Top Header */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-brand-400" />
          <span className="font-semibold text-slate-200">NIM Workspace</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
            {stats.totalFiles} files • {formatBytes(stats.totalSizeBytes)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsCreating(true)}
            className="px-2 py-1 bg-brand-600 hover:bg-brand-500 text-white rounded flex items-center gap-1 transition"
            title="Create New File"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New File</span>
          </button>
          <button
            onClick={handleExportBackup}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
            title="Export Workspace JSON Backup"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => void loadWorkspace()}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
            title="Refresh Files"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Directory Filter & Search */}
      <div className="p-2 border-b border-slate-800/80 bg-slate-950/40 space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder="Search files, content, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-brand-500"
          />
        </div>

        {/* Folder Tags */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {[
            { id: 'all', label: 'All Files' },
            { id: '/notes', label: '📝 Notes' },
            { id: '/research', label: '🔬 Research' },
            { id: '/code', label: '💻 Code' },
            { id: '/data', label: '📊 Data' },
            { id: '/trash', label: '🗑️ Trash' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFolder(f.id)}
              className={`px-2 py-0.5 whitespace-nowrap rounded text-[11px] transition ${
                activeFolder === f.id
                  ? 'bg-brand-600/30 text-brand-300 border border-brand-500/50 font-medium'
                  : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 border border-transparent'
              }`}
            >
              {f.label}
            </button>
          ))}
          {activeFolder === '/trash' && files.some((f) => f.parentDir === '/trash') && (
            <button
              onClick={() => void handleEmptyTrash()}
              className="ml-auto px-2 py-0.5 text-rose-400 hover:text-rose-300 text-[10px] flex items-center gap-1"
            >
              Empty
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left File List */}
        <div className="w-2/5 border-r border-slate-800/80 overflow-y-auto p-1.5 space-y-1 bg-slate-900/50">
          {filteredFiles.length === 0 ? (
            <div className="p-4 text-center text-slate-500 space-y-1">
              <FolderOpen className="w-6 h-6 mx-auto text-slate-600" />
              <p className="text-[11px]">No files in folder</p>
            </div>
          ) : (
            filteredFiles.map((file) => {
              const isSelected = selectedPath === file.path;
              return (
                <div
                  key={file.path}
                  onClick={() => handleSelectFile(file)}
                  className={`group p-2 rounded cursor-pointer transition flex items-start justify-between gap-1.5 ${
                    isSelected
                      ? 'bg-brand-600/20 border border-brand-500/40 text-slate-100'
                      : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {getFileIcon(file.extension)}
                    <div className="min-w-0">
                      <div className="font-medium text-[11px] truncate">{file.name}</div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <span>{formatBytes(file.sizeBytes)}</span>
                        <span>•</span>
                        <span>{file.createdBy}</span>
                      </div>
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(file.path, file.parentDir === '/trash');
                      }}
                      className="p-1 text-slate-500 hover:text-rose-400 rounded"
                      title={file.parentDir === '/trash' ? 'Delete Permanently' : 'Move to Trash'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Editor / Preview Pane */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/60">
          {selectedFile ? (
            <>
              {/* File Action Bar */}
              <div className="p-2 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  {getFileIcon(selectedFile.extension)}
                  <span className="font-semibold text-slate-200 truncate">{selectedFile.path}</span>
                  {selectedFile.tags.map((t) => (
                    <span
                      key={t}
                      className="px-1.5 py-0.2 rounded bg-slate-800 text-[9px] text-slate-400 border border-slate-700/60"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isEditing ? (
                    <button
                      onClick={() => void handleSaveEdit()}
                      className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded flex items-center gap-1 text-[11px]"
                    >
                      <Save className="w-3 h-3" />
                      <span>{saveMessage || 'Save'}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center gap-1 text-[11px]"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  )}

                  {isEditing && (
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditContent(selectedFile.content);
                      }}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[11px]"
                    >
                      Cancel
                    </button>
                  )}

                  <button
                    onClick={handleCopy}
                    className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
                    title="Copy Content"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() => handleDownloadFile(selectedFile)}
                    className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
                    title="Download File"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* File Content Area */}
              <div className="flex-1 overflow-y-auto p-3 font-sans">
                {isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-full bg-slate-900 border border-slate-800 rounded p-2.5 font-mono text-[11px] text-slate-200 resize-none focus:outline-none focus:border-brand-500"
                    placeholder="Type or paste content here..."
                  />
                ) : selectedFile.extension === 'md' ? (
                  <div className="prose prose-invert max-w-none text-slate-200">
                    <MarkdownMessage text={selectedFile.content} />
                  </div>
                ) : (
                  <pre className="p-3 bg-slate-900/80 rounded border border-slate-800/80 font-mono text-[11px] text-slate-300 whitespace-pre-wrap overflow-x-auto">
                    {selectedFile.content}
                  </pre>
                )}
              </div>

              {/* File Footer Meta */}
              <div className="px-3 py-1.5 border-t border-slate-800/80 bg-slate-900/40 text-[10px] text-slate-500 flex items-center justify-between">
                <span>Updated: {new Date(selectedFile.updatedAt).toLocaleString()}</span>
                <span>Created by: {selectedFile.createdBy}</span>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 space-y-2">
              <HardDrive className="w-10 h-10 text-slate-700" />
              <p className="text-sm font-medium text-slate-400">No File Selected</p>
              <p className="text-xs text-slate-600 max-w-xs">
                Select a file from the list or click "New File" to create notes, scripts, or research documents.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* New File Modal */}
      {isCreating && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreateFile}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 text-sm">Create New Workspace File</span>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-slate-500 hover:text-slate-300 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider">File Path</label>
              <input
                type="text"
                placeholder="/notes/my-note.md or /code/script.js"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                required
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 text-xs focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider">Tags (comma-separated)</label>
              <input
                type="text"
                placeholder="research, ai, summary"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 text-xs focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider">Initial Content</label>
              <textarea
                placeholder="# File Title\nWrite content here..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded text-xs"
              >
                Create File
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

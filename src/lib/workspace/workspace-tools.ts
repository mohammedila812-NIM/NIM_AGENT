/**
 * Agent tool execution handlers for the NIM Virtual Workspace.
 * Enables the ReAct agent to autonomously create documents, append research notes,
 * read files, list directories, and organize workspace assets.
 */

import { vfs } from './vfs';

export async function executeWorkspaceCreateFile(
  path: string,
  content: string,
  tags?: string[],
  overwrite?: boolean
): Promise<string> {
  try {
    await vfs.init();
    const file = await vfs.writeFile(path, content, {
      createdBy: 'agent',
      tags: tags ?? [],
      overwrite: overwrite ?? true,
    });
    return `WORKSPACE_SUCCESS: File created at "${file.path}" (${file.sizeBytes} bytes, ${file.extension}).`;
  } catch (err: unknown) {
    return `WORKSPACE_ERROR: Failed to create file at "${path}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeWorkspaceAppendFile(
  path: string,
  text: string
): Promise<string> {
  try {
    await vfs.init();
    const file = await vfs.appendFile(path, text, {
      createdBy: 'agent',
    });
    return `WORKSPACE_SUCCESS: Appended to "${file.path}". Total file size now ${file.sizeBytes} bytes.`;
  } catch (err: unknown) {
    return `WORKSPACE_ERROR: Failed to append to "${path}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeWorkspaceReadFile(path: string): Promise<string> {
  try {
    await vfs.init();
    const file = await vfs.readFile(path);
    if (!file) {
      return `WORKSPACE_ERROR: File not found at "${path}". Use workspace_list_files to see existing files.`;
    }
    return `--- FILE: ${file.path} (${file.sizeBytes} bytes, updated ${new Date(file.updatedAt).toISOString()}) ---
${file.content}
--- END FILE ---`;
  } catch (err: unknown) {
    return `WORKSPACE_ERROR: Failed to read file at "${path}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeWorkspaceListFiles(
  directory?: string,
  recursive?: boolean
): Promise<string> {
  try {
    await vfs.init();
    const targetDir = directory || '/';
    const files = await vfs.listFiles(targetDir, recursive ?? true);
    const folders = await vfs.listFolders(targetDir);

    if (files.length === 0 && folders.length === 0) {
      return `WORKSPACE: Directory "${targetDir}" is currently empty.`;
    }

    const lines: string[] = [`Workspace items in "${targetDir}":`];
    for (const folder of folders) {
      lines.push(`📁 ${folder.path}/`);
    }
    for (const file of files) {
      const tagStr = file.tags.length > 0 ? ` [tags: ${file.tags.join(', ')}]` : '';
      lines.push(`📄 ${file.path} (${file.sizeBytes} bytes, ${file.extension})${tagStr}`);
    }

    return lines.join('\n');
  } catch (err: unknown) {
    return `WORKSPACE_ERROR: Failed to list files: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeWorkspaceDeleteFile(
  path: string,
  permanent?: boolean
): Promise<string> {
  try {
    await vfs.init();
    const success = await vfs.deleteFile(path, permanent ?? false);
    if (!success) {
      return `WORKSPACE_ERROR: File at "${path}" not found.`;
    }
    return permanent
      ? `WORKSPACE_SUCCESS: File at "${path}" was permanently deleted.`
      : `WORKSPACE_SUCCESS: File at "${path}" was moved to /trash/.`;
  } catch (err: unknown) {
    return `WORKSPACE_ERROR: Failed to delete file at "${path}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeWorkspaceSearch(query: string): Promise<string> {
  try {
    await vfs.init();
    const matches = await vfs.searchFiles(query);
    if (matches.length === 0) {
      return `WORKSPACE_SEARCH: No files matched query "${query}".`;
    }
    const lines = [`Found ${matches.length} matching file(s) for "${query}":`];
    for (const m of matches) {
      // Find a snippet preview around match
      const lowerContent = m.content.toLowerCase();
      const idx = lowerContent.indexOf(query.toLowerCase());
      let snippet = '';
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(m.content.length, idx + query.length + 60);
        snippet = ` -> "...${m.content.substring(start, end).replace(/\n/g, ' ')}..."`;
      }
      lines.push(`📄 ${m.path} (${m.sizeBytes} bytes)${snippet}`);
    }
    return lines.join('\n');
  } catch (err: unknown) {
    return `WORKSPACE_ERROR: Search failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

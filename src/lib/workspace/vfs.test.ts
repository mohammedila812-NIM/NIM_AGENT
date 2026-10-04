import { describe, it, expect, beforeEach } from 'vitest';
import { vfs } from './vfs';
import {
  executeWorkspaceCreateFile,
  executeWorkspaceAppendFile,
  executeWorkspaceReadFile,
  executeWorkspaceListFiles,
  executeWorkspaceDeleteFile,
  executeWorkspaceSearch,
} from './workspace-tools';

describe('Virtual File System (VFS)', () => {
  beforeEach(async () => {
    await vfs.init();
  });

  it('initializes standard directories and welcome note', async () => {
    const welcome = await vfs.readFile('/notes/welcome.md');
    expect(welcome).not.toBeNull();
    expect(welcome?.name).toBe('welcome.md');
    expect(welcome?.extension).toBe('md');
    expect(welcome?.content).toContain('Welcome to NIM Virtual Workspace');
  });

  it('creates and reads files correctly', async () => {
    const file = await vfs.writeFile('/notes/test.md', '# Test Heading\nContent here.', {
      createdBy: 'agent',
      tags: ['test', 'vfs'],
    });

    expect(file.path).toBe('/notes/test.md');
    expect(file.parentDir).toBe('/notes');
    expect(file.extension).toBe('md');
    expect(file.tags).toEqual(['test', 'vfs']);

    const read = await vfs.readFile('/notes/test.md');
    expect(read).not.toBeNull();
    expect(read?.content).toBe('# Test Heading\nContent here.');
  });

  it('appends text to an existing file', async () => {
    await vfs.writeFile('/research/log.txt', 'Line 1');
    const updated = await vfs.appendFile('/research/log.txt', 'Line 2');
    expect(updated.content).toBe('Line 1\n\nLine 2');
  });

  it('deletes and moves files to /trash/', async () => {
    await vfs.writeFile('/data/temp.csv', 'id,val\n1,100');
    const deleted = await vfs.deleteFile('/data/temp.csv');
    expect(deleted).toBe(true);

    const original = await vfs.readFile('/data/temp.csv');
    expect(original).toBeNull();

    const trash = await vfs.readFile('/trash/temp.csv');
    expect(trash).not.toBeNull();
  });

  it('lists files and folders', async () => {
    await vfs.writeFile('/code/script.js', 'console.log("hello");');
    const files = await vfs.listFiles('/code');
    expect(files.some(f => f.name === 'script.js')).toBe(true);
  });

  it('searches file content', async () => {
    await vfs.writeFile('/notes/crypto.md', 'Bitcoin and Ethereum decentralized networks.');
    const results = await vfs.searchFiles('Ethereum');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('/notes/crypto.md');
  });

  it('provides agent tool handlers with string output', async () => {
    const createRes = await executeWorkspaceCreateFile('/notes/agent_plan.md', 'Plan content');
    expect(createRes).toContain('WORKSPACE_SUCCESS: File created');

    const appendRes = await executeWorkspaceAppendFile('/notes/agent_plan.md', 'Step 1 complete');
    expect(appendRes).toContain('WORKSPACE_SUCCESS: Appended');

    const readRes = await executeWorkspaceReadFile('/notes/agent_plan.md');
    expect(readRes).toContain('Plan content');
    expect(readRes).toContain('Step 1 complete');

    const listRes = await executeWorkspaceListFiles('/notes');
    expect(listRes).toContain('agent_plan.md');

    const searchRes = await executeWorkspaceSearch('Step 1');
    expect(searchRes).toContain('agent_plan.md');

    const deleteRes = await executeWorkspaceDeleteFile('/notes/agent_plan.md');
    expect(deleteRes).toContain('WORKSPACE_SUCCESS');
  });
});

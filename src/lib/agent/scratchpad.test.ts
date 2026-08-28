import { describe, it, expect, beforeEach } from 'vitest';
import {
  setScratchpadVar,
  getScratchpadVar,
  listScratchpadVars,
  deleteScratchpadVar,
  clearScratchpad,
  executeScratchpadWrite,
  executeScratchpadRead,
} from './scratchpad';
import { validateToolCall } from './tools/schemas';

describe('Shared Persistent Scratchpad', () => {
  beforeEach(async () => {
    await clearScratchpad();
  });

  it('validates scratchpad_write and scratchpad_read schemas with Zod', () => {
    const writeCall = {
      tool: 'scratchpad_write',
      key: 'auth_token',
      value: 'eyJhGciOi...',
      notes: 'User bearer token',
    };
    expect(validateToolCall(writeCall).success).toBe(true);

    const readCall = {
      tool: 'scratchpad_read',
      key: 'auth_token',
    };
    expect(validateToolCall(readCall).success).toBe(true);
  });

  it('sets and retrieves variables', async () => {
    await setScratchpadVar('cart_total', '$129.99', 'Tax included');
    const entry = await getScratchpadVar('cart_total');
    expect(entry).not.toBeNull();
    expect(entry?.value).toBe('$129.99');
    expect(entry?.notes).toBe('Tax included');
  });

  it('lists all stored variables', async () => {
    await setScratchpadVar('item1', 'Laptop');
    await setScratchpadVar('item2', 'Mouse');

    const all = await listScratchpadVars();
    expect(all).toHaveLength(2);
    const keys = all.map((e) => e.key);
    expect(keys).toContain('item1');
    expect(keys).toContain('item2');
  });

  it('deletes specific variables and clears all', async () => {
    await setScratchpadVar('temp_key', '123');
    expect(await getScratchpadVar('temp_key')).not.toBeNull();

    await deleteScratchpadVar('temp_key');
    expect(await getScratchpadVar('temp_key')).toBeNull();

    await setScratchpadVar('keyA', 'A');
    await setScratchpadVar('keyB', 'B');
    await clearScratchpad();
    expect(await listScratchpadVars()).toHaveLength(0);
  });

  it('executes scratchpad_write and scratchpad_read tool actions', async () => {
    const writeOutput = await executeScratchpadWrite('best_deal', '$649 on Amazon', 'Acer Nitro');
    expect(writeOutput).toContain('SCRATCHPAD UPDATED');
    expect(writeOutput).toContain('best_deal');

    const readSpecific = await executeScratchpadRead('best_deal');
    expect(readSpecific).toContain('SCRATCHPAD [best_deal]');
    expect(readSpecific).toContain('$649 on Amazon');

    const readAll = await executeScratchpadRead();
    expect(readAll).toContain('SCRATCHPAD (1 variables stored)');
    expect(readAll).toContain('best_deal');
  });
});

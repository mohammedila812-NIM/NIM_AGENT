import { describe, it, expect } from 'vitest';
import { executeInBrowserJS } from './runner';

describe('Sandboxed Code Runner', () => {
  it('executes simple calculation and returns result', async () => {
    const res = await executeInBrowserJS('const a = 10; const b = 25; return a + b;');
    expect(res.success).toBe(true);
    expect(res.result).toBe('35');
  });

  it('captures console.log and console.warn calls', async () => {
    const code = `
      console.log("Hello from sandbox");
      console.warn("Warning check");
      return "done";
    `;
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(true);
    expect(res.logs.some((l) => l.text.includes('Hello from sandbox'))).toBe(true);
    expect(res.logs.some((l) => l.text.includes('Warning check'))).toBe(true);
    expect(res.result).toBe('done');
  });

  it('catches runtime errors gracefully', async () => {
    const code = 'const x = null; x.someUndefinedProperty();';
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});

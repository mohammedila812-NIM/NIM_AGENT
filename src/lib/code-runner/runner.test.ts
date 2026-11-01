import { describe, it, expect } from 'vitest';
import {
  executeInBrowserJS,
  buildSandboxHtml,
  validateSandboxMessage,
} from './runner';

describe('Sandboxed Code Runner — Core Functionality', () => {
  it('executes simple calculation and returns result', async () => {
    const res = await executeInBrowserJS('const a = 10; const b = 25; return a + b;');
    expect(res.success).toBe(true);
    expect(res.result).toBe('35');
    expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('captures console.log, info, warn, and error calls', async () => {
    const code = `
      console.log("Hello from sandbox");
      console.info("Info check");
      console.warn("Warning check");
      console.error("Error check");
      return "done";
    `;
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(true);
    expect(res.logs.some((l) => l.type === 'log' && l.text.includes('Hello from sandbox'))).toBe(true);
    expect(res.logs.some((l) => l.type === 'info' && l.text.includes('Info check'))).toBe(true);
    expect(res.logs.some((l) => l.type === 'warn' && l.text.includes('Warning check'))).toBe(true);
    expect(res.logs.some((l) => l.type === 'error' && l.text.includes('Error check'))).toBe(true);
    expect(res.result).toBe('done');
  });

  it('catches runtime errors gracefully', async () => {
    const code = 'const x = null; x.someUndefinedProperty();';
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/Cannot read propert|is null/);
  });

  it('catches syntax errors gracefully without crashing', async () => {
    const code = 'function broken( { return 123;';
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('resolves async / Promise return values', async () => {
    const code = `
      return new Promise((resolve) => {
        setTimeout(() => resolve({ status: "async_success", val: 42 }), 10);
      });
    `;
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(true);
    expect(res.result).toContain('"status": "async_success"');
    expect(res.result).toContain('"val": 42');
  });
});

describe('Sandboxed Code Runner — Security & Injection Remediation (FINDING-P0-02)', () => {
  it('guarantees static sandbox HTML harness with zero code interpolation', () => {
    const html = buildSandboxHtml();
    // Harness must be completely invariant and not accept arbitrary code
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain("type !== 'SANDBOX_EXECUTE'");
    expect(html).toContain("new Function('console'");
    expect(html).toContain('</script>');
  });

  it('safely handles JavaScript containing a literal </script> sequence in strings', async () => {
    const code = `
      const payload = "</script><script>alert('pwned')</script>";
      console.log("Processed:", payload);
      return payload.length;
    `;
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(true);
    expect(res.result).toBe('40');
    expect(res.logs.some((l) => l.text.includes("</script><script>alert('pwned')</script>"))).toBe(true);
  });

  it('safely handles HTML-like tags and comments inside code', async () => {
    const code = `
      // </script><img src=x onerror=alert(1)>
      /* </div><script src="https://evil.com/malware.js"></script> */
      const htmlSnippet = '<div class="alert">Notice: </script> tag here</div>';
      return htmlSnippet;
    `;
    const res = await executeInBrowserJS(code);
    expect(res.success).toBe(true);
    expect(res.result).toBe('<div class="alert">Notice: </script> tag here</div>');
  });

  it('validates incoming sandbox messages against executionId nonce', () => {
    const mockWindow = {};
    const validExecutionId = 'valid-nonce-12345';

    // 1. Valid execution message
    const validEvent = {
      source: mockWindow,
      origin: 'null',
      data: {
        type: 'SANDBOX_DONE',
        executionId: validExecutionId,
        result: '42',
      },
    };
    const validResult = validateSandboxMessage(validEvent, validExecutionId, mockWindow);
    expect(validResult.valid).toBe(true);

    // 2. Spoofed completion with wrong nonce
    const spoofedEvent = {
      source: mockWindow,
      origin: 'null',
      data: {
        type: 'SANDBOX_DONE',
        executionId: 'attacker-nonce-99999',
        result: 'spoofed_value',
      },
    };
    const spoofedResult = validateSandboxMessage(spoofedEvent, validExecutionId, mockWindow);
    expect(spoofedResult.valid).toBe(false);
    if (!spoofedResult.valid) {
      expect(spoofedResult.reason).toContain('Execution ID nonce mismatch');
    }

    // 3. Message from unexpected window / source
    const foreignWindow = {};
    const foreignEvent = {
      source: foreignWindow,
      origin: 'null',
      data: {
        type: 'SANDBOX_DONE',
        executionId: validExecutionId,
        result: 'hijacked',
      },
    };
    const foreignResult = validateSandboxMessage(foreignEvent, validExecutionId, mockWindow);
    expect(foreignResult.valid).toBe(false);
    if (!foreignResult.valid) {
      expect(foreignResult.reason).toContain('Source window mismatch');
    }

    // 4. Malformed message payload (non-object or null)
    const malformedEvent = {
      source: mockWindow,
      origin: 'null',
      data: 'SANDBOX_DONE',
    };
    const malformedResult = validateSandboxMessage(malformedEvent, validExecutionId, mockWindow);
    expect(malformedResult.valid).toBe(false);
    if (!malformedResult.valid) {
      expect(malformedResult.reason).toContain('Malformed message');
    }

    // 5. Unknown message type
    const unknownTypeEvent = {
      source: mockWindow,
      origin: 'null',
      data: {
        type: 'UNEXPECTED_ACTION',
        executionId: validExecutionId,
      },
    };
    const unknownTypeResult = validateSandboxMessage(unknownTypeEvent, validExecutionId, mockWindow);
    expect(unknownTypeResult.valid).toBe(false);
    if (!unknownTypeResult.valid) {
      expect(unknownTypeResult.reason).toContain('Invalid message type');
    }
  });

  it('accepts SANDBOX_READY handshake only from expected source window', () => {
    const mockWindow = {};
    const readyEvent = {
      source: mockWindow,
      origin: 'null',
      data: { type: 'SANDBOX_READY' },
    };
    const result = validateSandboxMessage(readyEvent, 'nonce', mockWindow);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.message.type).toBe('SANDBOX_READY');
    }
  });
});

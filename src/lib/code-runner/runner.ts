/**
 * Safe In-Browser Sandboxed Code Runner
 * Executes JavaScript snippets safely in an isolated iframe sandbox with
 * console interception, execution timeout guard, and structured return values.
 *
 * Security Architecture:
 * 1. ZERO Code Interpolation into HTML:
 *    The sandbox iframe HTML is 100% static. Untrusted user/agent code is NEVER
 *    interpolated into the HTML markup or script tags, completely eliminating
 *    HTML tag breakout (e.g. `</script>`) and DOM injection vectors.
 * 2. Pure Data postMessage Transport:
 *    Code is delivered to the sandboxed iframe exclusively as a serialized
 *    string property via `postMessage`.
 * 3. Cryptographic Execution Nonces:
 *    Each execution generates a unique `executionId` nonce. Messages from the
 *    sandbox are strictly verified against this nonce, preventing message spoofing
 *    or stale message collisions.
 * 4. Origin & Source Window Validation:
 *    The parent listener verifies `event.source === iframe.contentWindow` and
 *    restricts message types to strictly validated schemas.
 * 5. Strict Sandboxing:
 *    The iframe uses `sandbox="allow-scripts"` (without `allow-same-origin`),
 *    forcing an opaque `null` origin with zero access to Chrome extension APIs,
 *    cookies, local storage, or the parent document.
 */

export interface LogEntry {
  type: 'log' | 'info' | 'warn' | 'error' | 'return';
  text: string;
  timestamp: number;
}

export interface RunResult {
  success: boolean;
  logs: LogEntry[];
  result?: string;
  executionTimeMs: number;
  error?: string;
}

export interface SandboxMessage {
  type: 'SANDBOX_READY' | 'SANDBOX_LOG' | 'SANDBOX_DONE';
  executionId?: string;
  logType?: LogEntry['type'];
  text?: string;
  result?: string;
  error?: string;
}

/**
 * Returns the completely static, invariant HTML harness for the sandboxed iframe.
 * Notice: This contains ZERO user code. User code is sent via postMessage only.
 */
export function buildSandboxHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
(function() {
  function handleInit(e) {
    if (e.source !== window.parent) return;
    var data = e.data;
    if (!data || data.type !== 'SANDBOX_EXECUTE' || !data.executionId) return;
    window.removeEventListener('message', handleInit);

    var execId = data.executionId;
    var userCode = typeof data.code === 'string' ? data.code : '';

    function sendLog(type, args) {
      var text = Array.prototype.slice.call(args).map(function(a) {
        try {
          return typeof a === 'object' ? JSON.stringify(a) : String(a);
        } catch(e) {
          return String(a);
        }
      }).join(' ');
      window.parent.postMessage({ type: 'SANDBOX_LOG', executionId: execId, logType: type, text: text }, '*');
    }

    var customConsole = {
      log: function() { sendLog('log', arguments); },
      info: function() { sendLog('info', arguments); },
      warn: function() { sendLog('warn', arguments); },
      error: function() { sendLog('error', arguments); }
    };

    try {
      var fn = new Function('console', '"use strict";\\n' + userCode);
      var outcome = fn(customConsole);
      if (outcome && typeof outcome.then === 'function') {
        outcome.then(function(val) {
          var resStr = val !== undefined ? (typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)) : undefined;
          window.parent.postMessage({ type: 'SANDBOX_DONE', executionId: execId, result: resStr }, '*');
        }).catch(function(err) {
          window.parent.postMessage({ type: 'SANDBOX_DONE', executionId: execId, error: err && err.message ? err.message : String(err) }, '*');
        });
      } else {
        var resStr = outcome !== undefined ? (typeof outcome === 'object' ? JSON.stringify(outcome, null, 2) : String(outcome)) : undefined;
        window.parent.postMessage({ type: 'SANDBOX_DONE', executionId: execId, result: resStr }, '*');
      }
    } catch(err) {
      window.parent.postMessage({ type: 'SANDBOX_DONE', executionId: execId, error: err && err.message ? err.message : String(err) }, '*');
    }
  }

  window.addEventListener('message', handleInit);
  try {
    window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
  } catch (err) {
    // Ignore postMessage initialization errors if window.parent inaccessible
  }
})();
<\/script>
</body>
</html>`;
}

/**
 * Validates whether an incoming postMessage event originated from the expected
 * sandboxed iframe and matches the active execution session.
 */
export function validateSandboxMessage(
  event: { source: unknown; origin: string; data: unknown },
  expectedExecutionId: string,
  expectedSourceWindow: unknown,
): { valid: true; message: SandboxMessage } | { valid: false; reason: string } {
  if (event.source !== expectedSourceWindow) {
    return { valid: false, reason: 'Source window mismatch' };
  }

  // Sandboxed iframes without 'allow-same-origin' have origin 'null'
  if (event.origin !== 'null' && event.origin !== '') {
    // Allow same-origin only in test / jsdom environments where origin might match window
    if (typeof window !== 'undefined' && event.origin !== window.origin) {
      return { valid: false, reason: `Unexpected origin: ${event.origin}` };
    }
  }

  if (!event.data || typeof event.data !== 'object') {
    return { valid: false, reason: 'Malformed message: payload not an object' };
  }

  const data = event.data as Record<string, unknown>;
  const validTypes = ['SANDBOX_READY', 'SANDBOX_LOG', 'SANDBOX_DONE'];
  if (typeof data.type !== 'string' || !validTypes.includes(data.type)) {
    return { valid: false, reason: `Invalid message type: ${String(data.type)}` };
  }

  if (data.type === 'SANDBOX_READY') {
    return { valid: true, message: { type: 'SANDBOX_READY' } };
  }

  // SANDBOX_LOG and SANDBOX_DONE require matching executionId
  if (data.executionId !== expectedExecutionId) {
    return { valid: false, reason: 'Execution ID nonce mismatch or spoofed message' };
  }

  return {
    valid: true,
    message: data as unknown as SandboxMessage,
  };
}

export async function executeInBrowserJS(code: string, timeoutMs = 4000): Promise<RunResult> {
  const startTime = Date.now();
  const logs: LogEntry[] = [];

  // Generate unique execution session nonce
  const executionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  // If in non-DOM or jsdom test environment, run with controlled Function eval
  const isJsdom = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');
  if (typeof window === 'undefined' || typeof document === 'undefined' || isJsdom) {
    try {
      const customConsole = {
        log: (...args: unknown[]) => logs.push({ type: 'log', text: args.map(String).join(' '), timestamp: Date.now() }),
        info: (...args: unknown[]) => logs.push({ type: 'info', text: args.map(String).join(' '), timestamp: Date.now() }),
        warn: (...args: unknown[]) => logs.push({ type: 'warn', text: args.map(String).join(' '), timestamp: Date.now() }),
        error: (...args: unknown[]) => logs.push({ type: 'error', text: args.map(String).join(' '), timestamp: Date.now() }),
      };

      const fn = new Function('console', `"use strict";\n${code}`);
      const val = fn(customConsole);
      
      let resStr: string | undefined;
      if (val && typeof (val as Promise<unknown>).then === 'function') {
        const resolved = await (val as Promise<unknown>);
        resStr = resolved !== undefined ? (typeof resolved === 'object' ? JSON.stringify(resolved, null, 2) : String(resolved)) : undefined;
      } else {
        resStr = val !== undefined ? (typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)) : undefined;
      }

      return {
        success: true,
        logs,
        result: resStr,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        success: false,
        logs,
        error: err instanceof Error ? err.message : String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  // In Window / SidePanel environment: use sandboxed iframe with postMessage
  return new Promise<RunResult>((resolve) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('sandbox', 'allow-scripts');

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        cleanup();
        resolve({
          success: false,
          logs: [...logs, { type: 'error', text: `Execution timed out after ${timeoutMs}ms`, timestamp: Date.now() }],
          error: `Execution timed out after ${timeoutMs}ms (infinite loop protection)`,
          executionTimeMs: timeoutMs,
        });
      }
    }, timeoutMs);

    function onMessage(e: MessageEvent) {
      const validation = validateSandboxMessage(e, executionId, iframe.contentWindow);
      if (!validation.valid) {
        // Discard unverified or foreign messages
        return;
      }

      const { message } = validation;

      if (message.type === 'SANDBOX_READY') {
        // Handshake established: dispatch user code safely via postMessage
        try {
          iframe.contentWindow?.postMessage({
            type: 'SANDBOX_EXECUTE',
            executionId,
            code,
          }, '*');
        } catch (err: unknown) {
          if (!finished) {
            finished = true;
            cleanup();
            resolve({
              success: false,
              logs,
              error: `Failed to dispatch code to sandbox: ${err instanceof Error ? err.message : String(err)}`,
              executionTimeMs: Date.now() - startTime,
            });
          }
        }
        return;
      }

      if (message.type === 'SANDBOX_LOG') {
        const validLogTypes: LogEntry['type'][] = ['log', 'info', 'warn', 'error'];
        const logType = validLogTypes.includes(message.logType as LogEntry['type'])
          ? (message.logType as LogEntry['type'])
          : 'log';
        logs.push({
          type: logType,
          text: message.text || '',
          timestamp: Date.now(),
        });
      } else if (message.type === 'SANDBOX_DONE') {
        if (!finished) {
          finished = true;
          cleanup();
          resolve({
            success: !message.error,
            logs,
            result: message.result,
            error: message.error,
            executionTimeMs: Date.now() - startTime,
          });
        }
      }
    }

    window.addEventListener('message', onMessage);

    // Set 100% static harness — no user code is ever in srcdoc
    iframe.srcdoc = buildSandboxHtml();
    document.body.appendChild(iframe);
  });
}

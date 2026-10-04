/**
 * Safe In-Browser Sandboxed Code Runner
 * Executes JavaScript snippets safely in an isolated iframe sandbox with
 * console interception, execution timeout guard, and structured return values.
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

export async function executeInBrowserJS(code: string, timeoutMs = 4000): Promise<RunResult> {
  const startTime = Date.now();
  const logs: LogEntry[] = [];

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
      const resStr = val !== undefined ? (typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)) : undefined;

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

  // In Window / SidePanel environment: use sandboxed iframe
  return new Promise<RunResult>((resolve) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('sandbox', 'allow-scripts');

    const cleanup = () => {
      clearTimeout(timer);
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

    window.addEventListener('message', function onMessage(e) {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data as { type?: string; logType?: string; text?: string; result?: string; error?: string };

      if (data.type === 'SANDBOX_LOG') {
        logs.push({
          type: (data.logType as LogEntry['type']) || 'log',
          text: data.text || '',
          timestamp: Date.now(),
        });
      } else if (data.type === 'SANDBOX_DONE') {
        if (!finished) {
          finished = true;
          window.removeEventListener('message', onMessage);
          cleanup();
          resolve({
            success: !data.error,
            logs,
            result: data.result,
            error: data.error,
            executionTimeMs: Date.now() - startTime,
          });
        }
      }
    });

    const scriptSrc = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body>
      <script>
        (function() {
          function sendLog(type, args) {
            var text = Array.prototype.slice.call(args).map(function(a) {
              try {
                return typeof a === 'object' ? JSON.stringify(a) : String(a);
              } catch(e) {
                return String(a);
              }
            }).join(' ');
            window.parent.postMessage({ type: 'SANDBOX_LOG', logType: type, text: text }, '*');
          }

          console.log = function() { sendLog('log', arguments); };
          console.info = function() { sendLog('info', arguments); };
          console.warn = function() { sendLog('warn', arguments); };
          console.error = function() { sendLog('error', arguments); };

          try {
            var result = (function() {
              ${code}
            })();
            var resultStr = result !== undefined ? (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)) : undefined;
            window.parent.postMessage({ type: 'SANDBOX_DONE', result: resultStr }, '*');
          } catch(err) {
            window.parent.postMessage({ type: 'SANDBOX_DONE', error: err.message || String(err) }, '*');
          }
        })();
      </script>
      </body>
      </html>
    `;

    document.body.appendChild(iframe);
    iframe.srcdoc = scriptSrc;
  });
}

export type StateTarget = 'next_data' | 'json_ld' | 'nuxt_state' | 'open_graph' | 'custom';

export interface StateInspectorOptions {
  target: StateTarget;
  customPath?: string;
}

export interface StateInspectorResult {
  success: boolean;
  target: StateTarget;
  source: string;
  data: unknown;
  itemCount?: number;
  error?: string;
}

/**
 * Execute safe state inspection inside the tab context.
 */
export async function inspectPageState(
  tabId: number,
  target: StateTarget,
  customPath?: string,
): Promise<StateInspectorResult> {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN', // Execute in MAIN world to access window variables
    func: (tgt: StateTarget, path?: string): StateInspectorResult => {
      try {
        if (tgt === 'next_data') {
          // 1. Check window.__NEXT_DATA__
          const win = window as unknown as Record<string, unknown>;
          if (win.__NEXT_DATA__) {
            const nd = win.__NEXT_DATA__ as { props?: { pageProps?: unknown }; query?: unknown };
            return {
              success: true,
              target: tgt,
              source: 'window.__NEXT_DATA__',
              data: nd.props?.pageProps || nd.props || nd,
            };
          }

          // 2. Fallback to <script id="__NEXT_DATA__"> DOM element
          const scriptEl = document.getElementById('__NEXT_DATA__');
          if (scriptEl?.textContent) {
            try {
              const parsed = JSON.parse(scriptEl.textContent);
              return {
                success: true,
                target: tgt,
                source: '<script id="__NEXT_DATA__">',
                data: parsed.props?.pageProps || parsed.props || parsed,
              };
            } catch { /* ignore */ }
          }

          return {
            success: false,
            target: tgt,
            source: 'next_data',
            data: null,
            error: 'No Next.js __NEXT_DATA__ found on this page.',
          };
        }

        if (tgt === 'json_ld') {
          const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
          if (scripts.length === 0) {
            return {
              success: false,
              target: tgt,
              source: 'json_ld',
              data: null,
              error: 'No <script type="application/ld+json"> schema markup found on this page.',
            };
          }

          const schemas: unknown[] = [];
          for (const s of scripts) {
            if (!s.textContent) continue;
            try {
              const parsed = JSON.parse(s.textContent);
              if (Array.isArray(parsed)) {
                schemas.push(...parsed);
              } else {
                schemas.push(parsed);
              }
            } catch { /* skip malformed JSON-LD */ }
          }

          return {
            success: schemas.length > 0,
            target: tgt,
            source: `${schemas.length} JSON-LD schemas`,
            itemCount: schemas.length,
            data: schemas.length === 1 ? schemas[0] : schemas,
          };
        }

        if (tgt === 'nuxt_state') {
          const win = window as unknown as Record<string, unknown>;
          const nuxtData = win.__NUXT__ || win.__INITIAL_STATE__ || win.__STATE__;
          if (nuxtData) {
            return {
              success: true,
              target: tgt,
              source: 'Nuxt/Vue State',
              data: nuxtData,
            };
          }
          return {
            success: false,
            target: tgt,
            source: 'nuxt_state',
            data: null,
            error: 'No Nuxt / Vue initial state found on this page.',
          };
        }

        if (tgt === 'open_graph') {
          const metaMap: Record<string, string> = {};
          const metaTags = document.querySelectorAll('meta[property], meta[name]');
          metaTags.forEach((m) => {
            const prop = m.getAttribute('property') || m.getAttribute('name');
            const content = m.getAttribute('content');
            if (prop && content && (prop.startsWith('og:') || prop.startsWith('twitter:') || prop === 'description' || prop === 'keywords')) {
              metaMap[prop] = content;
            }
          });

          return {
            success: Object.keys(metaMap).length > 0,
            target: tgt,
            source: 'OpenGraph & Meta Tags',
            itemCount: Object.keys(metaMap).length,
            data: metaMap,
          };
        }

        if (tgt === 'custom' && path) {
          const win = window as unknown as Record<string, unknown>;
          const cleanPath = path.replace(/^window\./, '');
          const parts = cleanPath.split('.').filter(Boolean);
          let current: unknown = win;

          for (const part of parts) {
            if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
              current = (current as Record<string, unknown>)[part];
            } else {
              return {
                success: false,
                target: tgt,
                source: path,
                data: null,
                error: `Property path "${path}" was not found or is undefined.`,
              };
            }
          }

          return {
            success: true,
            target: tgt,
            source: path,
            data: current,
          };
        }

        return {
          success: false,
          target: tgt,
          source: 'unknown',
          data: null,
          error: `Unsupported state target: ${tgt}`,
        };
      } catch (err: unknown) {
        return {
          success: false,
          target: tgt,
          source: 'execution_error',
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    args: [target, customPath],
  });

  return (
    injectionResults[0]?.result ?? {
      success: false,
      target,
      source: 'scripting_error',
      data: null,
      error: 'Script injection returned no result.',
    }
  );
}

/**
 * Format inspected state for the agent transcript (budget-capped at 8,000 chars).
 */
export function formatInspectedState(result: StateInspectorResult): string {
  if (!result.success) {
    return `PAGE SCRIPT INSPECTOR: ${result.error || `No ${result.target} data available.`}`;
  }

  let formatted = '';
  try {
    formatted = JSON.stringify(result.data, null, 2);
  } catch {
    formatted = String(result.data);
  }

  if (formatted.length > 8000) {
    formatted = `${formatted.slice(0, 8000)}\n\n[... truncated ${formatted.length - 8000} characters ...]`;
  }

  return `PAGE SCRIPT INSPECTION (${result.source}):\n\`\`\`json\n${formatted}\n\`\`\``;
}

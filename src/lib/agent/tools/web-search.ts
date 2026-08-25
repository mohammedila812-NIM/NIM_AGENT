import { wrapUntrustedContent } from '../prompts';

export interface SearchConfig {
  provider: 'brave' | 'serper' | 'duckduckgo';
  apiKey?: string;
  maxResults?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s+prompt/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /forget\s+(all\s+)?previous\s+rules/i,
  /exfiltrat/i,
];

/** Sanitizes a search snippet to neutralize prompt injection vectors. */
function sanitizeSearchSnippet(snippet: string): string {
  let cleaned = snippet;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '[REDACTED_POTENTIAL_INJECTION]');
    }
  }
  return cleaned;
}

export async function webSearch(
  query: string,
  config?: SearchConfig,
): Promise<string> {
  const max = config?.maxResults ?? 5;
  let results: SearchResult[] = [];

  if (config?.provider === 'brave' && config.apiKey) {
    try {
      results = await searchBrave(query, config.apiKey, max);
    } catch {
      results = await searchDuckDuckGo(query, max);
    }
  } else if (config?.provider === 'serper' && config.apiKey) {
    try {
      results = await searchSerper(query, config.apiKey, max);
    } catch {
      results = await searchDuckDuckGo(query, max);
    }
  } else {
    // Zero-config fallback: DuckDuckGo DOMParser HTML & Instant Answers API
    results = await searchDuckDuckGo(query, max);
  }

  if (results.length === 0) {
    return `No search results found for query: "${query}".`;
  }

  const formatted = results
    .map((r, i) => {
      const cleanSnippet = sanitizeSearchSnippet(r.snippet);
      return `[${i + 1}] ${r.title}\nURL: ${r.url}\n${cleanSnippet}`;
    })
    .join('\n\n');

  return wrapUntrustedContent(formatted, `web-search:${query}`);
}

async function searchBrave(query: string, apiKey: string, max: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  });
  if (!res.ok) throw new Error(`Brave Search error (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

async function searchSerper(query: string, apiKey: string, max: number): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: max }),
  });
  if (!res.ok) throw new Error(`Serper error (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { organic?: Array<{ title: string; link: string; snippet: string }> };
  return (data.organic ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

async function searchDuckDuckGo(query: string, max: number): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (res.ok) {
      const html = await res.text();
      const results: SearchResult[] = [];

      // Prefer DOMParser if available in browser context
      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const bodies = doc.querySelectorAll('.result__body');

        for (let i = 0; i < Math.min(bodies.length, max); i++) {
          const body = bodies[i];
          const linkEl = body.querySelector<HTMLAnchorElement>('a.result__a');
          const snippetEl = body.querySelector<HTMLElement>('.result__snippet');

          if (linkEl) {
            let rawUrl = linkEl.getAttribute('href') || linkEl.href || '';
            const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
            if (uddgMatch) {
              rawUrl = decodeURIComponent(uddgMatch[1]);
            }
            const title = linkEl.textContent?.trim() || '';
            const snippet = snippetEl?.textContent?.trim() || '';
            if (title && rawUrl) {
              results.push({ title, url: rawUrl, snippet });
            }
          }
        }
      }

      // Regex fallback if DOMParser returned empty or wasn't available
      if (results.length === 0) {
        const matches = Array.from(
          html.matchAll(
            /<div class="result__body">[\s\S]*?<h2 class="result__title">[\s\S]*?<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi,
          ),
        );

        for (const match of matches.slice(0, max)) {
          let rawUrl = match[1] || '';
          const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            rawUrl = decodeURIComponent(uddgMatch[1]);
          }
          const title = (match[2] || '').replace(/<[^>]+>/g, '').trim();
          const snippet = (match[3] || '').replace(/<[^>]+>/g, '').trim();
          if (title && rawUrl) {
            results.push({ title, url: rawUrl, snippet });
          }
        }
      }

      if (results.length > 0) {
        return results;
      }
    }

    // Secondary fallback to DuckDuckGo Instant Answer API
    const apiRes = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    );
    if (!apiRes.ok) return [];

    const apiData = (await apiRes.json()) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const out: SearchResult[] = [];
    if (apiData.Heading && apiData.AbstractText) {
      out.push({ title: apiData.Heading, url: apiData.AbstractURL || '', snippet: apiData.AbstractText });
    }
    if (apiData.RelatedTopics) {
      for (const topic of apiData.RelatedTopics.slice(0, max - out.length)) {
        if (topic.Text && topic.FirstURL) {
          out.push({ title: topic.Text.slice(0, 60), url: topic.FirstURL, snippet: topic.Text });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

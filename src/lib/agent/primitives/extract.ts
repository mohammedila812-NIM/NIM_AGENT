/**
 * Extract Primitive (Stagehand / Browser-Use Pattern)
 * Extracts structured entities and tables from web pages matching target schemas.
 */

export interface ExtractSchemaOptions {
  fields: string[]; // e.g. ["title", "price", "rating", "url"]
  containerSelector?: string; // e.g. ".product-card", "table", "article"
  maxItems?: number;
}

export interface ExtractedDataResult {
  records: Array<Record<string, string>>;
  csv: string;
  totalFound: number;
}

/**
 * Extracts structured records from the page matching the requested fields.
 */
export async function extractStructuredData(
  tabId: number,
  options: ExtractSchemaOptions,
): Promise<ExtractedDataResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fields: string[], containerSel?: string, maxItemsArg?: number | string | string[]) => {
      const maxItems = typeof maxItemsArg === 'number' ? maxItemsArg : 25;
      const records: Array<Record<string, string>> = [];

      // If a container selector is provided (e.g. repeated cards / rows)
      if (containerSel) {
        const containers = Array.from(document.querySelectorAll(containerSel)).slice(0, maxItems);
        for (const container of containers) {
          const row: Record<string, string> = {};
          for (const field of fields) {
            const lowerField = field.toLowerCase();
            // Try selector with field name, class, or attribute
            const match = container.querySelector(
              `.${lowerField}, [data-${lowerField}], [itemprop="${lowerField}"], [aria-label*="${lowerField}" i]`,
            );
            if (match) {
              row[field] = (match.textContent || '').trim();
            } else {
              // Heuristic: search descendant text or links
              if (lowerField === 'url' || lowerField === 'link') {
                const a = container.querySelector<HTMLAnchorElement>('a[href]');
                row[field] = a ? a.href : '';
              } else if (lowerField === 'price') {
                const priceMatch = (container.textContent || '').match(/[\$\€\£\₹]\s?\d+(?:[.,]\d+)?/);
                row[field] = priceMatch ? priceMatch[0] : '';
              } else {
                row[field] = '';
              }
            }
          }
          if (Object.values(row).some(v => v.length > 0)) {
            records.push(row);
          }
        }
      }

      // Fallback: If no container selector or none matched, check for standard tables
      if (records.length === 0) {
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('th')).map(th => (th.textContent || '').trim());
          const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter(r => !r.querySelector('th'));
          for (const tr of rows.slice(0, maxItems)) {
            const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
            if (cells.length > 0) {
              const row: Record<string, string> = {};
              fields.forEach((f, idx) => {
                row[f] = cells[idx] || (headers[idx] ? `${headers[idx]}: ${cells[idx] || ''}` : '');
              });
              records.push(row);
            }
          }
        }
      }

      return records;
    },
    args: [options.fields, options.containerSelector, options.maxItems ?? 25],
  });

  const rawRecords = results[0]?.result ?? [];

  // Convert to CSV
  const headers = options.fields;
  const csvLines: string[] = [headers.join(',')];
  for (const r of rawRecords) {
    const rowValues = headers.map(h => {
      const val = (r[h] || '').replace(/"/g, '""');
      return `"${val}"`;
    });
    csvLines.push(rowValues.join(','));
  }

  return {
    records: rawRecords,
    csv: csvLines.join('\n'),
    totalFound: rawRecords.length,
  };
}

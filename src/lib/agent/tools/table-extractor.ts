/**
 * Structured Data & Table Extraction tool for NIM Agent.
 * Parses HTML tables and repeated card/grid items into structured tabular data / CSV format.
 */

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  csv: string;
  rowCount: number;
}

export async function extractTableFromPage(tabId: number, selector?: string): Promise<ExtractedTable | { error: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (tableSelector?: string) => {
        // Find table or table-like elements
        const targetTable = tableSelector
          ? document.querySelector(tableSelector)
          : document.querySelector('table, [role="table"], .table, #table, tbody');

        if (!targetTable) {
          // Fallback: search for repetitive grid or list items
          const listItems = Array.from(document.querySelectorAll('ul > li, ol > li, [role="row"], .grid > div, .card'));
          if (listItems.length >= 3) {
            const rows = listItems.slice(0, 50).map((el, i) => [
              String(i + 1),
              (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            ]);
            return {
              headers: ['Index', 'Content'],
              rows,
            };
          }
          return null;
        }

        // Extract headers
        let headers: string[] = [];
        const headerEls = targetTable.querySelectorAll('th, [role="columnheader"]');
        if (headerEls.length > 0) {
          headers = Array.from(headerEls).map((th) => (th.textContent || '').trim());
        }

        // Extract rows
        const rowEls = targetTable.querySelectorAll('tr, [role="row"]');
        const rows: string[][] = [];

        rowEls.forEach((tr) => {
          const cells = tr.querySelectorAll('td, [role="cell"]');
          if (cells.length > 0) {
            const rowData = Array.from(cells).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());
            rows.push(rowData);
          }
        });

        // If no explicit <th>, use first row as headers if available
        if (headers.length === 0 && rows.length > 0) {
          headers = rows[0].map((_, i) => `Col_${i + 1}`);
        }

        return {
          headers,
          rows: rows.slice(0, 100), // Cap at 100 rows
        };
      },
      args: [selector],
    });

    const data = results[0]?.result;
    if (!data || data.rows.length === 0) {
      return { error: 'No table or structured list data found on page.' };
    }

    // Generate CSV string with proper escaping
    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const csvLines = [
      data.headers.map(escapeCsv).join(','),
      ...data.rows.map((row) => row.map(escapeCsv).join(',')),
    ];
    const csv = csvLines.join('\n');

    return {
      headers: data.headers,
      rows: data.rows,
      csv,
      rowCount: data.rows.length,
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

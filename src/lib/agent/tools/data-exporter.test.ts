import { describe, it, expect } from 'vitest';
import { sanitizeFilename, createDataUrl, formatExportResult, exportDataToFile } from './data-exporter';
import { validateToolCall } from './schemas';

describe('Data Exporter Tool', () => {
  it('sanitizes filename and enforces extension', () => {
    expect(sanitizeFilename('my/dirty\\table?name', 'csv')).toBe('my_dirty_table_name.csv');
    expect(sanitizeFilename('report.json', 'json')).toBe('report.json');
    expect(sanitizeFilename('prices', 'md')).toBe('prices.md');
  });

  it('creates valid Data URL with correct mime type and utf-8 encoding', () => {
    const csvContent = 'Product,Price\nLaptop,999';
    const dataUrl = createDataUrl(csvContent, 'csv');
    expect(dataUrl).toContain('data:text/csv;charset=utf-8,');
    expect(decodeURIComponent(dataUrl.split(',')[1])).toBe(csvContent);
  });

  it('validates export_data schema with Zod', () => {
    const valid = {
      tool: 'export_data',
      format: 'csv',
      filename: 'deals.csv',
      content: 'Item,Price\nGPU,500',
    };
    const res = validateToolCall(valid);
    expect(res.success).toBe(true);
  });

  it('executes exportDataToFile and formats readable result', async () => {
    const result = await exportDataToFile({
      format: 'json',
      filename: 'products.json',
      content: JSON.stringify([{ name: 'MacBook', price: 1299 }]),
    });
    expect(result.success).toBe(true);
    expect(result.filename).toBe('products.json');

    const formatted = formatExportResult(result);
    expect(formatted).toContain('FILE EXPORTED SUCCESSFULLY');
    expect(formatted).toContain('products.json');
  });
});

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './MarkdownMessage';

describe('MarkdownMessage Parser', () => {
  it('parses a standard pipe table into table segment with correct headers and rows', () => {
    const text = `| Name      | Price  | Rating |
|-----------|--------|--------|
| Acer      | $699   | 4.2    |
| Dell      | $849   | 4.5    |
| HP Victus | $749   | 4.0    |`;

    const segs = parseMarkdown(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('table');
    const table = segs[0] as Extract<typeof segs[0], { type: 'table' }>;

    // Headers
    expect(table.headers).toHaveLength(3);
    expect(table.headers[0]).toBe('Name');
    expect(table.headers[1]).toBe('Price');
    expect(table.headers[2]).toBe('Rating');

    // Rows — separator line must be excluded
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0][0]).toBe('Acer');
    expect(table.rows[1][1]).toBe('$849');
    expect(table.rows[2][2]).toBe('4.0');
  });

  it('parses fenced code blocks with optional language label', () => {
    const text = '```javascript\nconsole.log("hello");\n```';
    const segs = parseMarkdown(text);

    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('code_block');
    const block = segs[0] as Extract<typeof segs[0], { type: 'code_block' }>;
    expect(block.lang).toBe('javascript');
    expect(block.code).toContain('console.log');
  });

  it('parses headings at multiple levels', () => {
    const text = '## Top 5 Laptops\n### By Price';
    const segs = parseMarkdown(text);
    expect(segs[0].type).toBe('heading');
    const h2 = segs[0] as Extract<typeof segs[0], { type: 'heading' }>;
    expect(h2.level).toBe(2);
    expect(h2.text).toBe('Top 5 Laptops');
    expect(segs[1].type).toBe('heading');
  });

  it('parses unordered and ordered lists', () => {
    const unorderedText = '- Acer Nitro\n- Dell G15\n- HP Victus';
    const segsUl = parseMarkdown(unorderedText);
    expect(segsUl[0].type).toBe('list');
    const ul = segsUl[0] as Extract<typeof segsUl[0], { type: 'list' }>;
    expect(ul.ordered).toBe(false);
    expect(ul.items).toHaveLength(3);
    expect(ul.items[0]).toBe('Acer Nitro');

    const orderedText = '1. First item\n2. Second item';
    const segsOl = parseMarkdown(orderedText);
    const ol = segsOl[0] as Extract<typeof segsOl[0], { type: 'list' }>;
    expect(ol.ordered).toBe(true);
    expect(ol.items).toHaveLength(2);
  });

  it('parses mixed content: paragraph + table + paragraph', () => {
    const text = `Here are the results:

| Model | Price |
|-------|-------|
| A     | $500  |

Prices as of today.`;

    const segs = parseMarkdown(text);
    expect(segs.some((s) => s.type === 'paragraph')).toBe(true);
    expect(segs.some((s) => s.type === 'table')).toBe(true);
    expect(segs.length).toBeGreaterThanOrEqual(3);
  });

  it('falls back to paragraph for plain text with no markdown', () => {
    const text = 'This is a simple reply with no formatting.';
    const segs = parseMarkdown(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('paragraph');
  });
});

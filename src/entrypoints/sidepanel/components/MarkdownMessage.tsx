import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Segment =
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code_block'; lang: string; code: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; text: string };

// ── Inline formatting (bold, italic, code, links) ─────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Combined regex for **bold**, _italic_, `code`
  const re = /(\*\*(.+?)\*\*|_(.+?)_|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      // **bold**
      parts.push(<strong key={match.index} className="font-semibold text-slate-100">{match[2]}</strong>);
    } else if (match[3]) {
      // _italic_
      parts.push(<em key={match.index} className="italic text-slate-300">{match[3]}</em>);
    } else if (match[4]) {
      // `code`
      parts.push(
        <code key={match.index} className="px-1 py-0.5 rounded bg-slate-950/70 border border-slate-700/60 font-mono text-[11px] text-emerald-300">
          {match[4]}
        </code>
      );
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// ── Markdown parser ────────────────────────────────────────────────────────────

function isTableLine(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|');
}

function isSeparatorLine(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim().replace(/\s+/g, ''));
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMarkdown(text: string): Segment[] {
  const segments: Segment[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ─────────────────────────────
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      segments.push({ type: 'code_block', lang, code: codeLines.join('\n') });
      i++;
      continue;
    }

    // ── Heading ───────────────────────────────────────
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      segments.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // ── Table ─────────────────────────────────────────
    if (isTableLine(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse headers (first row), skip separator, then data rows
      const headers = parseTableRow(tableLines[0]);
      const dataRows = tableLines
        .slice(1)
        .filter((l) => !isSeparatorLine(l))
        .map(parseTableRow);

      segments.push({ type: 'table', headers, rows: dataRows });
      continue;
    }

    // ── List ──────────────────────────────────────────
    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)/);
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)/);
    if (ulMatch || olMatch) {
      const items: string[] = [];
      const ordered = !!olMatch;
      while (i < lines.length) {
        const ul = lines[i].match(/^[\s]*[-*]\s+(.+)/);
        const ol = lines[i].match(/^[\s]*\d+\.\s+(.+)/);
        if (ul) { items.push(ul[1]); i++; }
        else if (ol) { items.push(ol[1]); i++; }
        else break;
      }
      segments.push({ type: 'list', ordered, items });
      continue;
    }

    // ── Blank line ────────────────────────────────────
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Paragraph (accumulate until blank line or new block) ──
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !lines[i].match(/^#{1,4}\s/) &&
      !isTableLine(lines[i]) &&
      !lines[i].match(/^[\s]*[-*]\s+/) &&
      !lines[i].match(/^[\s]*\d+\.\s+/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      segments.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return segments;
}

// ── Renderer components ───────────────────────────────────────────────────────

const MarkdownTable: React.FC<{ headers: string[]; rows: string[][] }> = ({ headers, rows }) => (
  <div className="overflow-x-auto my-2 rounded-lg border border-slate-700/60 text-xs">
    <table className="w-full border-collapse table-auto">
      <thead>
        <tr className="bg-slate-800 border-b border-slate-700">
          {headers.map((h, idx) => (
            <th
              key={idx}
              className="px-2.5 py-2 text-left font-semibold text-slate-200 whitespace-nowrap"
            >
              {renderInline(h)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rIdx) => (
          <tr
            key={rIdx}
            className={`border-b border-slate-800/60 ${rIdx % 2 === 0 ? '' : 'bg-slate-800/30'}`}
          >
            {row.map((cell, cIdx) => (
              <td
                key={cIdx}
                className="px-2.5 py-1.5 text-slate-300 align-top break-words"
                style={{ minWidth: '60px', maxWidth: '200px' }}
              >
                {renderInline(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const MarkdownCodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => (
  <div className="my-2 rounded-lg overflow-hidden border border-slate-700/60">
    {lang && (
      <div className="px-3 py-1 bg-slate-800 border-b border-slate-700/60 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
        {lang}
      </div>
    )}
    <pre className="bg-slate-950/80 px-3 py-2.5 overflow-x-auto text-[11px] font-mono text-emerald-300 leading-relaxed whitespace-pre">
      <code>{code}</code>
    </pre>
  </div>
);

const MarkdownHeading: React.FC<{ level: number; text: string }> = ({ level, text }) => {
  const cls =
    level <= 2
      ? 'text-sm font-bold text-slate-100 mt-2 mb-1'
      : 'text-xs font-semibold text-slate-200 mt-1.5 mb-0.5 uppercase tracking-wide';
  return <div className={cls}>{renderInline(text)}</div>;
};

const MarkdownList: React.FC<{ ordered: boolean; items: string[] }> = ({ ordered, items }) => {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`my-1.5 pl-4 space-y-0.5 ${ordered ? 'list-decimal' : 'list-disc'} text-slate-300`}>
      {items.map((item, idx) => (
        <li key={idx} className="leading-relaxed">
          {renderInline(item)}
        </li>
      ))}
    </Tag>
  );
};

const MarkdownParagraph: React.FC<{ text: string }> = ({ text }) => (
  <p className="leading-relaxed text-slate-200 whitespace-pre-wrap my-0.5">
    {renderInline(text)}
  </p>
);

// ── Main export ───────────────────────────────────────────────────────────────

export const MarkdownMessage: React.FC<{ text: string }> = ({ text }) => {
  const segments = parseMarkdown(text);

  return (
    <div className="space-y-0.5 w-full overflow-hidden">
      {segments.map((seg, idx) => {
        switch (seg.type) {
          case 'table':
            return <MarkdownTable key={idx} headers={seg.headers} rows={seg.rows} />;
          case 'code_block':
            return <MarkdownCodeBlock key={idx} lang={seg.lang} code={seg.code} />;
          case 'heading':
            return <MarkdownHeading key={idx} level={seg.level} text={seg.text} />;
          case 'list':
            return <MarkdownList key={idx} ordered={seg.ordered} items={seg.items} />;
          case 'paragraph':
          default:
            return <MarkdownParagraph key={idx} text={seg.text} />;
        }
      })}
    </div>
  );
};

/** Page-context extraction — runs inside the tab via content script injection. */

export interface InteractiveElement {
  index: number;
  kind: string;
  label: string;
  name?: string;
  id?: string;
  required?: boolean;
  value?: string;
  checked?: boolean;
  options?: string[];
}

export interface PageState {
  title: string;
  url: string;
  lang: string;
  content: string;
  interactive: InteractiveElement[];
  links: Array<{ text: string; href: string }>;
}

const NOISE_SELECTORS = [
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]', '.cookie', '.gdpr', '.consent',
  '.ad', '.ads', '.advertisement', '.popup', '.modal-overlay',
  '#cookie-banner', '#consent', '.sidebar',
].join(',');

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'META', 'HEAD', 'SVG', 'CANVAS']);

const INTERACTIVE_QUERY = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="option"]',
  '[contenteditable="true"]',
  'summary',
].join(', ');

const MAX_INTERACTIVE = 80;
const CHAR_BUDGET = 5000;

function isVisible(el: Element): boolean {
  if (typeof (el as HTMLElement).checkVisibility === 'function') {
    return (el as HTMLElement).checkVisibility();
  }
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.05;
}

function getAssociatedLabel(el: Element): string {
  const id = el.getAttribute('id');
  if (id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (labelEl?.textContent) {
      return labelEl.textContent.replace(/\s+/g, ' ').trim();
    }
  }

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((lid) => document.getElementById(lid)?.textContent?.trim()).filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  const parentLabel = el.closest('label');
  if (parentLabel?.textContent) {
    return parentLabel.textContent.replace(/\s+/g, ' ').trim();
  }

  return '';
}

function buildElementLabel(el: Element): string {
  const inputEl = el as HTMLInputElement;
  const associated = getAssociatedLabel(el);
  const aria = el.getAttribute('aria-label') ?? '';
  const placeholder = inputEl.placeholder ?? '';
  const title = el.getAttribute('title') ?? '';
  const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const value = inputEl.value ?? '';

  return (associated || aria || placeholder || text || title || value).slice(0, 80);
}

function describeKind(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const inputEl = el as HTMLInputElement;
  const role = el.getAttribute('role');

  if (tag === 'a') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') return `input[${inputEl.type || 'text'}]`;
  if (role) return role;
  if ((el as HTMLElement).isContentEditable) return 'contenteditable';
  return tag;
}

/** Extract visible page text and indexed interactive elements (Set-of-Marks). */
export function extractPageState(focusSelector?: string): PageState {
  const noiseEls = new Set<Element>();
  try {
    document.querySelectorAll(NOISE_SELECTORS).forEach((e) => noiseEls.add(e));
  } catch {
    // ignore invalid selectors on exotic pages
  }

  function inNoise(el: Element): boolean {
    let cur: Element | null = el;
    while (cur) {
      if (noiseEls.has(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  const seen = new Set<string>();
  const lines: string[] = [];
  let charBudget = CHAR_BUDGET;

  const root =
    (focusSelector ? document.querySelector(focusSelector) : null) ??
    document.querySelector('main, article, [role="main"], #content, #main, .content, .main') ??
    document.body;

  const walker = document.createTreeWalker(root ?? document.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node && charBudget > 0) {
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag) || inNoise(node) || !isVisible(node)) {
      node = walker.nextNode() as Element | null;
      continue;
    }
    if (node.childElementCount === 0) {
      const t = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (t.length > 1 && !seen.has(t)) {
        seen.add(t);
        const prefix = /^H[1-6]$/.test(tag) ? '\n## ' : '';
        lines.push(`${prefix}${t}`);
        charBudget -= t.length;
      }
    }
    node = walker.nextNode() as Element | null;
  }

  // Clear stale markers before re-indexing
  document.querySelectorAll('[data-nim-id]').forEach((el) => el.removeAttribute('data-nim-id'));

  const interactive: InteractiveElement[] = [];
  const candidates = Array.from(document.querySelectorAll(INTERACTIVE_QUERY)).filter(isVisible);

  let idx = 1;
  for (const el of candidates) {
    if (idx > MAX_INTERACTIVE) break;
    if (inNoise(el)) continue;

    const label = buildElementLabel(el);
    if (!label && el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') continue;

    const inputEl = el as HTMLInputElement;
    const selectEl = el as HTMLSelectElement;
    const entry: InteractiveElement = {
      index: idx,
      kind: describeKind(el),
      label: label || `(element ${idx})`,
    };

    if (inputEl.name) entry.name = inputEl.name;
    if (inputEl.id) entry.id = inputEl.id;
    if (inputEl.required) entry.required = true;
    if (inputEl.type === 'checkbox' || inputEl.type === 'radio') {
      entry.checked = inputEl.checked;
    } else if (inputEl.value && inputEl.type !== 'password') {
      entry.value = inputEl.value.slice(0, 40);
    }

    if (selectEl.options?.length) {
      entry.options = Array.from(selectEl.options)
        .slice(0, 12)
        .map((o) => o.text.trim())
        .filter(Boolean);
      entry.value = selectEl.value;
    }

    el.setAttribute('data-nim-id', String(idx));
    interactive.push(entry);
    idx++;
  }

  const links = Array.from(document.querySelectorAll('a[href]'))
    .filter((a) => isVisible(a) && !inNoise(a))
    .slice(0, 15)
    .map((a) => ({
      text: a.textContent?.trim().slice(0, 50) || '',
      href: (a as HTMLAnchorElement).href,
    }));

  return {
    title: document.title,
    url: window.location.href,
    lang: document.documentElement.lang || 'en',
    content: lines.join('\n'),
    interactive,
    links,
  };
}

/** Format extracted page state for the LLM. */
export function formatPageState(page: PageState): string {
  const interactiveLines = page.interactive
    .map((e) => {
      const parts = [`[${e.index}] ${e.kind} "${e.label}"`];
      if (e.name) parts.push(`name="${e.name}"`);
      if (e.id) parts.push(`id="${e.id}"`);
      if (e.required) parts.push('required');
      if (e.checked !== undefined) parts.push(`checked=${e.checked}`);
      if (e.value) parts.push(`value="${e.value}"`);
      if (e.options?.length) parts.push(`options=[${e.options.join(', ')}]`);
      return `  ${parts.join(' ')}`;
    })
    .join('\n');

  const linkLines = page.links
    .filter((l) => l.text)
    .map((l) => `  - "${l.text}" → ${l.href}`)
    .join('\n');

  return [
    `PAGE: ${page.title} | ${page.url}`,
    `LANG: ${page.lang}`,
    `─────────────────────────────────`,
    `CONTENT:`,
    page.content.trim() || '(no main text found)',
    `─────────────────────────────────`,
    `INTERACTIVE ELEMENTS (${page.interactive.length}) — use numeric ID as target, e.g. "3":`,
    interactiveLines || '  (none)',
    `─────────────────────────────────`,
    `LINKS (${page.links.length}):`,
    linkLines || '  (none)',
  ].join('\n');
}

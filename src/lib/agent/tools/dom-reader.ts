/**
 * View-aware DOM text extraction.
 * Strips all content that is hidden from human users — CSS stealth, Unicode smuggling, HTML comments.
 */

export function sanitizeUnicode(text: string): string {
  return text
    .replace(/[\u{E0000}-\u{E007F}]/gu, '') // Unicode Tag block (steganography)
    .replace(/[\uDB40][\uDC00-\uDC7F]/g, '') // Surrogate representation of Tag block
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // Zero-width characters
    .replace(/<!--[\s\S]*?-->/g, '') // Residual HTML comments
    .replace(/\s+/g, ' ') // Normalize all whitespace
    .trim();
}

export function extractVisibleText(root: Element = document.body): string {
  if (!root) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const texts: string[] = [];

  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'meta', 'head', 'svg', 'iframe']);

  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName?.toLowerCase();
    if (SKIP_TAGS.has(tag)) {
      node = walker.nextNode() as Element | null;
      continue;
    }

    // Use native visibility check if available (Chrome 105+)
    if (typeof node.checkVisibility === 'function') {
      if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        node = walker.nextNode() as Element | null;
        continue;
      }
    }

    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(node);
      const hidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity) < 0.01 ||
        parseFloat(style.fontSize) < 2 ||
        (style.position === 'absolute' &&
          (parseInt(style.left, 10) < -400 || parseInt(style.top, 10) < -400));

      if (hidden) {
        node = walker.nextNode() as Element | null;
        continue;
      }
    }

    // Only collect leaf text nodes
    if (node.childElementCount === 0) {
      const text = node.textContent?.trim();
      if (text) texts.push(text);
    }

    node = walker.nextNode() as Element | null;
  }

  return sanitizeUnicode(texts.join('\n'));
}

/** Extract all visible links. */
export function extractVisibleLinks(): Array<{ text: string; href: string }> {
  if (typeof document === 'undefined') return [];
  const links: Array<{ text: string; href: string }> = [];
  document.querySelectorAll('a[href]').forEach((a) => {
    const el = a as HTMLAnchorElement;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return;
    const text = el.textContent?.trim();
    if (text && el.href && !el.href.startsWith('javascript:')) {
      links.push({ text, href: el.href });
    }
  });
  return links;
}

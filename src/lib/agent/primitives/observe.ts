/**
 * Observe Primitive (Stagehand / Browser-Use Pattern)
 * Scans the active page and produces structured affordance maps
 * (actions, inputs, options) with shadow DOM piercing.
 */

import { waitForPageSettled } from './settle-gate';

export interface ActionAffordance {
  id: number;
  kind: 'button' | 'link' | 'tab' | 'menuitem' | 'action';
  label: string;
  frame?: string;
}

export interface InputAffordance {
  id: number;
  type: string;
  name: string;
  label: string;
  placeholder?: string;
  currentValue?: string;
  required?: boolean;
}

export interface OptionAffordance {
  id: number;
  kind: 'select' | 'checkbox' | 'radio';
  label: string;
  checked?: boolean;
  choices?: string[];
}

export interface PageAffordances {
  title: string;
  url: string;
  actions: ActionAffordance[];
  inputs: InputAffordance[];
  options: OptionAffordance[];
  totalAffordances: number;
}

/**
 * Discovers and returns page affordances using shadow-piercing extraction.
 */
export async function observePage(tabId: number, maxAffordances = 75): Promise<PageAffordances> {
  await waitForPageSettled(tabId, { maxWaitMs: 800, idleThresholdMs: 200 });

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (limit: number) => {
      // 1. Recursive walker for Shadow DOM and same-origin iframes
      function deepCollect(root: Document | ShadowRoot | Element): Element[] {
        const out: Element[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode() as Element | null;
        while (node) {
          out.push(node);
          if (node.shadowRoot) {
            out.push(...deepCollect(node.shadowRoot));
          }
          if (node instanceof HTMLIFrameElement) {
            try {
              if (node.contentDocument) {
                out.push(...deepCollect(node.contentDocument));
              }
            } catch {
              // Cross-origin iframe
            }
          }
          node = walker.nextNode() as Element | null;
        }
        return out;
      }

      function isVisible(el: Element): boolean {
        if (typeof (el as HTMLElement).checkVisibility === 'function') {
          return (el as HTMLElement).checkVisibility();
        }
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.01;
      }

      const allElements = deepCollect(document);
      const interactiveQuery = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"]';
      
      const candidates: HTMLElement[] = [];
      for (const el of allElements) {
        if (el.matches && el.matches(interactiveQuery) && isVisible(el)) {
          candidates.push(el as HTMLElement);
        }
      }

      // Salience Ranking (Two-Stage Mind2Act):
      // Prioritize active inputs, search controls, and primary buttons over passive links
      function getSalience(el: HTMLElement): number {
        let score = 0;
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        const type = (el as HTMLInputElement).type?.toLowerCase() || '';

        // 1. Text Inputs & Search Fields (Highest priority for goal completion)
        if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'button', 'submit'].includes(type))) {
          score += 100;
          if (type === 'search' || /search|query|find|msg|message|chat/i.test((el as HTMLInputElement).name || el.id || el.getAttribute('placeholder') || '')) {
            score += 30;
          }
        }
        // 2. Selects, Checkboxes, Radios
        else if (tag === 'select' || type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'radio') {
          score += 85;
        }
        // 3. Action Buttons & Submit controls
        else if (tag === 'button' || role === 'button' || type === 'submit') {
          score += 70;
          const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
          if (/search|submit|login|sign in|send|direct|message|chat|next|play|confirm|buy|add/i.test(label)) {
            score += 25;
          }
        }
        // 4. Navigation tabs & menu items
        else if (role === 'tab' || role === 'menuitem') {
          score += 55;
        }
        // 5. Links
        else {
          score += 35;
          const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
          const href = (el as HTMLAnchorElement).href || '';
          if (/direct|message|chat|inbox|reels|profile|login|sign/i.test(label) || /direct|inbox|reels/i.test(href)) {
            score += 30;
          }
        }

        // Viewport boost: elements within current viewport receive +40
        try {
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0 && rect.width > 0 && rect.height > 0) {
            score += 40;
          }
        } catch { /* ignore */ }

        return score;
      }

      // Clear previous data-nim-id before tagging (Finding 21)
      try {
        document.querySelectorAll('[data-nim-id]').forEach((el) => el.removeAttribute('data-nim-id'));
      } catch { /* ignore */ }

      candidates.sort((a, b) => getSalience(b) - getSalience(a));

      let idCounter = 1;
      const actions: ActionAffordance[] = [];
      const inputs: InputAffordance[] = [];
      const options: OptionAffordance[] = [];

      for (const el of candidates.slice(0, limit)) {
        const id = idCounter++;
        el.setAttribute('data-nim-id', String(id));

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';

        // Semantic label resolution
        let label = el.getAttribute('aria-label') || '';
        if (!label && (el as HTMLInputElement).placeholder) {
          label = (el as HTMLInputElement).placeholder;
        }
        if (!label) {
          const parentLabel = el.closest('label');
          if (parentLabel) label = parentLabel.textContent?.trim() || '';
        }
        if (!label) {
          label = el.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('title') || '';
        }
        label = label.slice(0, 50);

        // Inputs
        if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type))) {
          const inputEl = el as HTMLInputElement;
          inputs.push({
            id,
            type: inputEl.type || 'text',
            name: inputEl.name || '',
            label: label || inputEl.name || 'input',
            placeholder: inputEl.placeholder || undefined,
            currentValue: inputEl.value ? inputEl.value.slice(0, 30) : undefined,
            required: inputEl.required || undefined,
          });
        }
        // Options (select, checkbox, radio)
        else if (tag === 'select' || (tag === 'input' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) || ['checkbox', 'radio'].includes(role)) {
          const inputEl = el as HTMLInputElement;
          if (tag === 'select') {
            const sel = el as HTMLSelectElement;
            const choices = Array.from(sel.options).map(o => o.text.trim()).filter(Boolean).slice(0, 6);
            options.push({
              id,
              kind: 'select',
              label: label || 'Dropdown',
              choices,
            });
          } else {
            options.push({
              id,
              kind: (inputEl.type === 'radio' || role === 'radio') ? 'radio' : 'checkbox',
              label: label || (inputEl.type === 'radio' ? 'Radio option' : 'Checkbox'),
              checked: inputEl.checked,
            });
          }
        }
        // Actions (buttons, links, clickable roles)
        else {
          const kind = tag === 'a' ? 'link' : role === 'tab' ? 'tab' : role === 'menuitem' ? 'menuitem' : 'button';
          actions.push({
            id,
            kind,
            label: label || (tag === 'a' ? (el as HTMLAnchorElement).href : 'Action'),
          });
        }
      }

      return {
        title: document.title,
        url: window.location.href,
        actions,
        inputs,
        options,
        totalAffordances: idCounter - 1,
      };
    },
    args: [maxAffordances],
  });

  return results[0]?.result ?? {
    title: '',
    url: '',
    actions: [],
    inputs: [],
    options: [],
    totalAffordances: 0,
  };
}

/** Formats PageAffordances into a token-efficient, human/LLM-readable summary string. */
export function formatAffordances(affordances: PageAffordances): string {
  const lines: string[] = [
    `OBSERVED PAGE: "${affordances.title}" | ${affordances.url}`,
    `Total Interactive Controls: ${affordances.totalAffordances}`,
    '',
  ];

  if (affordances.actions.length > 0) {
    lines.push(`🔘 ACTIONS (${affordances.actions.length}):`);
    for (const a of affordances.actions) {
      lines.push(`  [${a.id}] ${a.kind.toUpperCase()}: "${a.label}"`);
    }
    lines.push('');
  }

  if (affordances.inputs.length > 0) {
    lines.push(`📝 INPUT FIELDS (${affordances.inputs.length}):`);
    for (const inp of affordances.inputs) {
      const valStr = inp.currentValue ? ` (current="${inp.currentValue}")` : '';
      const reqStr = inp.required ? ' [REQUIRED]' : '';
      lines.push(`  [${inp.id}] ${inp.type}: "${inp.label}"${valStr}${reqStr}`);
    }
    lines.push('');
  }

  if (affordances.options.length > 0) {
    lines.push(`☑️ OPTIONS & SELECTS (${affordances.options.length}):`);
    for (const opt of affordances.options) {
      if (opt.kind === 'select') {
        const choicesStr = opt.choices ? ` options=[${opt.choices.map(c => `"${c}"`).join(', ')}]` : '';
        lines.push(`  [${opt.id}] SELECT: "${opt.label}"${choicesStr}`);
      } else {
        const stateStr = opt.checked ? ' (CHECKED)' : ' (UNCHECKED)';
        lines.push(`  [${opt.id}] ${opt.kind.toUpperCase()}: "${opt.label}"${stateStr}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats PageAffordances into an ultra-compact Semantic AXTree syntax (saving ~70% tokens).
 * Prioritizes high-salience controls directly for Small Language Models (SLMs).
 */
export function formatCompactAXTree(affordances: PageAffordances): string {
  const lines: string[] = [
    `[PAGE AXTree: "${affordances.title}"] (${affordances.totalAffordances} active controls):`,
  ];

  for (const inp of affordances.inputs) {
    const val = inp.currentValue ? ` val="${inp.currentValue}"` : '';
    const req = inp.required ? ' *req' : '';
    lines.push(`  [${inp.id}] input:${inp.type} "${inp.label}"${val}${req}`);
  }

  for (const opt of affordances.options) {
    if (opt.kind === 'select') {
      const choices = (opt.choices || []).slice(0, 4).map((c) => `"${c}"`).join(',');
      lines.push(`  [${opt.id}] select "${opt.label}" options=[${choices}]`);
    } else {
      lines.push(`  [${opt.id}] ${opt.kind} "${opt.label}" ${opt.checked ? '[x]' : '[ ]'}`);
    }
  }

  for (const a of affordances.actions) {
    lines.push(`  [${a.id}] ${a.kind} "${a.label}"`);
  }

  return lines.join('\n');
}

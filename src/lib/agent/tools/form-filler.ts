import { SENSITIVE_FIELD_PATTERNS } from '../security-patterns';

export interface FormFieldInput {
  target: string;
  value: string;
  type?: 'text' | 'select' | 'checkbox' | 'radio';
}

export interface FormFieldResult {
  target: string;
  status: 'filled' | 'failed' | 'skipped';
  label?: string;
  error?: string;
}

export interface BatchFormFillResult {
  success: boolean;
  filled: number;
  total: number;
  submitted?: boolean;
  results: FormFieldResult[];
  error?: string;
}

/**
 * Execute batch form filling on the active or background tab.
 */
export async function executeBatchFormFill(
  tabId: number,
  fields: FormFieldInput[],
  submitAfter = false,
  submitTarget?: string,
): Promise<BatchFormFillResult> {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      fieldList: FormFieldInput[],
      doSubmit: boolean,
      subTarget?: string,
      sensitivePatterns?: string[],
    ): BatchFormFillResult => {
      const sensitiveRegexes = (sensitivePatterns ?? []).map((p) => new RegExp(p, 'i'));

      function isSensitive(el: HTMLElement): boolean {
        const inputEl = el as HTMLInputElement;
        if (inputEl.type === 'password') return true;
        const searchIn = [
          inputEl.name,
          inputEl.id,
          inputEl.placeholder,
          inputEl.getAttribute('aria-label'),
          inputEl.getAttribute('autocomplete'),
        ].join(' ');
        return sensitiveRegexes.some((regex) => regex.test(searchIn));
      }

      function findTarget(targetStr: string): HTMLElement | null {
        const trimmed = targetStr.trim();
        const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
        if (numMatch) {
          const el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
          if (el) return el;
        }

        // Try standard ID / name / querySelector
        try {
          const el = document.getElementById(trimmed) || document.querySelector<HTMLElement>(trimmed);
          if (el) return el;
        } catch { /* ignore invalid selectors */ }

        try {
          const el = document.querySelector<HTMLElement>(`[name="${trimmed}"]`) ||
                     document.querySelector<HTMLElement>(`[placeholder="${trimmed}" i]`) ||
                     document.querySelector<HTMLElement>(`[aria-label="${trimmed}" i]`);
          if (el) return el;
        } catch { /* ignore */ }

        // Loose text matching over inputs and selects
        const allFormEls = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable="true"]'));
        const lower = trimmed.toLowerCase();
        return allFormEls.find((el) => {
          const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el as HTMLInputElement).name || el.id;
          return label && label.toLowerCase().includes(lower);
        }) ?? null;
      }

      function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
        const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, value);
        } else {
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      }

      const results: FormFieldResult[] = [];
      let filledCount = 0;

      for (const item of fieldList) {
        const el = findTarget(item.target);
        if (!el) {
          results.push({
            target: item.target,
            status: 'failed',
            error: `Element "${item.target}" not found on page`,
          });
          continue;
        }

        if (isSensitive(el)) {
          results.push({
            target: item.target,
            status: 'skipped',
            label: (el as HTMLInputElement).name || el.id || item.target,
            error: 'Sensitive field (password/payment) skipped for security',
          });
          continue;
        }

        try {
          el.focus();

          const label = (el as HTMLInputElement).name || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.id || item.target;

          if (el instanceof HTMLSelectElement) {
            // Select dropdown
            let matched = false;
            const lowerVal = item.value.toLowerCase();
            for (let i = 0; i < el.options.length; i++) {
              const opt = el.options[i];
              if (opt.value.toLowerCase() === lowerVal || opt.text.toLowerCase().includes(lowerVal)) {
                el.selectedIndex = i;
                matched = true;
                break;
              }
            }
            if (!matched && el.options.length > 0) {
              el.value = item.value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            results.push({ target: item.target, status: 'filled', label });
            filledCount++;
          } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
            // Checkbox / Radio
            const boolVal = /^(true|1|yes|on|checked)$/i.test(item.value);
            if (el.type === 'checkbox') {
              el.checked = boolVal;
            } else {
              el.checked = true;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            results.push({ target: item.target, status: 'filled', label });
            filledCount++;
          } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            // Text / Number / Email / Textarea
            setNativeValue(el, item.value);
            results.push({ target: item.target, status: 'filled', label });
            filledCount++;
          } else if (el.isContentEditable) {
            // Rich text contenteditable
            el.textContent = item.value;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: item.value }));
            results.push({ target: item.target, status: 'filled', label });
            filledCount++;
          } else {
            results.push({
              target: item.target,
              status: 'failed',
              error: `Element <${el.tagName.toLowerCase()}> is not a form input`,
            });
          }
          el.blur();
        } catch (err: unknown) {
          results.push({
            target: item.target,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Optional form submission
      let submitted = false;
      if (doSubmit && filledCount > 0) {
        let submitBtn: HTMLElement | null = null;
        if (subTarget) {
          submitBtn = findTarget(subTarget);
        }
        if (!submitBtn) {
          submitBtn = document.querySelector<HTMLElement>('button[type="submit"], input[type="submit"], button.submit, [role="button"][name*="submit" i]');
        }

        if (submitBtn) {
          submitBtn.click();
          submitted = true;
        } else {
          // Fallback to submitting enclosing form
          const firstFilled = findTarget(fieldList[0].target);
          const form = firstFilled?.closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            submitted = true;
          }
        }
      }

      return {
        success: filledCount > 0,
        filled: filledCount,
        total: fieldList.length,
        submitted,
        results,
      };
    },
    args: [
      fields,
      submitAfter,
      submitTarget,
      SENSITIVE_FIELD_PATTERNS.map((p) => p.source),
    ],
  });

  return (
    injectionResults[0]?.result ?? {
      success: false,
      filled: 0,
      total: fields.length,
      results: [],
      error: 'Script injection returned no result',
    }
  );
}

/**
 * Format the batch fill result into a clean markdown summary for the LLM.
 */
export function formatBatchFillResult(result: BatchFormFillResult): string {
  const lines: string[] = [
    `BATCH FORM FILL REPORT: ${result.filled}/${result.total} fields successfully populated.${result.submitted ? ' Form submission triggered.' : ''}`,
  ];

  for (const r of result.results) {
    const icon = r.status === 'filled' ? '✅' : r.status === 'skipped' ? '⚠️' : '❌';
    const labelPart = r.label ? ` (${r.label})` : '';
    const errPart = r.error ? ` — ${r.error}` : '';
    lines.push(`  ${icon} [${r.target}]${labelPart}: ${r.status}${errPart}`);
  }

  return lines.join('\n');
}

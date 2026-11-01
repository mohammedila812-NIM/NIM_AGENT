/**
 * Prompt-to-Playwright Code Generator (Phase 4 Developer Superpower)
 *
 * Converts autonomous agent interaction logs and ReAct action steps into
 * clean, reproducible, production-ready Playwright TypeScript and Python test scripts.
 */

import { vfs } from '../workspace/vfs';

export interface RecordedAction {
  action: {
    type: string;
    url?: string;
    target?: string;
    selector?: string;
    value?: string;
    option?: string;
    key?: string;
    direction?: 'up' | 'down';
    pixels?: number;
    state?: 'visible' | 'hidden' | 'attached' | 'detached';
    action?: string;
    submitWithEnter?: boolean;
    [key: string]: unknown;
  };
  timestamp?: number;
}

export interface PlaywrightGeneratorOptions {
  testName?: string;
  baseUrl?: string;
  format?: 'typescript' | 'python';
  headless?: boolean;
}

/** Converts an element target (ID, text label, or CSS selector) to a robust Playwright selector string. */
export function formatLocator(targetStr: string): string {
  const trimmed = (targetStr || '').trim();
  if (!trimmed) return 'body';

  // Numeric ID match (e.g., "[1]" or "id:1" or "1")
  const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
  if (numMatch) {
    return `[data-nim-id="${numMatch[1]}"]`;
  }

  // CSS selector with tag name, ID, class, or attribute (e.g. #login, .btn, [role="button"], button[type="submit"])
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('[') ||
    /^[a-zA-Z0-9_-]+(?:\[[^\]]+\]|\.[a-zA-Z0-9_-]+|\#[a-zA-Z0-9_-]+)/.test(trimmed)
  ) {
    return trimmed;
  }

  // Exact text or label search
  const escaped = trimmed.replace(/"/g, '\\"');
  return `text="${escaped}"`;
}

/** Escapes string values for code output */
function escapeString(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/**
 * Generates an end-to-end Playwright TypeScript test script from recorded agent actions.
 */
export function generatePlaywrightTypeScript(
  actions: RecordedAction[],
  options: PlaywrightGeneratorOptions = {},
): string {
  const testTitle = options.testName || 'Autonomous Workflow';
  const lines: string[] = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test('${testTitle.replace(/'/g, "\\'")}', async ({ page }) => {`,
    `  // Set default timeout for dynamic elements`,
    `  page.setDefaultTimeout(10000);`,
    '',
  ];

  let hasNavigated = false;

  for (const entry of actions) {
    const act = entry.action;
    const actionType = act.type || act.action;

    switch (actionType) {
      case 'navigate_to': {
        const url = act.url || 'about:blank';
        lines.push(`  // Navigate to target`);
        lines.push(`  await page.goto('${escapeString(url)}', { waitUntil: 'domcontentloaded' });`);
        hasNavigated = true;
        break;
      }

      case 'click_element': {
        const selector = formatLocator(act.selector || act.target || '');
        lines.push(`  // Click element`);
        lines.push(`  await page.locator('${escapeString(selector)}').first().click();`);
        break;
      }

      case 'type_text': {
        const selector = formatLocator(act.selector || act.target || '');
        const val = act.value ?? '';
        lines.push(`  // Type text`);
        lines.push(`  await page.locator('${escapeString(selector)}').first().fill('${escapeString(val)}');`);
        if (act.submitWithEnter) {
          lines.push(`  await page.keyboard.press('Enter');`);
        }
        break;
      }

      case 'select_option': {
        const selector = formatLocator(act.selector || act.target || '');
        const opt = act.option ?? '';
        lines.push(`  // Select dropdown option`);
        lines.push(`  await page.locator('${escapeString(selector)}').first().selectOption('${escapeString(opt)}');`);
        break;
      }

      case 'press_key': {
        const key = act.key || 'Enter';
        lines.push(`  // Press keyboard key`);
        lines.push(`  await page.keyboard.press('${escapeString(key)}');`);
        break;
      }

      case 'scroll_page': {
        const dir = act.direction === 'up' ? -600 : 600;
        const px = act.pixels ? (act.direction === 'up' ? -act.pixels : act.pixels) : dir;
        lines.push(`  // Scroll viewport`);
        lines.push(`  await page.mouse.wheel(0, ${px});`);
        break;
      }

      case 'wait_for': {
        const selector = act.selector || 'body';
        const state = act.state || 'visible';
        lines.push(`  // Wait for condition`);
        lines.push(`  await page.waitForSelector('${escapeString(selector)}', { state: '${state}' });`);
        break;
      }

      case 'act_on_element': {
        const subAction = act.action || 'click';
        const selector = formatLocator(act.target || '');
        if (subAction === 'click') {
          lines.push(`  await page.locator('${escapeString(selector)}').first().click();`);
        } else if (subAction === 'type' && act.value !== undefined) {
          lines.push(`  await page.locator('${escapeString(selector)}').first().fill('${escapeString(act.value)}');`);
        } else if (subAction === 'select' && act.option !== undefined) {
          lines.push(`  await page.locator('${escapeString(selector)}').first().selectOption('${escapeString(act.option)}');`);
        } else if (subAction === 'press_key' && act.key) {
          lines.push(`  await page.keyboard.press('${escapeString(act.key)}');`);
        }
        break;
      }

      case 'screenshot': {
        lines.push(`  // Capture snapshot`);
        lines.push(`  await page.screenshot({ path: 'step-${Date.now()}.png' });`);
        break;
      }

      default:
        // Non-browser actions (e.g. web_search, summarize) don't output direct DOM commands
        break;
    }
  }

  if (!hasNavigated && options.baseUrl) {
    lines.splice(4, 0, `  await page.goto('${escapeString(options.baseUrl)}');`);
  }

  lines.push('');
  lines.push(`  // Verification assertion`);
  lines.push(`  await expect(page).toHaveURL(/.+/);`);
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generates an end-to-end Playwright Python test script from recorded agent actions.
 */
export function generatePlaywrightPython(
  actions: RecordedAction[],
  options: PlaywrightGeneratorOptions = {},
): string {
  const lines: string[] = [
    `from playwright.sync_api import sync_playwright, expect`,
    '',
    `def run_workflow():`,
    `    with sync_playwright() as p:`,
    `        browser = p.chromium.launch(headless=${options.headless ? 'True' : 'False'})`,
    `        context = browser.new_context()`,
    `        page = context.new_page()`,
    `        page.set_default_timeout(10000)`,
    '',
  ];

  for (const entry of actions) {
    const act = entry.action;
    const actionType = act.type || act.action;

    switch (actionType) {
      case 'navigate_to': {
        const url = act.url || 'about:blank';
        lines.push(`        # Navigate to target`);
        lines.push(`        page.goto('${escapeString(url)}', wait_until='domcontentloaded')`);
        break;
      }

      case 'click_element': {
        const selector = formatLocator(act.selector || act.target || '');
        lines.push(`        # Click element`);
        lines.push(`        page.locator('${escapeString(selector)}').first.click()`);
        break;
      }

      case 'type_text': {
        const selector = formatLocator(act.selector || act.target || '');
        const val = act.value ?? '';
        lines.push(`        # Type text`);
        lines.push(`        page.locator('${escapeString(selector)}').first.fill('${escapeString(val)}')`);
        if (act.submitWithEnter) {
          lines.push(`        page.keyboard.press('Enter')`);
        }
        break;
      }

      case 'select_option': {
        const selector = formatLocator(act.selector || act.target || '');
        const opt = act.option ?? '';
        lines.push(`        # Select dropdown option`);
        lines.push(`        page.locator('${escapeString(selector)}').first.select_option('${escapeString(opt)}')`);
        break;
      }

      case 'press_key': {
        const key = act.key || 'Enter';
        lines.push(`        # Press keyboard key`);
        lines.push(`        page.keyboard.press('${escapeString(key)}')`);
        break;
      }

      case 'scroll_page': {
        const dir = act.direction === 'up' ? -600 : 600;
        const px = act.pixels ? (act.direction === 'up' ? -act.pixels : act.pixels) : dir;
        lines.push(`        # Scroll viewport`);
        lines.push(`        page.mouse.wheel(0, ${px})`);
        break;
      }

      case 'wait_for': {
        const selector = act.selector || 'body';
        const state = act.state || 'visible';
        lines.push(`        # Wait for condition`);
        lines.push(`        page.wait_for_selector('${escapeString(selector)}', state='${state}')`);
        break;
      }

      default:
        break;
    }
  }

  lines.push('');
  lines.push(`        # Clean up`);
  lines.push(`        browser.close()`);
  lines.push('');
  lines.push(`if __name__ == '__main__':`);
  lines.push(`    run_workflow()`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Converts recorded actions to code and saves directly to the Virtual Workspace VFS.
 */
export async function exportWorkflowToVFS(
  actions: RecordedAction[],
  options: PlaywrightGeneratorOptions = {},
): Promise<{ path: string; code: string }> {
  const isPython = options.format === 'python';
  const code = isPython
    ? generatePlaywrightPython(actions, options)
    : generatePlaywrightTypeScript(actions, options);

  const filename = isPython ? 'automation.py' : 'automation.spec.ts';
  const path = `/code/${filename}`;

  await vfs.writeFile(path, code, {
    createdBy: 'agent',
    tags: ['automation', 'playwright', isPython ? 'python' : 'typescript'],
    overwrite: true,
  });
  return { path, code };
}

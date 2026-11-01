import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatLocator,
  generatePlaywrightTypeScript,
  generatePlaywrightPython,
  exportWorkflowToVFS,
  type RecordedAction,
} from './playwright-generator';
import { vfs } from '../workspace/vfs';

describe('Prompt-to-Playwright Generator (Phase 4)', () => {
  beforeEach(async () => {
    await vfs.init();
  });

  const sampleActions: RecordedAction[] = [
    {
      action: {
        type: 'navigate_to',
        url: 'https://example.com/login',
      },
      timestamp: 1000,
    },
    {
      action: {
        type: 'type_text',
        target: '#username',
        value: 'testuser@example.com',
      },
      timestamp: 2000,
    },
    {
      action: {
        type: 'type_text',
        target: '#password',
        value: 'secret123',
        submitWithEnter: true,
      },
      timestamp: 3000,
    },
    {
      action: {
        type: 'click_element',
        target: '[2]',
        selector: 'button[type="submit"]',
      },
      timestamp: 4000,
    },
    {
      action: {
        type: 'select_option',
        target: '#role-select',
        option: 'Administrator',
      },
      timestamp: 5000,
    },
    {
      action: {
        type: 'scroll_page',
        direction: 'down',
        pixels: 400,
      },
      timestamp: 6000,
    },
  ];

  describe('formatLocator', () => {
    it('formats numeric IDs with data-nim-id attribute', () => {
      expect(formatLocator('[1]')).toBe('[data-nim-id="1"]');
      expect(formatLocator('id:42')).toBe('[data-nim-id="42"]');
      expect(formatLocator('5')).toBe('[data-nim-id="5"]');
    });

    it('preserves CSS selectors starting with #, ., or [', () => {
      expect(formatLocator('#login-btn')).toBe('#login-btn');
      expect(formatLocator('.submit-action')).toBe('.submit-action');
      expect(formatLocator('[role="button"]')).toBe('[role="button"]');
    });

    it('formats plain text labels with text= locator', () => {
      expect(formatLocator('Sign In')).toBe('text="Sign In"');
      expect(formatLocator('Add to Cart')).toBe('text="Add to Cart"');
    });
  });

  describe('generatePlaywrightTypeScript', () => {
    it('generates a complete, executable Playwright test script', () => {
      const tsCode = generatePlaywrightTypeScript(sampleActions, {
        testName: 'User Authentication Flow',
      });

      expect(tsCode).toContain("import { test, expect } from '@playwright/test';");
      expect(tsCode).toContain("test('User Authentication Flow'");
      expect(tsCode).toContain("await page.goto('https://example.com/login'");
      expect(tsCode).toContain("await page.locator('#username').first().fill('testuser@example.com');");
      expect(tsCode).toContain("await page.keyboard.press('Enter');");
      expect(tsCode).toContain("await page.locator('button[type=\"submit\"]').first().click();");
      expect(tsCode).toContain("await page.locator('#role-select').first().selectOption('Administrator');");
      expect(tsCode).toContain('await page.mouse.wheel(0, 400);');
      expect(tsCode).toContain('await expect(page).toHaveURL(/.+/);');
    });
  });

  describe('generatePlaywrightPython', () => {
    it('generates a complete, executable Playwright Python script', () => {
      const pyCode = generatePlaywrightPython(sampleActions, {
        headless: true,
      });

      expect(pyCode).toContain('from playwright.sync_api import sync_playwright, expect');
      expect(pyCode).toContain('def run_workflow():');
      expect(pyCode).toContain("page.goto('https://example.com/login', wait_until='domcontentloaded')");
      expect(pyCode).toContain("page.locator('#username').first.fill('testuser@example.com')");
      expect(pyCode).toContain("page.locator('button[type=\"submit\"]').first.click()");
      expect(pyCode).toContain("page.locator('#role-select').first.select_option('Administrator')");
      expect(pyCode).toContain('browser.close()');
    });
  });

  describe('exportWorkflowToVFS', () => {
    it('persists generated automation script to Virtual Workspace /code/', async () => {
      const { path, code } = await exportWorkflowToVFS(sampleActions, {
        format: 'typescript',
      });

      expect(path).toBe('/code/automation.spec.ts');
      expect(code).toContain("test('Autonomous Workflow'");

      const file = await vfs.readFile(path);
      expect(file).toBeDefined();
      expect(file?.content).toBe(code);
      expect(file?.tags).toContain('playwright');
    });
  });
});

import { test as base, type BrowserContext, type Page } from '@playwright/test';

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  sidePanelPage: Page;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  extensionId: async ({ context }, use) => {
    await context.waitForEvent('serviceworker');
    const sw = context.serviceWorkers()[0];
    const id = sw.url().split('/')[2];
    await use(id);
  },
  sidePanelPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.waitForLoadState('networkidle');
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';

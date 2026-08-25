import { test, expect } from '../setup/extension-context';

test('side panel loads and renders root interface', async ({ sidePanelPage }) => {
  const title = await sidePanelPage.title();
  expect(title).toBe('NIM Agent');

  const root = sidePanelPage.locator('#root');
  await expect(root).toBeVisible();
});

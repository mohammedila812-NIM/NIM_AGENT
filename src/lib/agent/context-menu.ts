/**
 * NIM Context Menu Integration (Phase 2 & 3 UX)
 *
 * Registers browser context menus for 1-click interactions:
 * - "NIM: Extract table to Workspace"
 * - "NIM: Research with Swarm"
 * - "NIM: Save to Knowledge Graph"
 * - "NIM: Summarize this page"
 */

export function setupContextMenus(): void {
  if (!chrome.contextMenus) return;

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'nim_extract_table',
        title: '📊 NIM: Extract table to Workspace',
        contexts: ['page', 'selection'],
      });

      chrome.contextMenus.create({
        id: 'nim_swarm_research',
        title: '🕸️ NIM: Research with Swarm',
        contexts: ['selection'],
      });

      chrome.contextMenus.create({
        id: 'nim_save_knowledge',
        title: '🧠 NIM: Save to Knowledge Graph',
        contexts: ['selection'],
      });

      chrome.contextMenus.create({
        id: 'nim_summarize_page',
        title: '📝 NIM: Summarize this page',
        contexts: ['page'],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    // Ensure sidepanel is opened
    try {
      if (chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch {
      // sidePanel.open may fail if not triggered by direct gesture on older Chrome
    }

    let instruction = '';
    const selectedText = (info.selectionText || '').trim();
    const pageUrl = tab.url || info.pageUrl || '';

    switch (info.menuItemId) {
      case 'nim_extract_table':
        instruction = selectedText
          ? `Extract structured tabular data from the selected content: "${selectedText}" and save it into a new CSV file in the Virtual Workspace (/data/).`
          : `Extract the main table or list from this webpage (${pageUrl}) and save it as a CSV file in the Virtual Workspace (/data/).`;
        break;

      case 'nim_swarm_research':
        instruction = `Launch a parallel research swarm on: "${selectedText}". Compare top sources and compile a synthesized report.`;
        break;

      case 'nim_save_knowledge':
        instruction = `Extract the key entities, specs, and facts from this text and save them into the Knowledge Graph: "${selectedText}". Source URL: ${pageUrl}`;
        break;

      case 'nim_summarize_page':
        instruction = `Read this webpage (${pageUrl}) and provide a concise executive summary with key takeaways and bullet points.`;
        break;
    }

    if (instruction) {
      // Broadcast to sidepanel to trigger automatic task start
      chrome.runtime.sendMessage({
        type: 'CONTEXT_MENU_TASK',
        instruction,
        pageUrl,
        timestamp: Date.now(),
      }).catch(() => {});
    }
  });
}

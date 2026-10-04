/**
 * Set-of-Marks (SoM) Visual Grounding Overlay
 * Draws high-contrast bounding boxes and numerical badges on visible elements
 * in the active viewport right before capturing screenshots for vision models.
 */

/**
 * Injects Set-of-Marks badge overlay into the target tab.
 */
export async function injectSetOfMarksOverlay(tabId: number): Promise<{ count: number }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Remove existing overlay if any
        const existing = document.getElementById('nim-som-overlay-container');
        if (existing) existing.remove();

        const container = document.createElement('div');
        container.id = 'nim-som-overlay-container';
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '2147483647';

        const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-nim-id]'));
        let visibleCount = 0;

        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          // Check if element is inside current viewport
          if (
            rect.width > 4 &&
            rect.height > 4 &&
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.right > 0
          ) {
            const id = el.getAttribute('data-nim-id') || '';

            // Bounding box
            const box = document.createElement('div');
            box.style.position = 'fixed';
            box.style.left = `${Math.max(0, rect.left)}px`;
            box.style.top = `${Math.max(0, rect.top)}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
            box.style.border = '2px solid #eab308'; // Amber border
            box.style.boxSizing = 'border-box';
            box.style.backgroundColor = 'rgba(234, 179, 8, 0.08)';

            // Numbered badge
            const badge = document.createElement('div');
            badge.style.position = 'absolute';
            badge.style.top = '-14px';
            badge.style.left = '0px';
            badge.style.backgroundColor = '#eab308';
            badge.style.color = '#000000';
            badge.style.fontSize = '11px';
            badge.style.fontWeight = 'bold';
            badge.style.fontFamily = 'monospace, sans-serif';
            badge.style.padding = '1px 4px';
            badge.style.borderRadius = '3px';
            badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.5)';
            badge.textContent = id;

            box.appendChild(badge);
            container.appendChild(box);
            visibleCount++;
          }
        }

        document.documentElement.appendChild(container);
        return visibleCount;
      },
    });

    return { count: results[0]?.result ?? 0 };
  } catch {
    return { count: 0 };
  }
}

/**
 * Removes the Set-of-Marks overlay from the target tab.
 */
export async function removeSetOfMarksOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const existing = document.getElementById('nim-som-overlay-container');
        if (existing) existing.remove();
      },
    });
  } catch {
    // Ignore error if tab closed
  }
}

/**
 * Helper to capture a Set-of-Marks annotated viewport screenshot.
 */
export async function captureViewportWithMarks(tabId: number): Promise<string> {
  await injectSetOfMarksOverlay(tabId);
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      chrome.tabs.captureVisibleTab({ format: 'png' }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!res) {
          reject(new Error('Failed to capture tab screenshot'));
        } else {
          resolve(res);
        }
      });
    });
    return dataUrl;
  } finally {
    await removeSetOfMarksOverlay(tabId);
  }
}

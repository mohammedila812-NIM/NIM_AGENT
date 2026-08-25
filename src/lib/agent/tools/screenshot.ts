/** Capture the active tab viewport as a base64 PNG. Called from background service worker. */
export async function captureViewport(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!dataUrl) {
        reject(new Error('Failed to capture tab screenshot'));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

/**
 * Desktop Bridge Client for NIM Agent Extension
 *
 * Architecture: The sidepanel CANNOT directly open a ws:// connection in Chrome MV3
 * due to CSP restrictions. So we route all WebSocket traffic through the
 * background service worker via chrome.runtime.sendMessage / port messaging.
 *
 * Background script handles the actual WebSocket connection.
 * Sidepanel controls it via messages.
 */

export interface DesktopBridgeConfig {
  enabled: boolean;
  serverUrl: string;
  authToken: string;
  autoConnect: boolean;
}

export type BridgeConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export const DEFAULT_BRIDGE_CONFIG: DesktopBridgeConfig = {
  enabled: false,
  serverUrl: 'ws://127.0.0.1:7432',
  authToken: '',
  autoConnect: true,
};

class DesktopBridgeClient {
  private state: BridgeConnectionState = 'disconnected';
  private listeners: Set<(state: BridgeConnectionState) => void> = new Set();

  constructor() {
    // 1. Listen for storage state changes (100% reliable across MV3 contexts)
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.bridgeConnectionState) {
        this.setState(changes.bridgeConnectionState.newValue as BridgeConnectionState);
      }
    });

    // 2. Listen for runtime message broadcasts from background
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.type === 'BRIDGE_STATE_CHANGED') {
        this.setState(msg.state as BridgeConnectionState);
      }
    });

    // Request current state on init
    void this.syncState();
  }

  private async syncState() {
    try {
      const data = await chrome.storage.local.get(['bridgeConnectionState']);
      if (data.bridgeConnectionState) {
        this.setState(data.bridgeConnectionState as BridgeConnectionState);
      } else {
        const resp = await chrome.runtime.sendMessage({ type: 'BRIDGE_GET_STATE' });
        if (resp?.state) this.setState(resp.state as BridgeConnectionState);
      }
    } catch { /* background not ready yet */ }
  }

  public getState(): BridgeConnectionState {
    return this.state;
  }

  public onStateChange(listener: (state: BridgeConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(newState: BridgeConnectionState) {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.listeners) {
      try { listener(newState); } catch { /* ignore */ }
    }
  }

  public connect(url: string, authToken: string): void {
    this.setState('connecting');
    chrome.runtime.sendMessage({
      type: 'BRIDGE_CONNECT',
      payload: { url, authToken },
    }).catch(() => {});
  }

  public disconnect(): void {
    chrome.runtime.sendMessage({ type: 'BRIDGE_DISCONNECT' }).catch(() => {});
    this.setState('disconnected');
  }
}

export const desktopBridge = new DesktopBridgeClient();

import { appendSecurityEvent } from '../security/audit-log';

export const ALLOWED_PORT_NAMES = ['sidepanel-stream', 'content-actions'] as const;
export type AllowedPort = typeof ALLOWED_PORT_NAMES[number];

type PortHandler = (port: chrome.runtime.Port) => void;

const handlers = new Map<AllowedPort, PortHandler>();

/** Register a handler for a specific named port. */
export function onPort(name: AllowedPort, handler: PortHandler): void {
  handlers.set(name, handler);
}

/** Call this once in background.ts to wire up the listener with strict sender validation. */
export function initPortManager(): void {
  chrome.runtime.onConnect.addListener((port) => {
    // SECURITY: Only accept connections from our own extension context
    if (port.sender?.id !== chrome.runtime.id) {
      console.warn('[PortManager] Rejected port from foreign sender:', port.sender?.id);
      void appendSecurityEvent({
        type: 'sender_rejected',
        senderId: port.sender?.id ?? 'unknown',
        portName: port.name,
      });
      port.disconnect();
      return;
    }

    if (!ALLOWED_PORT_NAMES.includes(port.name as AllowedPort)) {
      console.warn('[PortManager] Rejected unknown port name:', port.name);
      port.disconnect();
      return;
    }

    const handler = handlers.get(port.name as AllowedPort);
    if (handler) {
      handler(port);
    }
  });
}

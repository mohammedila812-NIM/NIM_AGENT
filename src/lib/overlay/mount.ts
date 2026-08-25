import overlayStyles from './overlay.css?raw';

let _shadowRoot: ShadowRoot | null = null;
let _container: HTMLDivElement | null = null;

/**
 * Returns a closed shadow root attached to document.documentElement.
 * 'closed' mode prevents host page JS from reading element.shadowRoot.
 */
export function getOverlayRoot(): ShadowRoot {
  if (_shadowRoot && _container && _container.isConnected) {
    return _shadowRoot;
  }

  const host = document.createElement('nim-agent-root');
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 0',
    'height: 0',
    'z-index: 2147483647',
    'pointer-events: none',
    'overflow: visible',
  ].join(';');

  _shadowRoot = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = overlayStyles;
  _shadowRoot.appendChild(style);

  const container = document.createElement('div');
  container.className = 'nim-overlay-container';
  _shadowRoot.appendChild(container);
  _container = container;

  // Append to html element, not body — survives full body re-renders
  document.documentElement.appendChild(host);
  return _shadowRoot;
}

/** Render a temporary visual bounding box over an element being inspected or interacted with. */
export function renderHighlight(rect: DOMRect, label: string): void {
  const root = getOverlayRoot();
  const existing = root.querySelector('.nim-highlight-box');
  if (existing) existing.remove();

  const box = document.createElement('div');
  box.className = 'nim-highlight-box';
  box.style.top = `${rect.top + window.scrollY}px`;
  box.style.left = `${rect.left + window.scrollX}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;

  const badge = document.createElement('div');
  badge.className = 'nim-highlight-label';
  badge.textContent = label;
  box.appendChild(badge);

  root.querySelector('.nim-overlay-container')?.appendChild(box);

  // Auto clear after 2.5s
  setTimeout(() => {
    box.remove();
  }, 2500);
}

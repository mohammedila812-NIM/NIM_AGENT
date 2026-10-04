/**
 * Live Spotlight (Laser Pointer) — Phase 2 UX Ergonomics
 *
 * Draws a brief animated pulse ring on the page at the location where NIM Agent
 * just clicked, typed, or focused — so the user can watch the agent work in real time.
 *
 * Also provides the CAPTCHA / 2FA HUD that pauses the agent and prompts the user.
 */

// ─── Spotlight Effect ─────────────────────────────────────────────────────────

export interface SpotlightOptions {
  x?: number;          // Viewport X coordinate (from getBoundingClientRect)
  y?: number;          // Viewport Y coordinate
  selector?: string;   // CSS selector — will look up coords automatically
  color?: string;      // Ring color (default: '#FFCC00')
  durationMs?: number; // Animation duration (default: 800)
}

/**
 * Injects a pulse animation ring into the tab at the target element's location.
 * The ring is purely cosmetic and auto-removes itself after animation completes.
 */
export async function flashSpotlight(tabId: number, options: SpotlightOptions = {}): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts: SpotlightOptions) => {
        let cx = opts.x ?? 0;
        let cy = opts.y ?? 0;

        // Resolve selector to coordinates if provided
        if (opts.selector) {
          const el = document.querySelector(opts.selector);
          if (el) {
            const rect = el.getBoundingClientRect();
            cx = rect.left + rect.width / 2;
            cy = rect.top + rect.height / 2;
          }
        }

        const color = opts.color ?? '#FFCC00';
        const duration = opts.durationMs ?? 800;

        // Create SVG spotlight overlay
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', '__nim_spotlight__');
        svg.style.cssText = `
          position: fixed;
          top: 0; left: 0;
          width: 100vw; height: 100vh;
          pointer-events: none;
          z-index: 2147483647;
        `;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '14');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', '3');

        // Keyframe animation: pulse expand + fade
        const style = document.createElement('style');
        style.textContent = `
          @keyframes __nim_pulse__ {
            0%   { r: 14; opacity: 1; stroke-width: 3; }
            60%  { r: 38; opacity: 0.6; stroke-width: 1.5; }
            100% { r: 52; opacity: 0; stroke-width: 0.5; }
          }
          #__nim_spotlight__ circle { animation: __nim_pulse__ ${duration}ms ease-out forwards; }
        `;

        svg.appendChild(circle);
        document.head.appendChild(style);
        document.body.appendChild(svg);

        // Auto-remove after animation
        setTimeout(() => {
          svg.remove();
          style.remove();
        }, duration + 50);
      },
      args: [options],
    });
  } catch {
    // Spotlight is cosmetic — silently ignore errors
  }
}

// ─── CAPTCHA / 2FA HUD ────────────────────────────────────────────────────────

export interface HUDBanner {
  type: 'captcha' | '2fa' | 'cloudflare' | 'unknown';
  message: string;
  tabId: number;
}

/**
 * Injects a non-intrusive HUD banner at the top of the page telling the user
 * to manually solve the CAPTCHA/2FA, and returns a Promise that resolves when
 * the challenge appears to have been cleared.
 *
 * The banner auto-removes itself. The caller should poll `detectSecurityChallenge`
 * to confirm resolution before resuming.
 */
export async function showCaptchaHUD(banner: HUDBanner): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: banner.tabId },
      func: (msg: string) => {
        const existing = document.getElementById('__nim_captcha_hud__');
        if (existing) return; // Already shown

        const hud = document.createElement('div');
        hud.id = '__nim_captcha_hud__';
        hud.style.cssText = `
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 2147483647;
          background: linear-gradient(90deg, #1a1a2e, #16213e);
          color: #FFCC00;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 14px;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.5);
        `;

        const icon = document.createElement('span');
        icon.textContent = '🛡️';
        icon.style.fontSize = '20px';

        const text = document.createElement('span');
        text.textContent = msg;

        const subtext = document.createElement('span');
        subtext.style.cssText = 'color: #aaa; font-size: 12px; margin-left: 8px;';
        subtext.textContent = '— NIM Agent is paused and will auto-resume when complete.';

        hud.appendChild(icon);
        hud.appendChild(text);
        hud.appendChild(subtext);
        document.body.prepend(hud);
      },
      args: [banner.message],
    });
  } catch {
    // HUD is cosmetic — ignore errors
  }
}

/** Removes the CAPTCHA HUD banner after the challenge has been resolved. */
export async function removeCaptchaHUD(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.getElementById('__nim_captcha_hud__')?.remove();
      },
    });
  } catch {
    // Ignore
  }
}

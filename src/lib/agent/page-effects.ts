/**
 * page-effects.ts
 *
 * Injects visual overlay animations into the active browser tab when the agent
 * performs actions — click ripples, type indicators, scroll arrows, scan sweeps,
 * and camera flashes. All effects use position:fixed overlays with pointer-events:none
 * so they never break page layout or block user interaction.
 *
 * Each effect auto-removes itself after its animation completes.
 */

// ── Shared CSS injected once per tab ─────────────────────────────────────────

const EFFECT_CSS = `
  @keyframes nim-ripple {
    0%   { transform: scale(0);   opacity: 0.9; }
    100% { transform: scale(4);   opacity: 0; }
  }
  @keyframes nim-cursor-pop {
    0%   { transform: scale(1.0); opacity: 1; }
    40%  { transform: scale(1.4); opacity: 1; }
    100% { transform: scale(1.0); opacity: 0; }
  }
  @keyframes nim-type-pulse {
    0%,100% { box-shadow: 0 0 0 2px rgba(34,197,94,0.9); }
    50%      { box-shadow: 0 0 0 5px rgba(34,197,94,0.3); }
  }
  @keyframes nim-scan {
    0%   { top: 0;    opacity: 0.18; }
    50%  { opacity: 0.28; }
    100% { top: 100%; opacity: 0; }
  }
  @keyframes nim-scroll-arrow {
    0%   { opacity: 0; transform: translateY(0); }
    30%  { opacity: 1; }
    100% { opacity: 0; transform: translateY(28px); }
  }
  @keyframes nim-flash {
    0%   { opacity: 0.7; }
    100% { opacity: 0; }
  }
  @keyframes nim-nav-bar {
    0%   { width: 0%;   opacity: 1; }
    80%  { width: 85%;  opacity: 1; }
    100% { width: 100%; opacity: 0; }
  }
  @keyframes nim-highlight-fade {
    0%   { outline-color: rgba(34,197,94,0.9); background: rgba(34,197,94,0.12); }
    100% { outline-color: rgba(34,197,94,0);   background: rgba(34,197,94,0); }
  }
  .nim-fx-host {
    position: fixed; inset: 0; pointer-events: none;
    z-index: 2147483647; overflow: hidden;
  }
`;

function _ensureStyles(doc: Document) {
  if (doc.getElementById('nim-fx-styles')) return;
  const s = doc.createElement('style');
  s.id = 'nim-fx-styles';
  s.textContent = EFFECT_CSS;
  doc.head.appendChild(s);
}

// ── Effect: Click ripple + cursor dot ────────────────────────────────────────

export async function fxClick(tabId: number, selector: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const doc = document;
      // Find element
      const all = Array.from(doc.querySelectorAll('button,a,input,select,textarea,[role="button"]'));
      const lower = sel.toLowerCase();
      const el =
        (doc.querySelector(sel) as HTMLElement | null) ??
        (all.find(e => (e.textContent ?? '').toLowerCase().includes(lower)) as HTMLElement | null);

      const host = (() => {
        const s = doc.getElementById('nim-fx-styles');
        if (!s) {
          const style = doc.createElement('style');
          style.id = 'nim-fx-styles';
          style.textContent = `
            @keyframes nim-ripple { 0%{transform:scale(0);opacity:.9} 100%{transform:scale(4);opacity:0} }
            @keyframes nim-cursor-pop { 0%{transform:scale(1);opacity:1} 40%{transform:scale(1.4);opacity:1} 100%{transform:scale(1);opacity:0} }
            .nim-fx-host{position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden}
          `;
          doc.head.appendChild(style);
        }
        let h = doc.getElementById('nim-fx-host') as HTMLDivElement | null;
        if (!h) { h = doc.createElement('div'); h.id = 'nim-fx-host'; h.className = 'nim-fx-host'; doc.body.appendChild(h); }
        return h;
      })();

      // Position from element or center fallback
      let cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      if (el) {
        const r = el.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;

        // Highlight the target element
        const prev = el.style.cssText;
        el.style.outline = '2px solid rgba(34,197,94,0.9)';
        el.style.outlineOffset = '2px';
        el.style.transition = 'outline 0.4s ease';
        setTimeout(() => { el.style.cssText = prev; }, 700);
      }

      // Cursor dot
      const cursor = doc.createElement('div');
      cursor.style.cssText = `
        position:absolute; width:24px; height:24px; border-radius:50%;
        background:rgba(34,197,94,0.85); border:2px solid #fff;
        left:${cx - 12}px; top:${cy - 12}px;
        animation:nim-cursor-pop 0.5s ease forwards;
        box-shadow: 0 0 12px rgba(34,197,94,0.6);
      `;
      host.appendChild(cursor);

      // Ripple ring
      const ripple = doc.createElement('div');
      ripple.style.cssText = `
        position:absolute; width:40px; height:40px; border-radius:50%;
        border:2px solid rgba(34,197,94,0.7);
        left:${cx - 20}px; top:${cy - 20}px;
        animation:nim-ripple 0.6s ease-out forwards;
      `;
      host.appendChild(ripple);

      setTimeout(() => { cursor.remove(); ripple.remove(); }, 700);
    },
    args: [selector],
  });
}

// ── Effect: Type glow on input ───────────────────────────────────────────────

export async function fxType(tabId: number, selector: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el =
        (document.querySelector(sel) as HTMLElement | null) ??
        (Array.from(document.querySelectorAll('input,textarea,[contenteditable]')).find(e =>
          ((e as HTMLInputElement).placeholder || e.getAttribute('aria-label') || '')
            .toLowerCase().includes(sel.toLowerCase()),
        ) as HTMLElement | null);
      if (!el) return;

      // Add style if missing
      if (!document.getElementById('nim-fx-styles')) {
        const style = document.createElement('style');
        style.id = 'nim-fx-styles';
        style.textContent = `@keyframes nim-type-pulse{0%,100%{box-shadow:0 0 0 2px rgba(34,197,94,0.9)}50%{box-shadow:0 0 0 6px rgba(34,197,94,0.25)}}`;
        document.head.appendChild(style);
      }

      const prev = el.style.cssText;
      el.style.outline = 'none';
      el.style.animation = 'nim-type-pulse 0.5s ease 3';
      el.style.transition = 'box-shadow 0.2s';
      setTimeout(() => { el.style.cssText = prev; }, 1800);
    },
    args: [selector],
  });
}

// ── Effect: Scroll directional arrow ─────────────────────────────────────────

export async function fxScroll(tabId: number, direction: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (dir: string) => {
      if (!document.getElementById('nim-fx-styles')) {
        const style = document.createElement('style');
        style.id = 'nim-fx-styles';
        style.textContent = `@keyframes nim-scroll-arrow{0%{opacity:0;transform:translateY(0)}30%{opacity:1}100%{opacity:0;transform:translateY(28px)}}`;
        document.head.appendChild(style);
      }
      let h = document.getElementById('nim-fx-host') as HTMLDivElement | null;
      if (!h) { h = document.createElement('div'); h.id = 'nim-fx-host'; h.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden'; document.body.appendChild(h); }

      const isDown = dir !== 'up';
      const arrow = document.createElement('div');
      arrow.style.cssText = `
        position:absolute; left:50%; bottom:${isDown ? '40px' : 'auto'}; top:${isDown ? 'auto' : '40px'};
        transform:translateX(-50%) ${isDown ? '' : 'rotate(180deg)'};
        font-size:28px; color:rgba(34,197,94,0.9);
        text-shadow: 0 0 10px rgba(34,197,94,0.5);
        animation:nim-scroll-arrow 0.7s ease forwards;
      `;
      arrow.textContent = '▼';
      h.appendChild(arrow);
      setTimeout(() => arrow.remove(), 800);
    },
    args: [direction],
  });
}

// ── Effect: Page scan sweep (read_page) ──────────────────────────────────────

export async function fxScan(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (!document.getElementById('nim-fx-styles')) {
        const style = document.createElement('style');
        style.id = 'nim-fx-styles';
        style.textContent = `@keyframes nim-scan{0%{top:0;opacity:.18}50%{opacity:.28}100%{top:100%;opacity:0}}`;
        document.head.appendChild(style);
      }
      let h = document.getElementById('nim-fx-host') as HTMLDivElement | null;
      if (!h) { h = document.createElement('div'); h.id = 'nim-fx-host'; h.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden'; document.body.appendChild(h); }

      const bar = document.createElement('div');
      bar.style.cssText = `
        position:absolute; left:0; right:0; top:0; height:3px;
        background:linear-gradient(90deg,transparent,rgba(34,197,94,0.7),transparent);
        box-shadow: 0 0 8px rgba(34,197,94,0.4);
        animation: nim-scan 1.2s ease-in-out forwards;
      `;
      h.appendChild(bar);
      setTimeout(() => bar.remove(), 1300);
    },
    args: [],
  });
}

// ── Effect: Navigate progress bar ────────────────────────────────────────────

export async function fxNavigate(tabId: number): Promise<void> {
  // Fire and forget — tab may navigate away, so best-effort only
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!document.getElementById('nim-fx-styles')) {
          const style = document.createElement('style');
          style.id = 'nim-fx-styles';
          style.textContent = `@keyframes nim-nav-bar{0%{width:0%;opacity:1}80%{width:85%;opacity:1}100%{width:100%;opacity:0}}`;
          document.head.appendChild(style);
        }
        let h = document.getElementById('nim-fx-host') as HTMLDivElement | null;
        if (!h) { h = document.createElement('div'); h.id = 'nim-fx-host'; h.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden'; document.body.appendChild(h); }

        const bar = document.createElement('div');
        bar.style.cssText = `
          position:absolute; top:0; left:0; height:3px;
          background:linear-gradient(90deg,#22c55e,#4ade80);
          box-shadow:0 0 8px rgba(34,197,94,0.6);
          animation:nim-nav-bar 1.0s ease-out forwards;
        `;
        h.appendChild(bar);
        setTimeout(() => bar.remove(), 1100);
      },
      args: [],
    });
  } catch {
    // Tab may be mid-navigation, ignore
  }
}

// ── Effect: Camera flash (screenshot) ────────────────────────────────────────

export async function fxFlash(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (!document.getElementById('nim-fx-styles')) {
        const style = document.createElement('style');
        style.id = 'nim-fx-styles';
        style.textContent = `@keyframes nim-flash{0%{opacity:.7}100%{opacity:0}}`;
        document.head.appendChild(style);
      }
      let h = document.getElementById('nim-fx-host') as HTMLDivElement | null;
      if (!h) { h = document.createElement('div'); h.id = 'nim-fx-host'; h.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden'; document.body.appendChild(h); }

      const flash = document.createElement('div');
      flash.style.cssText = `
        position:absolute; inset:0;
        background:#fff;
        animation:nim-flash 0.35s ease-out forwards;
      `;
      h.appendChild(flash);
      setTimeout(() => flash.remove(), 400);
    },
    args: [],
  });
}

// ── Effect: Cinematic Ghost Cursor & Intent Badge ───────────────────────────

export async function fxGhostCursor(
  tabId: number,
  target: string,
  intentText = 'Interacting...',
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (targetStr: string, label: string) => {
        const doc = document;
        const numMatch = targetStr.trim().match(/^\[?(\d+)\]?$/) || targetStr.trim().match(/^id:(\d+)$/);
        let el: HTMLElement | null = null;
        if (numMatch) {
          el = doc.querySelector(`[data-nim-id="${numMatch[1]}"]`);
        }
        if (!el) {
          try {
            el = doc.querySelector(targetStr);
          } catch {
            // ignore
          }
        }
        if (!el) {
          const all = Array.from(doc.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"]'));
          const lower = targetStr.toLowerCase();
          el = all.find((e) => (e.textContent || '').toLowerCase().includes(lower)) || null;
        }

        const rect = el
          ? el.getBoundingClientRect()
          : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 20, height: 20 };
        const destX = Math.max(10, Math.min(window.innerWidth - 30, rect.left + rect.width / 2));
        const destY = Math.max(10, Math.min(window.innerHeight - 30, rect.top + rect.height / 2));

        let h = doc.getElementById('nim-fx-host') as HTMLDivElement | null;
        if (!h) {
          h = doc.createElement('div');
          h.id = 'nim-fx-host';
          h.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;';
          doc.body.appendChild(h);
        }

        const cursorContainer = doc.createElement('div');
        cursorContainer.style.cssText = `
          position: fixed;
          left: ${destX}px;
          top: ${destY}px;
          pointer-events: none;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2);
          transform: translate(-4px, -4px);
        `;

        cursorContainer.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 2px 8px rgba(34,197,94,0.6));">
            <path d="M4 4L11 20L14 13L21 10L4 4Z" fill="#22c55e" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
          </svg>
          <div style="background: rgba(15, 23, 42, 0.92); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.5); font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 9999px; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.4); backdrop-filter: blur(4px);">
            ${label}
          </div>
        `;

        h.appendChild(cursorContainer);

        const ripple = doc.createElement('div');
        ripple.style.cssText = `
          position: fixed;
          left: ${destX - 20}px;
          top: ${destY - 20}px;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 2px solid rgba(34, 197, 94, 0.9);
          background: rgba(34, 197, 94, 0.2);
          animation: nim-ripple 0.6s ease-out forwards;
          pointer-events: none;
        `;
        h.appendChild(ripple);

        setTimeout(() => {
          cursorContainer.style.opacity = '0';
          cursorContainer.style.transform = 'translate(-4px, -12px) scale(0.9)';
          setTimeout(() => {
            cursorContainer.remove();
            ripple.remove();
          }, 300);
        }, 700);
      },
      args: [target, intentText],
    });
  } catch {
    // Non-fatal overlay error
  }
}

// ── Effect: Ambient In-Page Floating Telemetry Pill ──────────────────────────

export interface PillState {
  stepNumber: number;
  tool: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
  taskId?: string;
}

export async function fxUpdatePill(tabId: number, state: PillState): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (st: PillState) => {
        const doc = document;
        let pill = doc.getElementById('nim-ambient-pill') as HTMLDivElement | null;
        if (!pill) {
          pill = doc.createElement('div');
          pill.id = 'nim-ambient-pill';
          pill.style.cssText = `
            position: fixed;
            bottom: 24px;
            left: 24px;
            z-index: 2147483646;
            background: rgba(15, 23, 42, 0.92);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(59, 130, 246, 0.4);
            border-radius: 9999px;
            padding: 8px 14px;
            color: #f8fafc;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            user-select: none;
            cursor: default;
          `;
          doc.body.appendChild(pill);
        }

        const isComplete = st.status === 'done';
        const isErr = st.status === 'error';
        const dotColor = isErr ? '#ef4444' : isComplete ? '#10b981' : '#3b82f6';
        const dotGlow = isErr ? '0 0 8px #ef4444' : isComplete ? '0 0 8px #10b981' : '0 0 8px #3b82f6';

        const labelText = isComplete
          ? `Step ${st.stepNumber} complete`
          : isErr
          ? `Step ${st.stepNumber} failed`
          : `Step ${st.stepNumber}: ${st.tool.replace(/_/g, ' ')}`;

        pill.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};box-shadow:${dotGlow};"></span>
            <span style="color:#93c5fd;font-weight:600;font-size:11px;letter-spacing:0.02em;">NIM</span>
          </div>
          <span style="height:12px;width:1px;background:rgba(255,255,255,0.15);"></span>
          <span style="color:#f1f5f9;font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${labelText}</span>
          <button id="nim-pill-stop-btn" style="margin-left:4px;background:rgba(239,68,68,0.2);color:#fca5a5;border:1px solid rgba(239,68,68,0.4);padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;cursor:pointer;transition:all 0.15s;">
            Stop
          </button>
        `;

        const stopBtn = pill.querySelector('#nim-pill-stop-btn');
        if (stopBtn) {
          stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'AGENT_STOP', taskId: st.taskId });
            }
            pill?.remove();
          });
        }
      },
      args: [state],
    });
  } catch {
    // Non-fatal
  }
}

export async function fxRemovePill(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const pill = document.getElementById('nim-ambient-pill');
        if (pill) {
          pill.style.opacity = '0';
          pill.style.transform = 'translateY(8px) scale(0.95)';
          setTimeout(() => pill.remove(), 400);
        }
      },
    });
  } catch {
    // Non-fatal
  }
}


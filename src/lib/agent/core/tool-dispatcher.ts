/**
 * Tool Dispatcher (Phase 3 Architecture)
 * Centralizes tool routing, execution, validation handling, and DOM actuation integration.
 */

import type { ValidatedToolCall } from '../tools';
import type { AgentEngineConfig, AgentRunCallbacks } from '../engine';
import { webSearch } from '../tools/web-search';
import { navigateTo } from '../tools/navigator';
import { captureViewportWithMarks } from '../tools/set-of-marks';
import { captureViewport } from '../tools/screenshot';
import { chatCompletion } from '../../llm/client';
import { summarizeContent } from '../tools/summarizer';
import { listTabs, switchTab, closeTab } from '../tools/tab-manager';
import { extractTableFromPage } from '../tools/table-extractor';
import { observePage, formatAffordances } from '../primitives/observe';
import { actOnElement } from '../primitives/act';
import { extractStructuredData } from '../primitives/extract';
import { executeParallelSubagents } from '../subagent-runner';
import { waitForDOMSettle, waitForSelector } from '../tools/wait-utils';
import { shouldUseFallbackVision } from '../tools/interaction-policy';
import { fxClick, fxType, fxScroll, fxScan, fxNavigate, fxFlash, fxGhostCursor } from '../page-effects';
import { DESTRUCTIVE_KEYWORDS, SENSITIVE_FIELD_PATTERNS } from '../security-patterns';
import { recallSessionHistory } from '../tools/session-recall';
import { executeBatchFormFill, formatBatchFillResult } from '../tools/form-filler';
import { exportDataToFile, formatExportResult } from '../tools/data-exporter';
import { inspectPageState, formatInspectedState } from '../tools/state-inspector';
import { executeScratchpadWrite, executeScratchpadRead } from '../scratchpad';
import { executeCreateWatch, executeListWatches, executeDeleteWatch } from '../tools/watch-tools';
import {
  executeWorkspaceCreateFile,
  executeWorkspaceAppendFile,
  executeWorkspaceReadFile,
  executeWorkspaceListFiles,
  executeWorkspaceDeleteFile,
  executeWorkspaceSearch,
} from '../../workspace/workspace-tools';
import { extractAndStoreEntities } from '../../knowledge/entity-extractor';
import {
  executeKnowledgeGraphQuery,
  executeKnowledgeGraphAdd,
  executeKnowledgeGraphRelate,
} from '../../knowledge/graph-tools';
import { runSwarm } from '../swarm/coordinator';
import {
  startPageChangeDetector,
  stopPageChangeDetector,
  getPageChangeDetectorStatus,
} from '../sentinel/change-detector';
import {
  saveActiveWatcher,
  removeActiveWatcher,
} from '../sentinel/sentinel-registry';
import { appendResearchNote } from '../../storage/tasks';
import { wrapUntrustedContent } from '../prompts';
import {
  sanitizeWithQuarantine,
  InjectionDetectedError,
  processUntrustedPageContent,
} from '../quarantine';
import {
  inspectElement,
  readConsole,
  readNetwork,
  readStorage,
  getAxTree,
  editElement,
  editStyles,
  liveEditScript,
  mockRequest,
  runInPage,
  trustedClick,
  trustedType,
  undoDevToolsEdit,
  devToolsStatus,
  devToolsDetach,
} from '../devtools/tools';
import { tabLockManager } from '../specialist/tab-lock';
import {
  delegateToSpecialist,
  checkSpecialist,
  awaitSpecialist,
  cancelSpecialist,
  rollbackSpecialistEdits,
} from '../specialist/tools';
import { validateAction } from '../action-validator';

export interface ToolExecutionContext {
  taskId: string;
  instruction: string;
  config: AgentEngineConfig;
  callbacks: AgentRunCallbacks;
  scopeDomains: string[];
  failedDomAttempts: number;
  resolveTabId: () => Promise<number>;
  setResolvedTabId: (id: number) => void;
  setFailedDomAttempts: (count: number) => void;
  autoSnapshotAfterAction: (tabId: number) => Promise<string>;
}

export class ToolDispatcher {
  public async execute(
    tool: ValidatedToolCall,
    ctx: ToolExecutionContext,
  ): Promise<string> {
    // Tab Lock check for mutating actions while a specialist holds T2 or T3
    const MUTATING_ACTIONS = new Set([
      'click_element',
      'type_text',
      'fill_form',
      'press_key',
      'select_option',
      'edit_element',
      'edit_styles',
      'live_edit_script',
      'mock_request',
      'run_in_page',
      'trusted_click',
      'trusted_type',
    ]);

    if (MUTATING_ACTIONS.has(tool.tool)) {
      try {
        const tabId = await ctx.resolveTabId();
        const lockCheck = tabLockManager.isLocked(tabId);
        if (lockCheck.locked && lockCheck.lock) {
          return `BLOCKED_BY_SPECIALIST: Tab #${tabId} is currently locked by specialist job "${lockCheck.lock.jobId}" (${lockCheck.lock.role}) holding tier ${lockCheck.lock.tier}. Mutating actions on this tab are suspended until the job completes. You may wait with await_specialist, cancel with cancel_specialist, or perform read-only actions.`;
        }
      } catch { /* ignore */ }
    }

    switch (tool.tool) {
      case 'web_search': {
        const result = await webSearch(tool.query, ctx.config.searchConfig);
        // Passive knowledge extraction (fire-and-forget, budget-checked)
        void extractAndStoreEntities(
          result,
          `search:${tool.query}`,
          ctx.config.providerConfig,
          ctx.config.model.id,
          { costLimits: ctx.config.costLimits },
        );
        return result;
      }

      case 'navigate_to': {
        // Finding 23: Run validateAction on navigate_to
        const val = await validateAction('navigate_to', tool.url, ctx.scopeDomains, ctx.taskId);
        if (val.riskLevel === 'block') {
          return `SECURITY_BLOCKED: Navigation to "${tool.url}" was blocked: ${val.reason}`;
        }
        if (val.riskLevel === 'warn') {
          const reason = `Confirm navigation outside initial domain scope: ${val.reason}`;
          ctx.callbacks.onStatusChange?.('hitl_waiting', reason);
          const hitlPromise = ctx.callbacks.onHITLRequired
            ? ctx.callbacks.onHITLRequired(tool, reason)
            : Promise.resolve(false);
          const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 120_000));
          const approved = await Promise.race([hitlPromise, timeoutPromise]);
          ctx.callbacks.onStatusChange?.('running');
          if (!approved) {
            return `SECURITY_BLOCKED: Navigation to "${tool.url}" was declined or timed out.`;
          }
        }

        if (ctx.config.initialHostname) {
          try {
            const destHost = new URL(tool.url).hostname;
            const allowedHost = ctx.config.initialHostname;
            if (destHost !== allowedHost && !destHost.endsWith(`.${allowedHost}`)) {
              return `TOOL_BLOCKED: Sub-agent is domain-locked to "${allowedHost}". Navigation to "${destHost}" was blocked.`;
            }
          } catch {
            return `TOOL_ERROR: Invalid navigation URL: "${tool.url}"`;
          }
        }

        const currentTabId = await ctx.resolveTabId();
        await fxNavigate(currentTabId);

        const tabId = await navigateTo(tool.url, tool.newTab);
        ctx.setResolvedTabId(tabId);
        // Finding 23: Keep 'visited' separate from 'allowed'; do NOT mutate ctx.scopeDomains!

        await waitForDOMSettle(tabId, 1000);
        return `Navigated successfully to: ${tool.url} (Active Tab ID: ${tabId}). The page is now loaded and ready. Next step: read_page or interact with the elements.`;
      }

      case 'read_page': {
        const tabId = await ctx.resolveTabId();
        await fxScan(tabId);
        await waitForDOMSettle(tabId, 500);

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const NOISE_SELECTORS = [
              'nav', 'header', 'footer', 'aside',
              '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
              '[role="complementary"]', '.cookie', '.gdpr', '.consent',
              '.ad', '.ads', '.advertisement', '.popup', '.modal-overlay',
              '#cookie-banner', '#consent', '.sidebar',
            ].join(',');

            const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'META', 'HEAD', 'SVG', 'CANVAS']);

            function isVisible(el: Element): boolean {
              if (typeof (el as HTMLElement).checkVisibility === 'function') {
                return (el as HTMLElement).checkVisibility();
              }
              const style = getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }

            const noiseEls = new Set<Element>();
            try {
              document.querySelectorAll(NOISE_SELECTORS).forEach((e) => noiseEls.add(e));
            } catch { /* ignore */ }

            function inNoise(el: Element): boolean {
              let cur: Element | null = el;
              while (cur) { if (noiseEls.has(cur)) return true; cur = cur.parentElement; }
              return false;
            }

            // Extract main text content via TreeWalker SHOW_TEXT with consecutive deduplication (Finding 21)
            const lines: string[] = [];
            let charBudget = 5000;
            let lastLine = '';

            const mainEl = document.querySelector('main, article, [role="main"], #content, #main, .content, .main') ?? document.body;
            const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT);
            let textNode = walker.nextNode();
            while (textNode && charBudget > 0) {
              const parent = textNode.parentElement;
              if (!parent || SKIP_TAGS.has(parent.tagName) || inNoise(parent) || !isVisible(parent)) {
                textNode = walker.nextNode();
                continue;
              }
              const t = (textNode.textContent || '').replace(/\s+/g, ' ').trim();
              if (t.length > 1 && t !== lastLine) {
                lastLine = t;
                const prefix = parent.tagName && /^H[1-6]$/.test(parent.tagName) ? `\n## ` : '';
                lines.push(`${prefix}${t}`);
                charBudget -= t.length;
              }
              textNode = walker.nextNode();
            }

            // Clear previous data-nim-id before tagging (Finding 21)
            try {
              document.querySelectorAll('[data-nim-id]').forEach((e) => e.removeAttribute('data-nim-id'));
            } catch { /* ignore */ }

            // Extract interactive elements with rich metadata up to 80 controls
            interface InteractiveEl { index: number; kind: string; meta: string; }
            const interactive: InteractiveEl[] = [];
            const interactiveQuery = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"]';
            const candidates = Array.from(document.querySelectorAll(interactiveQuery)).filter(isVisible);

            // Mind2Act Salience Ranking: prioritize inputs & primary action buttons over passive navigation links
            function getElementSalience(el: Element): number {
              let score = 0;
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || '';
              const type = (el as HTMLInputElement).type?.toLowerCase() || '';

              if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'button', 'submit'].includes(type))) {
                score += 100;
                if (type === 'search' || /search|query|find|msg|message|chat/i.test((el as HTMLInputElement).name || el.id || el.getAttribute('placeholder') || '')) {
                  score += 30;
                }
              } else if (tag === 'select' || type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'radio') {
                score += 85;
              } else if (tag === 'button' || role === 'button' || type === 'submit') {
                score += 70;
                const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
                if (/search|submit|login|sign in|send|direct|message|chat|next|play|confirm|buy|add/i.test(label)) {
                  score += 25;
                }
              } else if (role === 'tab' || role === 'menuitem') {
                score += 55;
              } else {
                score += 35;
                const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
                const href = (el as HTMLAnchorElement).href || '';
                if (/direct|message|chat|inbox|reels|profile|login|sign/i.test(label) || /direct|inbox|reels/i.test(href)) {
                  score += 30;
                }
              }

              try {
                const rect = el.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0 && rect.width > 0 && rect.height > 0) {
                  score += 40;
                }
              } catch { /* ignore */ }

              return score;
            }

            candidates.sort((a, b) => getElementSalience(b) - getElementSalience(a));

            let idx = 1;
            for (const el of candidates.slice(0, 80)) {
              // Finding 21: Keep nav/header/aside interactive controls; only skip cookie/ad banners
              if (el.closest('.cookie, .gdpr, .consent, .ad, .ads, .advertisement, #cookie-banner, #consent, #onetrust-banner-sdk')) continue;
              const tag = el.tagName.toLowerCase();
              const inputEl = el as HTMLInputElement;

              let label = el.getAttribute('aria-label') || '';
              if (!label && inputEl.id) {
                const labelEl = document.querySelector(`label[for="${inputEl.id}"]`);
                if (labelEl) label = labelEl.textContent?.trim() || '';
              }
              if (!label) {
                const parentLabel = el.closest('label');
                if (parentLabel) label = parentLabel.textContent?.trim() || '';
              }
              if (!label) {
                label = inputEl.placeholder || el.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('title') || '';
              }
              label = label.slice(0, 50);

              const parts: string[] = [];
              if (label) parts.push(`label="${label}"`);
              if (inputEl.name) parts.push(`name="${inputEl.name}"`);
              if (inputEl.required) parts.push('required');
              if (inputEl.value && tag === 'input' && inputEl.type !== 'password') {
                parts.push(`value="${inputEl.value.slice(0, 30)}"`);
              }
              if (tag === 'select') {
                const sel = el as HTMLSelectElement;
                const options = Array.from(sel.options).map(o => o.text.trim()).filter(Boolean).slice(0, 5);
                if (options.length > 0) parts.push(`options=[${options.map(o => `"${o}"`).join(',')}]`);
              }

              // Viewport position & occlusion check
              const rect = el.getBoundingClientRect();
              const inViewport = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
              if (inViewport) {
                parts.push('[in-viewport]');
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                if (cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight) {
                  const topEl = document.elementFromPoint(cx, cy);
                  if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
                    parts.push('[occluded]');
                  }
                }
              } else if (rect.top >= window.innerHeight) {
                parts.push('[below-fold]');
              } else if (rect.bottom <= 0) {
                parts.push('[above-fold]');
              }

              if ((el as HTMLButtonElement | HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') {
                parts.push('[disabled]');
              }

              const kind = tag === 'a' ? 'link' : tag === 'input' ? `input[${inputEl.type || 'text'}]` : tag;
              el.setAttribute('data-nim-id', String(idx));
              interactive.push({ index: idx, kind, meta: parts.join(' ') });
              idx++;
            }

            const links = Array.from(document.querySelectorAll('a[href]'))
              .filter(a => isVisible(a) && !inNoise(a))
              .slice(0, 10)
              .map(a => ({ text: a.textContent?.trim().slice(0, 40) || '', href: (a as HTMLAnchorElement).href }));

            const iframes = Array.from(document.querySelectorAll('iframe'))
              .filter(isVisible)
              .slice(0, 5)
              .map(f => {
                const title = f.getAttribute('title') || f.name || f.id || 'embedded-frame';
                let srcHost = 'same-origin';
                try { srcHost = new URL(f.src, window.location.href).hostname; } catch { /* ignore */ }
                return `${title} (${srcHost})`;
              });

            return {
              title: document.title,
              url: window.location.href,
              lang: document.documentElement.lang || 'en',
              content: lines.join('\n'),
              interactive,
              links,
              iframes,
            };
          },
        });

        const page = results[0]?.result;
        if (!page) return 'Page was empty or unreadable.';

        let processedContent = page.content;
        try {
          const processed = await processUntrustedPageContent(
            page.content,
            page.url,
            ctx.config.providerConfig,
            ctx.config.quarantineModelId ?? ctx.config.model.id,
          );
          processedContent = processed.content;
        } catch (err: unknown) {
          if (err instanceof InjectionDetectedError) {
            return `SECURITY_BLOCKED: Prompt injection detected on ${page.url}. ${err.details}`;
          }
          console.warn('Quarantine processing failed, falling back to demarcated raw content:', err);
          processedContent = wrapUntrustedContent(page.content, page.url);
        }

        const interactiveLines = page.interactive
          .map((e: { index: number; kind: string; meta: string }) => `  [${e.index}] ${e.kind} ${e.meta}`)
          .join('\n');

        const linkLines = page.links
          .filter((l: { text: string; href: string }) => l.text)
          .map((l: { text: string; href: string }) => `  - "${l.text}" → ${l.href}`)
          .join('\n');

        const iframeLines = (page.iframes || []).map((f: string) => `  - ${f}`).join('\n');

        let imagePrefix = '';
        if (
          ctx.config.model.supportsVision &&
          shouldUseFallbackVision(processedContent, ctx.failedDomAttempts, ctx.config.visionOptIn ?? false, true)
        ) {
          try {
            const dataUrl = await captureViewportWithMarks(tabId);
            imagePrefix = `[IMAGE_DATA:${dataUrl}] `;
          } catch {
            // ignore screenshot error
          }
        }

        const output = [
          `PAGE: "${wrapUntrustedContent(page.title, 'page:title')}" | ${page.url}`,
          `LANG: ${page.lang}`,
          `─────────────────────────────────`,
          `CONTENT:`,
          processedContent.trim() || '(no main text found)',
          `─────────────────────────────────`,
          `INTERACTIVE ELEMENTS (${page.interactive.length}) [Target with ID [1], [2], etc.]:`,
          interactiveLines || '  (none)',
          `─────────────────────────────────`,
          `LINKS (${page.links.length}):`,
          linkLines || '  (none)',
          page.iframes && page.iframes.length > 0
            ? `─────────────────────────────────\nEMBEDDED IFRAMES (${page.iframes.length}):\n${iframeLines}`
            : '',
        ].filter(Boolean).join('\n');

        void extractAndStoreEntities(
          page.content,
          page.url,
          ctx.config.providerConfig,
          ctx.config.model.id,
          { costLimits: ctx.config.costLimits },
        );

        return `${imagePrefix}${output}`;
      }

      case 'click_element': {
        const tabId = await ctx.resolveTabId();
        await fxGhostCursor(tabId, tool.target, `Clicking "${tool.target}"`);
        await fxClick(tabId, tool.target);

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (targetStr: string, destructiveKeywords: string[], coords?: { x: number; y: number }) => {
            let el: HTMLElement | null = null;
            if (coords) {
              el = document.elementFromPoint(coords.x, coords.y) as HTMLElement | null;
            }

            if (!el) {
              const trimmed = targetStr.trim();
              const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);

              if (numMatch) {
                el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
                if (!el) {
                  // Closed-Set Target Whitelisting:
                  // The agent specified a numeric element ID that does not exist on page.
                  const presentIds = Array.from(document.querySelectorAll<HTMLElement>('[data-nim-id]'))
                    .map((e) => e.getAttribute('data-nim-id'))
                    .filter((id): id is string => Boolean(id))
                    .slice(0, 30);
                  const availableMsg = presentIds.length > 0
                    ? `Available active element IDs are: [${presentIds.join(', ')}].`
                    : 'No numbered elements are currently active. Please use read_page to refresh the page state.';
                  return {
                    success: false,
                    error: `TARGET_NOT_FOUND: Element ID [${numMatch[1]}] does not exist on the current page. ${availableMsg} Please choose an active ID or a descriptive selector.`,
                  };
                }
              }
              if (!el) {
                try {
                  el = document.querySelector<HTMLElement>(trimmed);
                } catch { /* ignore */ }
              }
              if (!el) {
                const all = Array.from(document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary, [tabindex]:not([tabindex="-1"])'));
                const lower = trimmed.toLowerCase();
                el = all.find((e) =>
                  (e.textContent ?? '').toLowerCase().includes(lower) ||
                  (e.getAttribute('aria-label') ?? '').toLowerCase().includes(lower) ||
                  (e.getAttribute('title') ?? '').toLowerCase().includes(lower) ||
                  ((e as HTMLInputElement).placeholder ?? '').toLowerCase().includes(lower) ||
                  ((e as HTMLInputElement).name ?? '').toLowerCase().includes(lower)
                ) ?? null;
              }
              if (!el) {
                // Search SVGs, titles, and social media/Instagram icon containers
                const lower = trimmed.toLowerCase();
                const svgs = Array.from(document.querySelectorAll<SVGElement>('svg'));
                for (const s of svgs) {
                  const aria = (s.getAttribute('aria-label') || '').toLowerCase();
                  const title = (s.querySelector('title')?.textContent || '').toLowerCase();
                  if (aria.includes(lower) || title.includes(lower) || (lower.includes('direct') && aria.includes('direct')) || (lower.includes('message') && (aria.includes('direct') || aria.includes('message')))) {
                    el = (s.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], div') as HTMLElement | null) || (s as unknown as HTMLElement);
                    if (el) break;
                  }
                }
              }
              if (!el && (/direct|message|chat|inbox/i.test(trimmed))) {
                const msgLink = document.querySelector<HTMLElement>('a[href*="/direct/"], a[href*="/messages/"], a[href*="/inbox/"], [aria-label*="Direct" i], [aria-label*="Messages" i]');
                if (msgLink) el = msgLink;
              }
            }

            if (!el) return { success: false, error: `Could not locate element: "${targetStr}"` };

            const container = el.closest('button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary, [tabindex]:not([tabindex="-1"])') as HTMLElement | null;
            if (container) {
              el = container;
            }

            if ((el as HTMLButtonElement | HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') {
              return { success: false, error: `ELEMENT_DISABLED: Element <${el.tagName.toLowerCase()}> is disabled or aria-disabled="true".` };
            }

            const fingerprint = {
              tag: el.tagName.toLowerCase(),
              normalizedText: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
              ariaLabel: el.getAttribute('aria-label') || '',
              role: el.getAttribute('role') || '',
              href: (el as HTMLAnchorElement).href || (el.getAttribute('href') || ''),
              name: (el as HTMLInputElement).name || '',
              nimId: el.getAttribute('data-nim-id') || '',
            };

            const searchIn = [
              fingerprint.normalizedText,
              fingerprint.ariaLabel,
              el.getAttribute('title') || '',
              (el.getAttribute('value') || ''),
              fingerprint.name,
              fingerprint.role,
              el.className || '',
            ].join(' ').toLowerCase();

            const isDestructive = destructiveKeywords.some((keyword) => searchIn.includes(keyword));

            if (isDestructive) {
              return {
                success: false,
                needsApproval: true,
                searchText: searchIn.slice(0, 100),
                fingerprint,
                error: 'Destructive action detected',
              };
            }

            try {
              el.scrollIntoView({ block: 'center', inline: 'center' });
            } catch { /* fallback */ }

            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
                window.scrollBy(0, -90);
              }
            }

            el.focus();

            if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
              if (el.type === 'checkbox') el.checked = !el.checked;
              else el.checked = true;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            el.click();

            return { success: true };
          },
          args: [tool.target, [...DESTRUCTIVE_KEYWORDS], tool.coordinates],
        });

        const res = results[0]?.result;
        if (!res?.success) {
          if (res?.needsApproval) {
            const reason = `Clicking this element may perform a destructive action. Text/labels: "${res.searchText}"`;
            ctx.callbacks.onStatusChange?.('hitl_waiting', reason);

            const hitlPromise = ctx.callbacks.onHITLRequired
              ? ctx.callbacks.onHITLRequired(tool, reason)
              : Promise.resolve(false);

            const timeoutPromise = new Promise<boolean>((resolve) => {
              setTimeout(() => resolve(false), 120_000);
            });

            const approved = await Promise.race([hitlPromise, timeoutPromise]);
            if (!approved) {
              ctx.callbacks.onStatusChange?.('running');
              return 'SECURITY_BLOCKED: Destructive click action was declined or timed out waiting for approval.';
            }
            ctx.callbacks.onStatusChange?.('running');

            const approvedResults = await chrome.scripting.executeScript({
              target: { tabId },
              func: (
                targetStr: string,
                expectedFingerprint?: {
                  tag: string;
                  normalizedText: string;
                  ariaLabel: string;
                  role: string;
                  href: string;
                  name: string;
                  nimId: string;
                },
                coords?: { x: number; y: number },
              ) => {
                let el: HTMLElement | null = null;
                // Finding 19: Honor coordinates on resume after approval
                if (coords) {
                  el = document.elementFromPoint(coords.x, coords.y) as HTMLElement | null;
                }

                if (!el) {
                  const trimmed = targetStr.trim();
                  const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
                  if (numMatch) {
                    el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
                    if (!el) {
                      return { success: false, error: `TARGET_NOT_FOUND: Element ID [${numMatch[1]}] is not present on the current page.` };
                    }
                  }
                  if (!el) {
                    try {
                      el = document.querySelector<HTMLElement>(trimmed);
                    } catch { /* ignore */ }
                  }
                  if (!el) {
                    const all = Array.from(document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])'));
                    const lower = trimmed.toLowerCase();
                    el = all.find((e) =>
                      (e.textContent ?? '').toLowerCase().includes(lower) ||
                      (e.getAttribute('aria-label') ?? '').toLowerCase().includes(lower) ||
                      (e.getAttribute('title') ?? '').toLowerCase().includes(lower) ||
                      ((e as HTMLInputElement).placeholder ?? '').toLowerCase().includes(lower) ||
                      ((e as HTMLInputElement).name ?? '').toLowerCase().includes(lower)
                    ) ?? null;
                  }
                }

                if (!el) return { success: false, error: `Could not locate element: "${targetStr}"` };

                const container = el.closest('button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary, [tabindex]:not([tabindex="-1"])') as HTMLElement | null;
                if (container) {
                  el = container;
                }

                // Finding 19: Strong TOCTOU verification
                if (expectedFingerprint) {
                  const currentFingerprint = {
                    tag: el.tagName.toLowerCase(),
                    normalizedText: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                    ariaLabel: el.getAttribute('aria-label') || '',
                    role: el.getAttribute('role') || '',
                    href: (el as HTMLAnchorElement).href || (el.getAttribute('href') || ''),
                    name: (el as HTMLInputElement).name || '',
                    nimId: el.getAttribute('data-nim-id') || '',
                  };

                  if (currentFingerprint.tag !== expectedFingerprint.tag) {
                    return {
                      success: false,
                      error: `TOCTOU_MISMATCH: Page element type shifted from <${expectedFingerprint.tag}> to <${currentFingerprint.tag}> during approval. Click aborted for safety.`,
                    };
                  }
                  if (expectedFingerprint.href && currentFingerprint.href && currentFingerprint.href !== expectedFingerprint.href) {
                    return {
                      success: false,
                      error: `TOCTOU_MISMATCH: Link destination shifted from "${expectedFingerprint.href}" to "${currentFingerprint.href}" during approval. Click aborted for safety.`,
                    };
                  }
                  if (expectedFingerprint.nimId && currentFingerprint.nimId && currentFingerprint.nimId !== expectedFingerprint.nimId) {
                    return {
                      success: false,
                      error: `TOCTOU_MISMATCH: Element ID shifted from [${expectedFingerprint.nimId}] to [${currentFingerprint.nimId}] during approval. Click aborted for safety.`,
                    };
                  }
                  if (expectedFingerprint.normalizedText && currentFingerprint.normalizedText) {
                    const textMatches =
                      currentFingerprint.normalizedText === expectedFingerprint.normalizedText ||
                      currentFingerprint.normalizedText.includes(expectedFingerprint.normalizedText) ||
                      expectedFingerprint.normalizedText.includes(currentFingerprint.normalizedText);

                    if (!textMatches && expectedFingerprint.ariaLabel && currentFingerprint.ariaLabel !== expectedFingerprint.ariaLabel) {
                      return {
                        success: false,
                        error: `TOCTOU_MISMATCH: Page content shifted during approval (expected: "${expectedFingerprint.normalizedText}", got: "${currentFingerprint.normalizedText}"). Click aborted for safety.`,
                      };
                    }
                  }
                }

                try {
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                } catch { /* fallback */ }

                el.focus();

                if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
                  if (el.type === 'checkbox') el.checked = !el.checked;
                  else el.checked = true;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }

                el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                el.click();

                return { success: true };
              },
              args: [tool.target, res?.fingerprint, tool.coordinates],
            });

            const approvedRes = approvedResults[0]?.result;
            if (!approvedRes?.success) return `Failed: ${approvedRes?.error}`;
          } else {
            // Visual Grounding Fallback: If DOM selector failed and active model supports vision
            if (ctx.config.model.supportsVision && res?.error?.includes('Could not locate element')) {
              try {
                const somDataUrl = await captureViewportWithMarks(tabId);
                const somPrompt = `You are a visual grounding specialist for browser automation.
The user wants to click: "${tool.target}".
In the attached webpage screenshot annotated with Set-of-Marks numbered badges:
1. Locate the element matching "${tool.target}" (e.g. navigation icon, Direct/Messages, Reels, or button).
2. If it has a numbered badge, reply with JSON: {"badge": <number>}
3. If no badge is directly on it, return its normalized coordinates: {"x": <0-100>, "y": <0-100>}
Respond ONLY with valid JSON.`;

                const vRes = await chatCompletion(ctx.config.providerConfig, {
                  model: ctx.config.model.id,
                  messages: [
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: somPrompt },
                        { type: 'image_url', image_url: { url: somDataUrl, detail: 'high' } },
                      ],
                    },
                  ],
                  max_tokens: 150,
                  temperature: 0.1,
                });

                const rawJson = vRes.choices[0]?.message?.content || '{}';
                const match = rawJson.match(/\{[\s\S]*?\}/);
                if (match) {
                  const parsed = JSON.parse(match[0]);
                  if (typeof parsed.badge === 'number') {
                    const badgeTgt = `[data-nim-id="${parsed.badge}"]`;
                    await fxClick(tabId, badgeTgt);
                    await chrome.scripting.executeScript({
                      target: { tabId },
                      func: (sel: string) => {
                        const targetEl = document.querySelector<HTMLElement>(sel);
                        targetEl?.click();
                      },
                      args: [badgeTgt],
                    });
                    const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
                    return `[Visual Grounding Fallback]: Located "${tool.target}" visually at badge [${parsed.badge}] and clicked successfully.${freshSnapshot}`;
                  } else if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
                    await chrome.scripting.executeScript({
                      target: { tabId },
                      func: (normX: number, normY: number) => {
                        const pixelX = Math.round((normX / 100) * window.innerWidth);
                        const pixelY = Math.round((normY / 100) * window.innerHeight);
                        const clicked = document.elementFromPoint(pixelX, pixelY) as HTMLElement | null;
                        const container = clicked?.closest('button, a, [role="button"], [tabindex]') as HTMLElement | null;
                        (container || clicked)?.click();
                      },
                      args: [parsed.x, parsed.y],
                    });
                    const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
                    return `[Visual Grounding Fallback]: Located "${tool.target}" visually at coordinates (${parsed.x}%, ${parsed.y}%) and clicked successfully.${freshSnapshot}`;
                  }
                }
              } catch {
                // If visual grounding fails, return original error
              }
            }
            return `Failed: ${res?.error}`;
          }
        }

        const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
        return `Clicked element "${tool.target}".${freshSnapshot}`;
      }

      case 'type_text': {
        if (ctx.config.isAutonomous && !ctx.config.allowSending) {
          const reason = `Autonomous task is attempting outbound text entry: "${tool.value.slice(0, 50)}"`;
          if (ctx.callbacks.onHITLRequired) {
            const approved = await ctx.callbacks.onHITLRequired(tool, reason);
            if (!approved) {
              return 'SECURITY_BLOCKED: Outbound text entry was declined by user during autonomous task.';
            }
          }
        }
        const tabId = await ctx.resolveTabId();
        await fxGhostCursor(tabId, tool.target, `Typing "${tool.value.slice(0, 20)}"`);
        await fxType(tabId, tool.target);

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (
            targetStr: string,
            textToType: string,
            submitWithEnter?: boolean,
            mode?: 'replace' | 'append' | 'prepend',
            sensitivePatternSources?: string[],
          ) => {
            const trimmed = targetStr.trim();
            const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
            let el: HTMLElement | null = null;

            if (numMatch) {
              el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
              if (!el) {
                const presentInputs = Array.from(document.querySelectorAll<HTMLElement>('input[data-nim-id], textarea[data-nim-id], [contenteditable="true"][data-nim-id]'))
                  .map((e) => `[${e.getAttribute('data-nim-id')}] (${(e as HTMLInputElement).type || e.tagName.toLowerCase()})`)
                  .slice(0, 20);
                const availMsg = presentInputs.length > 0
                  ? `Available input IDs are: ${presentInputs.join(', ')}.`
                  : 'No numbered input elements found. Please use read_page to refresh.';
                return {
                  success: false,
                  error: `TARGET_NOT_FOUND: Input element ID [${numMatch[1]}] does not exist on the current page. ${availMsg} Please pick an existing input ID.`,
                };
              }
            }
            if (!el) {
              try {
                el = document.querySelector<HTMLElement>(trimmed);
              } catch { /* ignore */ }
            }
            if (!el) {
              const all = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"]'));
              const lower = trimmed.toLowerCase();
              el = all.find((e) =>
                ((e as HTMLInputElement).placeholder || (e as HTMLElement).getAttribute('aria-label') || (e as HTMLInputElement).name || '')
                  .toLowerCase()
                  .includes(lower),
              ) ?? null;
            }

            if (!el) return { success: false, error: `Could not locate input element: "${targetStr}"` };

            const inputEl = el as HTMLInputElement;
            const searchIn = [
              inputEl.type,
              inputEl.name,
              inputEl.id,
              inputEl.placeholder,
              inputEl.getAttribute('aria-label') || '',
              inputEl.getAttribute('autocomplete') || '',
              inputEl.className || '',
            ].join(' ').toLowerCase();

            // Finding 20: Centralized sensitive field patterns
            const patterns = (sensitivePatternSources || []).map((s) => new RegExp(s, 'i'));
            if (inputEl.type === 'password' || patterns.some((p) => p.test(searchIn))) {
              return { success: false, error: 'SECURITY_BLOCKED: Refusing to auto-fill a sensitive field (password / payment / SSN)' };
            }

            try {
              el.scrollIntoView({ block: 'center', inline: 'center' });
            } catch { /* fallback */ }

            el.focus();

            const firstChar = textToType.slice(-1) || 'a';
            el.dispatchEvent(new KeyboardEvent('keydown', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true }));

            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              let finalVal = textToType;
              if (mode === 'append') {
                finalVal = (el.value || '') + textToType;
              } else if (mode === 'prepend') {
                finalVal = textToType + (el.value || '');
              } else {
                el.value = '';
              }

              const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (nativeSetter) {
                nativeSetter.call(el, finalVal);
              } else {
                el.value = finalVal;
              }

              try {
                el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: textToType }));
              } catch {
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              el.dispatchEvent(new KeyboardEvent('keyup', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el.isContentEditable) {
              if (mode !== 'append') {
                document.execCommand('selectAll', false);
              }
              document.execCommand('insertText', false, textToType);
              el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: textToType }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true }));
            } else {
              return { success: false, error: 'Target was not a supported input or textarea' };
            }

            if (submitWithEnter) {
              const enterProps = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
              const enterKeydown = new KeyboardEvent('keydown', enterProps);
              const dispatched = el.dispatchEvent(enterKeydown);
              el.dispatchEvent(new KeyboardEvent('keypress', enterProps));
              el.dispatchEvent(new KeyboardEvent('keyup', enterProps));
              const form = (el as HTMLInputElement).form || el.closest('form');
              if (form && dispatched && !enterKeydown.defaultPrevented) {
                if (typeof form.requestSubmit === 'function') {
                  try { form.requestSubmit(); } catch { /* ignore */ }
                }
              }
            }

            return { success: true };
          },
          args: [tool.target, tool.value, tool.submitWithEnter, tool.mode, SENSITIVE_FIELD_PATTERNS.map((p) => p.source)],
        });

        const res = results[0]?.result;
        if (!res?.success) return `Failed: ${res?.error}`;

        const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
        const submitSuffix = tool.submitWithEnter ? ' and submitted form with Enter' : '';
        return `Typed "${tool.value}" into "${tool.target}"${submitSuffix}.${freshSnapshot}`;
      }

      case 'select_option': {
        const tabId = await ctx.resolveTabId();

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (targetStr: string, optValue: string) => {
            const trimmed = targetStr.trim();
            const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
            let el: HTMLElement | null = null;

            if (numMatch) {
              el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
              if (!el) {
                return {
                  success: false,
                  error: `TARGET_NOT_FOUND: Dropdown element ID [${numMatch[1]}] does not exist on the current page. Please use read_page or choose an active dropdown ID.`,
                };
              }
            }
            if (!el) {
              try { el = document.querySelector<HTMLElement>(trimmed); } catch { /* ignore */ }
            }
            if (!el) {
              const all = Array.from(document.querySelectorAll<HTMLElement>('select, [role="combobox"], [role="listbox"]'));
              el = all.find(e => (e.getAttribute('aria-label') || (e as HTMLSelectElement).name || '').toLowerCase().includes(trimmed.toLowerCase())) ?? null;
            }

            if (!el) return { success: false, error: `Could not find dropdown: "${targetStr}"` };

            try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* fallback */ }
            el.focus();

            if (el instanceof HTMLSelectElement) {
              const lower = optValue.toLowerCase().trim();
              let matchedIndex = -1;

              // Finding 22: Pass 1 — exact value or exact text match
              for (let i = 0; i < el.options.length; i++) {
                const opt = el.options[i];
                if (opt.value.toLowerCase() === lower || opt.text.toLowerCase().trim() === lower) {
                  matchedIndex = i;
                  break;
                }
              }

              // Finding 22: Pass 2 — partial substring fallback only if no exact match
              if (matchedIndex === -1) {
                for (let i = 0; i < el.options.length; i++) {
                  const opt = el.options[i];
                  if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
                    matchedIndex = i;
                    break;
                  }
                }
              }
              if (matchedIndex === -1) {
                const available = Array.from(el.options).map(o => `"${o.text}"`).slice(0, 6).join(', ');
                return { success: false, error: `Option "${optValue}" not found. Available: [${available}]` };
              }
              el.selectedIndex = matchedIndex;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true };
            }

            return { success: false, error: 'Target is not a standard <select> element' };
          },
          args: [tool.target, tool.option],
        });

        const res = results[0]?.result;
        if (!res?.success) return `Failed: ${res?.error}`;

        const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
        return `Selected option "${tool.option}" on "${tool.target}".${freshSnapshot}`;
      }

      case 'press_key': {
        if (ctx.config.isAutonomous && !ctx.config.allowSending && (tool.key.toLowerCase() === 'enter' || tool.key.toLowerCase() === 'return')) {
          const reason = `Autonomous task is attempting outbound submission via "${tool.key}" keypress.`;
          if (ctx.callbacks.onHITLRequired) {
            const approved = await ctx.callbacks.onHITLRequired(tool, reason);
            if (!approved) {
              return 'SECURITY_BLOCKED: Outbound submission keypress was declined by user during autonomous task.';
            }
          }
        }
        const tabId = await ctx.resolveTabId();

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (keyName: string, targetStr?: string): { success: boolean; error?: string } => {
            let el: HTMLElement | null = null;
            if (targetStr) {
              const trimmed = targetStr.trim();
              const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
              if (numMatch) {
                el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
                if (!el) {
                  return {
                    success: false,
                    error: `TARGET_NOT_FOUND: Element ID [${numMatch[1]}] does not exist on the current page for press_key.`,
                  };
                }
              }
              if (!el) {
                try { el = document.querySelector<HTMLElement>(trimmed); } catch { /* ignore */ }
              }
            }
            if (!el) el = (document.activeElement as HTMLElement) || document.body;

            el.focus();

            const keyLower = keyName.toLowerCase();
            const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
              enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
              tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
              escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
              esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
              arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
              down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
              arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
              up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
            };

            const info = keyMap[keyLower] || { key: keyName, code: `Key${keyName.toUpperCase()}`, keyCode: keyName.charCodeAt(0) };
            const props = { key: info.key, code: info.code, keyCode: info.keyCode, which: info.keyCode, bubbles: true, cancelable: true };

            // Finding 20: Eliminate double-submit on Enter keydown + form submit
            const keydownEvt = new KeyboardEvent('keydown', props);
            const dispatched = el.dispatchEvent(keydownEvt);
            el.dispatchEvent(new KeyboardEvent('keypress', props));
            el.dispatchEvent(new KeyboardEvent('keyup', props));

            if (info.key === 'Enter' && el instanceof HTMLInputElement && el.form && dispatched && !keydownEvt.defaultPrevented) {
              if (typeof el.form.requestSubmit === 'function') {
                try { el.form.requestSubmit(); } catch { /* ignore */ }
              }
            }

            return { success: true };
          },
          args: [tool.key, tool.target],
        });

        const res = results[0]?.result;
        if (!res?.success) return `Failed: ${res?.error}`;

        const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
        return `Pressed "${tool.key}".${freshSnapshot}`;
      }

      case 'wait_for': {
        const tabId = await ctx.resolveTabId();
        const waitRes = await waitForSelector(tabId, tool.selector, tool.state ?? 'visible', tool.timeoutMs ?? 5000);
        return waitRes.success
          ? `Successfully waited for "${tool.selector}" to be ${tool.state ?? 'visible'}.`
          : `Wait failed: ${waitRes.error}`;
      }

      case 'scroll_page': {
        const tabId = await ctx.resolveTabId();
        await fxScroll(tabId, tool.direction);

        await chrome.scripting.executeScript({
          target: { tabId },
          func: (dir: string, px?: number) => {
            const amount = px ?? window.innerHeight * 0.8;
            const delta = dir === 'down' ? amount : -amount;

            // Finding 22: Support inner scroll containers (e.g. modals, chat feeds, main panels)
            let targetContainer: HTMLElement | null = null;
            const active = document.activeElement as HTMLElement | null;
            if (active && active !== document.body) {
              let cur: HTMLElement | null = active;
              while (cur && cur !== document.body) {
                const style = window.getComputedStyle(cur);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight + 20) {
                  targetContainer = cur;
                  break;
                }
                cur = cur.parentElement;
              }
            }

            if (!targetContainer) {
              const scrollables = Array.from(document.querySelectorAll<HTMLElement>(
                'main, [role="main"], [role="feed"], #pane-side, .scrollable, section'
              )).filter(el => {
                const style = window.getComputedStyle(el);
                return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40;
              });
              if (scrollables.length > 0) {
                scrollables.sort((a, b) => (b.clientHeight * b.clientWidth) - (a.clientHeight * a.clientWidth));
                targetContainer = scrollables[0];
              }
            }

            window.scrollBy({ top: delta, behavior: 'smooth' });
            if (targetContainer) {
              targetContainer.scrollBy({ top: delta, behavior: 'smooth' });
            }
          },
          args: [tool.direction, tool.pixels],
        });

        await new Promise((r) => setTimeout(r, 400));
        const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
        return `Scrolled page ${tool.direction}.${freshSnapshot}`;
      }

      case 'summarize': {
        const tabId = await ctx.resolveTabId();
        let pageText = '';
        let tabInfo: chrome.tabs.Tab | undefined;

        if (tabId) {
          try {
            tabInfo = await chrome.tabs.get(tabId);
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => document.body.innerText.slice(0, 10000),
            });
            pageText = results[0]?.result ?? '';
          } catch {
            // ignore
          }
        }

        const summary = await summarizeContent(
          pageText || ctx.instruction,
          tool.focus,
          ctx.config.providerConfig,
          ctx.config.quarantineModelId ?? ctx.config.model.id,
        );

        await appendResearchNote({
          sourceUrl: tabInfo?.url ?? '',
          sourceTitle: tabInfo?.title ?? 'Web Page Summary',
          summary,
        });

        return `Summary generated and saved to Research Notes:\n${summary}`;
      }

      case 'list_tabs': {
        const tabs = await listTabs();
        const formatted = tabs
          .map((t) => `  - [Tab ID ${t.id}] "${t.title}" (${t.url})${t.active ? ' [ACTIVE]' : ''}`)
          .join('\n');
        return `OPEN BROWSER TABS (${tabs.length}):\n${formatted || '  (none)'}`;
      }

      case 'switch_tab': {
        const res = await switchTab(tool.tabId);
        return res.success
          ? `Switched active tab to: "${res.tab?.title}" (${res.tab?.url})`
          : `Failed to switch tab: ${res.error}`;
      }

      case 'close_tab': {
        const res = await closeTab(tool.tabId);
        return res.success ? 'Tab closed successfully.' : `Failed to close tab: ${res.error}`;
      }

      case 'extract_table': {
        const tabId = await ctx.resolveTabId();
        const res = await extractTableFromPage(tabId, tool.selector);
        if ('error' in res) return `Table extraction error: ${res.error}`;

        const tabInfo = await chrome.tabs.get(tabId);
        const pageUrl = tabInfo.url ?? 'unknown';

        let sanitizedCsv = res.csv;
        try {
          // Finding 24: Use sanitized output and fail closed on quarantine errors
          const proc = await processUntrustedPageContent(
            res.csv,
            pageUrl,
            ctx.config.providerConfig,
            ctx.config.quarantineModelId ?? ctx.config.model.id,
          );
          sanitizedCsv = proc.content;
        } catch (err: unknown) {
          if (err instanceof InjectionDetectedError) {
            return `SECURITY_BLOCKED: Prompt injection detected in table data from ${pageUrl}. ${err.details}`;
          }
          // Fail closed on quarantine processing error
          return `SECURITY_BLOCKED: Table quarantine check failed from ${pageUrl}: ${(err as Error).message}`;
        }

        const tableOutput = `EXTRACTED TABLE (${res.rowCount} rows):\nHeaders: ${res.headers.join(', ')}\n\nCSV DATA:\n${sanitizedCsv}`;
        return wrapUntrustedContent(tableOutput, pageUrl);
      }

      case 'parallel_research': {
        const workerProvider = ctx.config.workerProviderConfig || ctx.config.providerConfig;
        const workerModel = ctx.config.workerModel || ctx.config.model;

        const checked = await Promise.all(
          tool.tasks.map(async (t) => {
            const check = await validateAction('navigate_to', t.url, ctx.scopeDomains, ctx.taskId);
            return { task: t, check };
          }),
        );

        const blocked = checked.filter((c) => c.check.riskLevel === 'block');
        const needsApproval = checked.filter((c) => c.check.riskLevel === 'warn');
        const allowed = checked.filter((c) => c.check.riskLevel === 'safe').map((c) => c.task);

        if (blocked.length > 0) {
          const blockedUrls = blocked.map((b) => b.task.url).join(', ');
          const blockedMsg = `SECURITY_BLOCKED: ${blocked.length} task(s) blocked (out of scope or high-risk): ${blockedUrls}`;
          ctx.callbacks.onStep?.(0, blockedMsg, tool);

          if (blocked.length === tool.tasks.length) {
            return blockedMsg;
          }
        }

        for (const item of needsApproval) {
          ctx.callbacks.onStatusChange?.('hitl_waiting', item.check.reason);

          const hitlPromise = ctx.callbacks.onHITLRequired
            ? ctx.callbacks.onHITLRequired({ tool: 'navigate_to', url: item.task.url }, item.check.reason)
            : Promise.resolve(false);

          const timeoutPromise = new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), 120_000);
          });

          const approved = await Promise.race([hitlPromise, timeoutPromise]);
          if (approved) {
            allowed.push(item.task);
          }
          ctx.callbacks.onStatusChange?.('running');
        }

        if (allowed.length === 0) {
          return 'All parallel_research tasks were blocked or declined. No research was performed.';
        }

        ctx.callbacks.onStep?.(
          0,
          `Launching ${allowed.length} worker sub-agents in parallel background tabs...`,
          tool,
        );

        const subagentRun = await executeParallelSubagents(allowed, {
          workerProviderConfig: workerProvider,
          workerModel,
          parentTaskId: ctx.taskId,
          costLimits: ctx.config.costLimits,
          onProgress: (taskName, status, detail) => {
            ctx.callbacks.onStep?.(0, `[Sub-Agent: ${taskName}] ${detail || status}`, undefined);
          },
        });

        let finalReport = subagentRun.formattedReport;
        if (blocked.length > 0) {
          const blockedList = blocked.map((b) => `- ${b.task.name} (${b.task.url}): ${b.check.reason}`).join('\n');
          finalReport = `${finalReport}\n\n**Blocked Tasks:**\n${blockedList}`;
        }

        return finalReport;
      }

      case 'recall_session_history': {
        return await recallSessionHistory(ctx.taskId, tool.query, tool.last_n);
      }

      case 'fill_form': {
        const tabId = await ctx.resolveTabId();
        await fxScan(tabId);
        const fillResult = await executeBatchFormFill(
          tabId,
          tool.fields,
          tool.submitAfter,
          tool.submitTarget,
        );
        const report = formatBatchFillResult(fillResult);
        const freshSnapshot = await ctx.autoSnapshotAfterAction(tabId);
        return `${report}${freshSnapshot}`;
      }

      case 'export_data': {
        const exportResult = await exportDataToFile({
          format: tool.format,
          filename: tool.filename,
          content: tool.content,
          source: tool.source,
        });
        return formatExportResult(exportResult);
      }

      case 'eval_page_script': {
        const tabId = await ctx.resolveTabId();
        const inspected = await inspectPageState(tabId, tool.target, tool.customPath);
        return formatInspectedState(inspected);
      }

      case 'scratchpad_write': {
        return await executeScratchpadWrite(tool.key, tool.value, tool.notes);
      }

      case 'scratchpad_read': {
        return await executeScratchpadRead(tool.key);
      }

      case 'create_watch': {
        return await executeCreateWatch({
          name: tool.name,
          url: tool.url,
          type: tool.type,
          selector: tool.selector,
          conditionPrompt: tool.conditionPrompt,
          intervalSeconds: tool.intervalSeconds,
          intervalMinutes: tool.intervalMinutes,
        });
      }

      case 'list_watches': {
        return await executeListWatches();
      }

      case 'delete_watch': {
        return await executeDeleteWatch(tool.watchId);
      }

      case 'workspace_create_file': {
        return await executeWorkspaceCreateFile(tool.path, tool.content, tool.tags, tool.overwrite);
      }

      case 'workspace_append_file': {
        return await executeWorkspaceAppendFile(tool.path, tool.text);
      }

      case 'workspace_read_file': {
        return await executeWorkspaceReadFile(tool.path);
      }

      case 'workspace_list_files': {
        return await executeWorkspaceListFiles(tool.directory, tool.recursive);
      }

      case 'workspace_delete_file': {
        return await executeWorkspaceDeleteFile(tool.path, tool.permanent);
      }

      case 'workspace_search': {
        return await executeWorkspaceSearch(tool.query);
      }

      case 'observe_page': {
        const tabId = await ctx.resolveTabId();
        const affordances = await observePage(tabId, tool.maxAffordances);
        const summary = formatAffordances(affordances);
        return wrapUntrustedContent(summary, affordances.url);
      }

      case 'act_on_element': {
        const tabId = await ctx.resolveTabId();
        await fxGhostCursor(tabId, tool.target, `${tool.action} "${tool.target}"`);
        const res = await actOnElement(tabId, {
          action: tool.action,
          target: tool.target,
          value: tool.value,
          option: tool.option,
          key: tool.key,
          direction: tool.direction,
          submitWithEnter: tool.submitWithEnter,
          coordinates: tool.coordinates,
        });
        if (!res.success) {
          return `Action failed: ${res.error || res.details}`;
        }
        return `Action succeeded: ${res.details} (Current URL: ${res.resultingUrl})`;
      }

      case 'extract_data': {
        const tabId = await ctx.resolveTabId();
        const tab = await chrome.tabs.get(tabId);
        const pageUrl = tab.url || 'unknown';
        const res = await extractStructuredData(tabId, {
          fields: tool.fields,
          containerSelector: tool.containerSelector,
          maxItems: tool.maxItems,
        });
        const summary = `EXTRACTED DATA (${res.totalFound} items matching [${tool.fields.join(', ')}]):\n\nCSV FORMAT:\n${res.csv}`;
        void extractAndStoreEntities(
          summary,
          pageUrl,
          ctx.config.providerConfig,
          ctx.config.model.id,
          { costLimits: ctx.config.costLimits },
        );
        return wrapUntrustedContent(summary, pageUrl);
      }

      case 'knowledge_graph_query': {
        return executeKnowledgeGraphQuery({
          keyword: tool.keyword,
          maxNodes: tool.maxNodes,
        });
      }

      case 'knowledge_graph_add': {
        return executeKnowledgeGraphAdd({
          label: tool.label,
          type: tool.type,
          attributes: tool.attributes as Record<string, string> | undefined,
          sourceUrl: tool.sourceUrl,
        });
      }

      case 'knowledge_graph_relate': {
        return executeKnowledgeGraphRelate({
          fromLabel: tool.fromLabel,
          fromType: tool.fromType,
          relation: tool.relation,
          toLabel: tool.toLabel,
          toType: tool.toType,
        });
      }

      case 'swarm_research': {
        ctx.callbacks.onStatusChange?.('running', `🕸️ Launching parallel research swarm for: "${tool.topic}"…`);
        const swarmResult = await runSwarm({
          topic: tool.topic,
          providerConfig: ctx.config.providerConfig,
          model: ctx.config.model,
          workerModel: ctx.config.workerModel,
          maxWorkers: tool.maxWorkers ?? 3,
          workerTimeoutMs: 30_000,
        });
        const workerSummary = swarmResult.subResults
          .map((r) => `• **${r.name}** (${r.url}): ${r.error ? `❌ ${r.error}` : '✅ completed'}`)
          .join('\n');
        return `## 🕸️ Swarm Research: "${swarmResult.topic}"\n\n**Sources checked:**\n${workerSummary}\n\n**Duration:** ${(swarmResult.durationMs / 1000).toFixed(1)}s\n\n---\n\n${swarmResult.synthesis}`;
      }

      case 'screenshot': {
        if (!ctx.config.model.supportsVision) {
          return `TOOL_ERROR: The active model "${ctx.config.model.id}" does not support image or multimodal vision inputs. To inspect visuals or capture screenshots, please switch to a vision-capable model (e.g. meta/llama-3.2-11b-vision-instruct, gemini-2.0-flash, or gpt-4o) in Settings.`;
        }

        const tabId = await ctx.resolveTabId();
        await fxFlash(tabId);
        let dataUrl: string;
        if (tool.annotateWithMarks !== false) {
          dataUrl = await captureViewportWithMarks(tabId);
        } else {
          dataUrl = await captureViewport();
        }

        return `[IMAGE_DATA:${dataUrl}] Viewport screenshot captured successfully. Reason: ${tool.reason}`;
      }

      case 'visual_inspect': {
        const tabId = await ctx.resolveTabId();
        await fxScan(tabId);

        // If the active model does NOT support vision: fallback to inspecting DOM accessibility and badges
        if (!ctx.config.model.supportsVision) {
          const domAnalysis = await chrome.scripting.executeScript({
            target: { tabId },
            func: (queryText: string) => {
              const lower = queryText.toLowerCase();
              const indicators: string[] = [];

              const badgeSelectors = [
                '[aria-label*="unread" i]',
                '[aria-label*="notification" i]',
                '[aria-label*="new message" i]',
                '[aria-label*="direct" i]',
                '[class*="badge" i]',
                '[class*="unread" i]',
                '[class*="notification" i]',
                '[class*="dot" i]',
                '[data-badge]',
              ];

              for (const sel of badgeSelectors) {
                const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
                for (const el of els) {
                  const text = (el.textContent || '').trim();
                  const aria = el.getAttribute('aria-label') || '';
                  indicators.push(`• Found badge element matching "${sel}": text="${text}", aria-label="${aria}"`);
                }
              }

              const svgs = Array.from(document.querySelectorAll('svg'));
              for (const s of svgs) {
                const aria = s.getAttribute('aria-label') || '';
                const title = s.querySelector('title')?.textContent || '';
                if (aria || title) {
                  if (lower.includes('message') || lower.includes('direct')) {
                    if (/direct|message|chat|inbox/i.test(aria + ' ' + title)) {
                      const parent = s.closest('a, button, [role="button"]') as HTMLElement | null;
                      const hasBadge = !!parent?.querySelector('[class*="badge"], [class*="dot"], span');
                      indicators.push(`• Icon <${aria || title}> on <${parent?.tagName.toLowerCase()}> (badge detected: ${hasBadge})`);
                    }
                  }
                }
              }

              return indicators.length > 0
                ? indicators.slice(0, 10).join('\n')
                : 'No unread message badges or notification indicators detected in DOM accessibility tree.';
            },
            args: [tool.query],
          });

          return `Visual Inspection (DOM Accessibility Fallback — active model "${ctx.config.model.id}" does not support vision):\n${domAnalysis[0]?.result ?? 'No visual DOM cues found.'}`;
        }

        // Active model DOES support vision: capture viewport and query multimodal vision LLM
        let dataUrl: string;
        try {
          dataUrl = await captureViewport();
        } catch (err) {
          return `Visual inspection failed: Unable to capture tab screenshot (${err instanceof Error ? err.message : String(err)}).`;
        }

        const promptText = `You are the Visual Inspection specialist for NIM Agent.
Inspect the attached webpage screenshot carefully to answer the following query:
"${tool.query}"

Key observation rules:
1. Examine navigation icons (especially Direct/Messages icons, notification icons, hearts, paper planes, bell icons).
2. Look for visual badge indicators: small red or blue circular dots, numeric counters, or highlighted tabs indicating new/unread messages.
3. For video/reels pages: check if a video is actively playing, paused, or has finished.
4. If asked whether there are new messages (e.g. on Instagram), state clearly:
   - "YES" if a red badge/dot or counter is visible on the Messages/Direct icon or inbox list.
   - "NO" if the Messages/Direct icon has no unread dot or badge.
5. Provide a direct, concise, and decisive answer.`;

        try {
          const res = await chatCompletion(ctx.config.providerConfig, {
            model: ctx.config.model.id,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText },
                  { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                ],
              },
            ],
            temperature: 0.1,
            max_tokens: 400,
          });

          const analysis = res.choices[0]?.message?.content?.trim() || 'No visual analysis returned.';
          return `[IMAGE_DATA:${dataUrl}] Visual Inspection Analysis for query "${tool.query}":\n\n${analysis}`;
        } catch (apiErr) {
          return `Visual inspection failed during LLM evaluation: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`;
        }
      }

      case 'auto_advance_media': {
        const tabId = await ctx.resolveTabId();
        const action = tool.action || 'start';

        if (action === 'stop') {
          const stopRes = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const watcher = (window as unknown as { __nimMediaWatcher?: { stop: () => { count: number } } }).__nimMediaWatcher;
              if (watcher) {
                const res = watcher.stop();
                return { success: true, count: res?.count ?? 0 };
              }
              return { success: false, reason: 'No active media watcher was running on this tab.' };
            },
          });
          const res = stopRes[0]?.result;
          return res?.success
            ? `Stopped reel auto-advancer. Total reels advanced during this session: ${res.count}.`
            : `Reel auto-advancer was not active: ${res?.reason}`;
        }

        if (action === 'status') {
          const statusRes = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const watcher = (window as unknown as { __nimMediaWatcher?: { getStatus: () => { active: boolean; count: number } } }).__nimMediaWatcher;
              if (watcher) {
                return watcher.getStatus();
              }
              return { active: false, count: 0 };
            },
          });
          const s = statusRes[0]?.result;
          return `Media Auto-Advancer Status: ${s?.active ? 'RUNNING' : 'STOPPED'} | Reels advanced: ${s?.count ?? 0}.`;
        }

        // Action: 'start'
        const maxReels = tool.maxReels ?? 100;
        const scrollKey = tool.scrollKey ?? 'ArrowDown';

        const startRes = await chrome.scripting.executeScript({
          target: { tabId },
          func: (maxLimit: number, keyToPress: string) => {
            const win = window as unknown as {
              __nimMediaWatcher?: {
                stop: () => { count: number };
                getStatus: () => { active: boolean; count: number };
                advanceNow: () => void;
                togglePause: () => boolean;
              };
            };

            if (win.__nimMediaWatcher) {
              win.__nimMediaWatcher.stop();
            }

            let count = 0;
            let isActive = true;
            let isPaused = false;
            let lastAdvanceTime = Date.now();
            const videoLastTimes = new WeakMap<HTMLVideoElement, number>();

            const existingHud = document.getElementById('nim-media-advancer-hud');
            if (existingHud) existingHud.remove();

            const hud = document.createElement('div');
            hud.id = 'nim-media-advancer-hud';
            hud.style.cssText = `
              position: fixed;
              bottom: 28px;
              right: 28px;
              z-index: 2147483647;
              background: rgba(15, 23, 42, 0.94);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              border: 1px solid rgba(16, 185, 129, 0.6);
              border-radius: 9999px;
              padding: 8px 16px;
              color: #f8fafc;
              font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
              font-size: 12px;
              font-weight: 500;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
              display: flex;
              align-items: center;
              gap: 12px;
              user-select: none;
              transition: all 0.25s ease;
            `;
            hud.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;">
                <span id="nim-reel-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 10px #10b981;animation:nim-type-pulse 1.5s infinite;"></span>
                <span style="font-weight:600;color:#6ee7b7;letter-spacing:0.02em;">AUTOPILOT</span>
              </div>
              <span style="height:12px;width:1px;background:rgba(255,255,255,0.2);"></span>
              <span style="color:#e2e8f0;">Reels: <b id="nim-reel-counter" style="color:#ffffff;">0</b>/${maxLimit}</span>
              <span id="nim-reel-time" style="color:#94a3b8;font-size:11px;font-variant-numeric:tabular-nums;min-width:55px;">0:00 / 0:00</span>
              <div style="display:flex;align-items:center;gap:6px;margin-left:4px;">
                <button id="nim-next-reel-btn" style="background:rgba(255,255,255,0.1);hover:background:rgba(255,255,255,0.2);color:#ffffff;border:none;padding:3px 9px;border-radius:9999px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;" title="Skip to next reel now">
                  Skip ⏭
                </button>
                <button id="nim-pause-reel-btn" style="background:rgba(255,255,255,0.1);color:#ffffff;border:none;padding:3px 8px;border-radius:9999px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;" title="Pause / Resume">
                  ⏸
                </button>
                <button id="nim-stop-reel-btn" style="background:#ef4444;color:#ffffff;border:none;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;" title="Stop autoadvance">
                  Stop
                </button>
              </div>
            `;
            document.body.appendChild(hud);

            // Locate the active video currently displayed in the viewport center
            function getActiveViewportVideo(): HTMLVideoElement | null {
              const videos = Array.from(document.querySelectorAll('video'));
              let bestVideo: HTMLVideoElement | null = null;
              let minDistance = Infinity;
              const viewCenterY = window.innerHeight / 2;

              for (const v of videos) {
                const rect = v.getBoundingClientRect();
                if (rect.height < 120 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
                const videoCenterY = rect.top + rect.height / 2;
                const distance = Math.abs(videoCenterY - viewCenterY);
                if (distance < minDistance) {
                  minDistance = distance;
                  bestVideo = v;
                }
              }
              return bestVideo;
            }

            // Indestructible Multi-Tier Advance Strategy across Instagram, YouTube Shorts, TikTok
            function performAdvance(): void {
              const now = Date.now();
              if (now - lastAdvanceTime < 2200) return; // 2.2s minimum dwell protection
              lastAdvanceTime = now;
              count++;

              const counter = document.getElementById('nim-reel-counter');
              if (counter) counter.textContent = String(count);

              const activeVideo = getActiveViewportVideo();

              // 1. Direct Platform "Next" / "Down" Button Click
              const igNextBtn = document.querySelector<HTMLElement>(
                'button[aria-label*="Next" i], [aria-label="Down chevron" i], svg[aria-label="Down chevron" i], button [aria-label*="Down" i], div[role="button"][aria-label*="Next" i]'
              );
              if (igNextBtn) {
                const clickTarget = (igNextBtn.closest('button, [role="button"]') as HTMLElement) || igNextBtn;
                clickTarget.click();
              }

              const ytNextBtn = document.querySelector<HTMLElement>(
                '#navigation-button-down button, ytd-shorts-player + * button[aria-label*="Next" i], button[aria-label*="Next video" i], #shorts-container #navigation-button-down button'
              );
              if (ytNextBtn) {
                ytNextBtn.click();
              }

              const ttNextBtn = document.querySelector<HTMLElement>(
                '[data-e2e="arrow-down"], button[aria-label*="Go to next video" i], button[aria-label*="next" i]'
              );
              if (ttNextBtn) {
                ttNextBtn.click();
              }

              // 2. Keyboard Events to Multiple Platform Targets
              const targets = [
                activeVideo,
                activeVideo?.closest('div[tabindex], section, main, article'),
                document.activeElement,
                document.querySelector('main, #shorts-container, [role="main"]'),
                document.body,
                window,
              ].filter(Boolean) as EventTarget[];

              const keys = keyToPress === 'scroll' ? ['ArrowDown'] : [keyToPress, 'ArrowDown', 'PageDown', 'j'];
              for (const k of keys) {
                const keyInit = {
                  key: k,
                  code: k === 'j' ? 'KeyJ' : k,
                  keyCode: k === 'ArrowDown' ? 40 : k === 'PageDown' ? 34 : 74,
                  which: k === 'ArrowDown' ? 40 : k === 'PageDown' ? 34 : 74,
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                };
                for (const t of targets) {
                  try {
                    t.dispatchEvent(new KeyboardEvent('keydown', keyInit));
                    t.dispatchEvent(new KeyboardEvent('keyup', keyInit));
                  } catch { /* ignore */ }
                }
              }

              // 3. Scroll Container ScrollBy (Target the internal scrolling container)
              let scrollHandled = false;
              if (activeVideo) {
                let cur = activeVideo.parentElement;
                while (cur && cur !== document.body) {
                  const s = window.getComputedStyle(cur);
                  if ((s.overflowY === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'overlay') && cur.clientHeight > 250) {
                    cur.scrollBy({ top: cur.clientHeight || window.innerHeight, behavior: 'smooth' });
                    scrollHandled = true;
                    break;
                  }
                  cur = cur.parentElement;
                }
              }

              if (!scrollHandled) {
                window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
              }

              // 4. Simulated Wheel Event fallback
              const wheelTarget = (activeVideo ? activeVideo.parentElement : document.querySelector('main')) || document.body;
              try {
                wheelTarget.dispatchEvent(
                  new WheelEvent('wheel', {
                    deltaY: window.innerHeight || 800,
                    deltaMode: 0,
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                  })
                );
              } catch { /* ignore */ }

              if (count >= maxLimit) {
                win.__nimMediaWatcher?.stop();
              }
            }

            // Continuous Video Watcher & Loop Detection Engine
            const interval = setInterval(() => {
              if (!isActive || isPaused) return;

              const activeVideo = getActiveViewportVideo();
              if (!activeVideo) return;

              const cur = activeVideo.currentTime || 0;
              const dur = activeVideo.duration || 0;
              const last = videoLastTimes.get(activeVideo) ?? 0;
              videoLastTimes.set(activeVideo, cur);

              // Update time display in HUD
              const timeDisplay = document.getElementById('nim-reel-time');
              if (timeDisplay && dur > 0 && !isNaN(dur) && isFinite(dur)) {
                const formatTime = (sec: number) => {
                  const m = Math.floor(sec / 60);
                  const s = Math.floor(sec % 60);
                  return `${m}:${s < 10 ? '0' : ''}${s}`;
                };
                timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
              }

              // Detection Criteria 1: Video natively fired ended
              const isEnded = activeVideo.ended;

              // Detection Criteria 2: Video is within 0.4s of duration
              const nearEnd = dur > 1.5 && isFinite(dur) && cur >= dur - 0.45;

              // Detection Criteria 3: Looping video reset (video looped back to start while playing)
              const loopedBack = cur < last - 1.2 && last > 2.0;

              // Detection Criteria 4: Percentage threshold (>= 98% finished)
              const percentComplete = dur > 2.0 && isFinite(dur) && cur / dur >= 0.98;

              if (isEnded || nearEnd || loopedBack || percentComplete) {
                performAdvance();
              }
            }, 250);

            // Hook direct events for instant trigger
            function attachVideoEvents(video: HTMLVideoElement) {
              video.addEventListener('ended', () => {
                if (isActive && !isPaused) performAdvance();
              });
            }
            document.querySelectorAll('video').forEach(attachVideoEvents);

            // MutationObserver to watch for newly mounted reels
            const observer = new MutationObserver((mutations) => {
              for (const m of mutations) {
                for (const node of Array.from(m.addedNodes)) {
                  if (node instanceof HTMLVideoElement) {
                    attachVideoEvents(node);
                  } else if (node instanceof HTMLElement) {
                    node.querySelectorAll('video').forEach(attachVideoEvents);
                  }
                }
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            // UI Button Handlers
            const stopBtn = hud.querySelector('#nim-stop-reel-btn');
            if (stopBtn) {
              stopBtn.addEventListener('click', () => {
                win.__nimMediaWatcher?.stop();
              });
            }

            const nextBtn = hud.querySelector('#nim-next-reel-btn');
            if (nextBtn) {
              nextBtn.addEventListener('click', () => {
                performAdvance();
              });
            }

            const pauseBtn = hud.querySelector('#nim-pause-reel-btn') as HTMLButtonElement | null;
            if (pauseBtn) {
              pauseBtn.addEventListener('click', () => {
                win.__nimMediaWatcher?.togglePause();
              });
            }

            win.__nimMediaWatcher = {
              stop: () => {
                isActive = false;
                clearInterval(interval);
                observer.disconnect();
                hud.style.opacity = '0';
                hud.style.transform = 'translateY(10px) scale(0.95)';
                setTimeout(() => hud.remove(), 300);
                delete win.__nimMediaWatcher;
                return { count };
              },
              getStatus: () => ({ active: isActive && !isPaused, count }),
              advanceNow: () => performAdvance(),
              togglePause: () => {
                isPaused = !isPaused;
                if (pauseBtn) pauseBtn.textContent = isPaused ? '▶' : '⏸';
                const dot = document.getElementById('nim-reel-dot');
                if (dot) {
                  dot.style.background = isPaused ? '#eab308' : '#10b981';
                  dot.style.boxShadow = isPaused ? '0 0 10px #eab308' : '0 0 10px #10b981';
                }
                return isPaused;
              },
            };

            return { success: true };
          },
          args: [maxReels, scrollKey],
        });

        const started = startRes[0]?.result?.success;
        if (started) {
          return `Started continuous reel auto-advancer on the active tab (Limit: ${maxReels} reels). The in-page listener will automatically advance to the next reel as soon as the current one finishes. ZERO API tokens or call limits are consumed. You can tell me "stop" or click the on-screen Stop button at any time.`;
        } else {
          return `Failed to initialize media auto-advancer on this tab.`;
        }
      }

      case 'bypass_annoyances': {
        const tabId = await ctx.resolveTabId();
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Finding 26: Restrict clicks to known CMP containers; do not remove generic modal-backdrops or force position: static
            const CMP_CONTAINER_SELECTORS = [
              '#onetrust-banner-sdk',
              '#onetrust-consent-sdk',
              '.onetrust-pc-dark-filter',
              '#CybotCookiebotDialog',
              '#CybotCookiebotDialogBodyUnderlay',
              '.cc-banner',
              '.cc-window',
              '.cookie-banner',
              '.cookie-consent',
              '.gdpr-banner',
              '#sp_message_container',
              '[id*="consent-banner"]',
              '[class*="consent-banner"]',
              '[id*="cookie-notice"]',
              '[class*="cookie-notice"]',
              '[id*="cmp-container"]',
              '[aria-label*="cookie consent" i]',
              '[aria-label*="cookie banner" i]',
            ];

            let dismissedCount = 0;

            for (const containerSel of CMP_CONTAINER_SELECTORS) {
              try {
                const containers = Array.from(document.querySelectorAll<HTMLElement>(containerSel));
                for (const container of containers) {
                  // Search accept buttons ONLY within this verified CMP container
                  const acceptBtn = container.querySelector<HTMLElement>(
                    '#onetrust-accept-btn-handler, #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, .cc-allow, .cc-dismiss, button[id*="accept" i], button[class*="accept" i], button[aria-label*="accept" i], button[id*="agree" i], button[class*="agree" i]'
                  );
                  if (acceptBtn && acceptBtn.offsetParent !== null) {
                    acceptBtn.click();
                    dismissedCount++;
                  } else {
                    container.remove();
                    dismissedCount++;
                  }
                }
              } catch { /* ignore */ }
            }

            // Restore body/html scrolling without destroying sticky/fixed positioning
            if (document.body.style.overflow === 'hidden') {
              document.body.style.overflow = 'auto';
            }
            if (document.documentElement.style.overflow === 'hidden') {
              document.documentElement.style.overflow = 'auto';
            }

            return { success: true, count: dismissedCount };
          },
        });

        const res = results[0]?.result;
        return `Successfully bypassed annoyances: Removed ${res?.count ?? 0} cookie/consent elements and restored full page scrolling.`;
      }

      case 'clone_page_markdown': {
        const tabId = await ctx.resolveTabId();
        const tab = await chrome.tabs.get(tabId);
        const pageTitle = tab?.title || 'Web Document';
        const pageUrl = tab?.url || 'https://example.com';

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (includeLinks?: boolean) => {
            const root = document.querySelector('main, article, [role="main"], #content, #main, .content') || document.body;
            const clone = root.cloneNode(true) as HTMLElement;

            const junk = clone.querySelectorAll('script, style, noscript, nav, header, footer, iframe, svg, canvas, .ad, .ads, [role="navigation"]');
            junk.forEach((el) => el.remove());

            const lines: string[] = [];
            lines.push(`# ${document.title}\n`);
            lines.push(`> Source: ${window.location.href}\n`);
            lines.push(`---\n`);

            function walk(node: Node) {
              if (node.nodeType === Node.TEXT_NODE) {
                const text = (node.textContent || '').replace(/\s+/g, ' ');
                if (text.trim()) lines.push(text);
                return;
              }

              if (node.nodeType !== Node.ELEMENT_NODE) return;
              const el = node as HTMLElement;
              const tag = el.tagName.toLowerCase();

              if (/^h[1-6]$/.test(tag)) {
                const level = '#'.repeat(parseInt(tag[1], 10));
                lines.push(`\n${level} ${el.textContent?.trim() || ''}\n`);
                return;
              }

              if (tag === 'pre') {
                const code = el.querySelector('code')?.textContent || el.textContent || '';
                lines.push(`\n\`\`\`\n${code.trim()}\n\`\`\`\n`);
                return;
              }

              if (tag === 'p') {
                lines.push('\n');
                node.childNodes.forEach(walk);
                lines.push('\n');
                return;
              }

              if (tag === 'li') {
                lines.push(`\n- `);
                node.childNodes.forEach(walk);
                return;
              }

              if (tag === 'a' && includeLinks !== false) {
                const href = (el as HTMLAnchorElement).href;
                const txt = el.textContent?.trim() || '';
                if (href && txt) {
                  lines.push(` [${txt}](${href}) `);
                  return;
                }
              }

              if (tag === 'blockquote') {
                lines.push(`\n> ${el.textContent?.trim() || ''}\n`);
                return;
              }

              node.childNodes.forEach(walk);
            }

            walk(clone);
            return lines.join('').replace(/\n{3,}/g, '\n\n').trim();
          },
          args: [tool.includeLinks ?? true],
        });

        const rawMarkdown = results[0]?.result || `# ${pageTitle}\nSource: ${pageUrl}`;

        // Finding 27: Quarantine / sanitize markdown before saving
        let cleanMarkdown = rawMarkdown;
        try {
          const sanitizedResult = await processUntrustedPageContent(
            rawMarkdown,
            pageUrl,
            ctx.config.providerConfig,
            ctx.config.quarantineModelId ?? ctx.config.model.id,
          );
          cleanMarkdown = sanitizedResult.content;
        } catch (err) {
          if (err instanceof InjectionDetectedError) {
            return `SECURITY_BLOCKED: Prompt injection detected while cloning markdown from ${pageUrl}. ${err.details}`;
          }
          cleanMarkdown = wrapUntrustedContent(rawMarkdown, pageUrl);
        }

        // Finding 27: Unique filename generation to prevent silent overwrites
        const slug = pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'document';
        const uniqueId = Date.now().toString(36);
        const filePath = `/research/${slug}-${uniqueId}.md`;

        if (tool.saveToWorkspace !== false) {
          try {
            await executeWorkspaceCreateFile(filePath, cleanMarkdown, ['cloned', 'markdown', 'research'], false);
          } catch { /* ignore */ }
        }

        return `Cloned clean markdown from "${pageTitle}" (${cleanMarkdown.length} chars) and saved to Virtual Workspace at ${filePath}:\n\n${cleanMarkdown.slice(0, 3000)}${cleanMarkdown.length > 3000 ? '\n\n... (full document saved to Workspace)' : ''}`;
      }

      case 'watch_page_changes': {
        const tabId = await ctx.resolveTabId();
        const action = tool.action || 'start';

        if (action === 'stop') {
          await removeActiveWatcher(tabId);
          return await stopPageChangeDetector(tabId);
        }

        if (action === 'status') {
          return await getPageChangeDetectorStatus(tabId);
        }

        if (action === 'start' && tool.actionOnDetect === 'auto_act') {
          // Finding 7: auto_act requires explicit user confirmation when the watch is created
          // Show the exact instruction, site and tab in the sidepanel
          const tab = typeof chrome !== 'undefined' && chrome.tabs?.get ? await chrome.tabs.get(tabId).catch(() => null) : null;
          const site = tab?.url ? new URL(tab.url).hostname : 'current page';
          const instruction = tool.autonomousInstruction || '(no instruction specified)';

          if (ctx.callbacks.onHITLRequired) {
            const approved = await ctx.callbacks.onHITLRequired(
              tool,
              `Authorize Autonomous Watch on ${site} (Tab #${tabId}) with instruction: "${instruction}"?`,
            );
            if (!approved) {
              return `WATCH_BLOCKED: User declined autonomous action authorization for "${instruction}" on ${site}.`;
            }
          }
        }

        const watchOptions = {
          action: 'start' as const,
          target: tool.target,
          changeType: tool.changeType,
          condition: tool.condition,
          actionOnDetect: tool.actionOnDetect,
          autonomousInstruction: tool.autonomousInstruction,
          allowSending: tool.allowSending,
          stopAfterChange: tool.stopAfterChange,
          timeoutSeconds: tool.timeoutSeconds,
        };

        const result = await startPageChangeDetector(tabId, watchOptions);

        if (!result.startsWith('ERROR:')) {
          const tab = typeof chrome !== 'undefined' && chrome.tabs?.get ? await chrome.tabs.get(tabId).catch(() => null) : null;
          await saveActiveWatcher(tabId, {
            tabId,
            url: tab?.url || '',
            options: watchOptions,
            createdAt: Date.now(),
          });
        }

        return result;
      }

      // ── DevTools (CDP) Dispatch Cases ─────────────────────────────────────
      case 'inspect_element': {
        const tabId = await ctx.resolveTabId();
        return inspectElement({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'read_console': {
        const tabId = await ctx.resolveTabId();
        return readConsole({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'read_network': {
        const tabId = await ctx.resolveTabId();
        return readNetwork({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'read_storage': {
        const tabId = await ctx.resolveTabId();
        return readStorage({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'get_ax_tree': {
        const tabId = await ctx.resolveTabId();
        return getAxTree({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'edit_element': {
        const tabId = await ctx.resolveTabId();
        return editElement({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'edit_styles': {
        const tabId = await ctx.resolveTabId();
        return editStyles({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'live_edit_script': {
        const tabId = await ctx.resolveTabId();
        return liveEditScript({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'mock_request': {
        const tabId = await ctx.resolveTabId();
        return mockRequest({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'run_in_page': {
        const tabId = await ctx.resolveTabId();
        return runInPage({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'trusted_click': {
        const tabId = await ctx.resolveTabId();
        return trustedClick({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'trusted_type': {
        const tabId = await ctx.resolveTabId();
        return trustedType({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired }, tool);
      }
      case 'undo_devtools_edit': {
        const tabId = await ctx.resolveTabId();
        return undoDevToolsEdit({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired });
      }
      case 'devtools_status': {
        const tabId = await ctx.resolveTabId();
        return devToolsStatus({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired });
      }
      case 'devtools_detach': {
        const tabId = await ctx.resolveTabId();
        return devToolsDetach({ tabId, isAutonomous: ctx.config.isAutonomous, onHITLRequired: ctx.callbacks.onHITLRequired });
      }

      // ── Specialist Delegation Cases ───────────────────────────────────────
      case 'delegate_to_specialist': {
        const tabId = await ctx.resolveTabId();
        return delegateToSpecialist({
          taskId: ctx.taskId,
          tabId,
          isAutonomous: ctx.config.isAutonomous,
          onHITLRequired: ctx.callbacks.onHITLRequired ? async (details) => {
            return ctx.callbacks.onHITLRequired!(
              { tool: 'run_in_page', expression: details.reason } as any,
              `[Specialist HITL - ${details.actor}]: ${details.reason}`,
            );
          } : undefined,
        }, tool);
      }
      case 'check_specialist': {
        return checkSpecialist(tool);
      }
      case 'await_specialist': {
        return awaitSpecialist(tool);
      }
      case 'cancel_specialist': {
        return cancelSpecialist(tool);
      }
      case 'rollback_specialist_edits': {
        return rollbackSpecialistEdits(tool);
      }
    }
  }
}

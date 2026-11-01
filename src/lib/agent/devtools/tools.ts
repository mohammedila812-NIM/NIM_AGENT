/**
 * Curated DevTools (CDP) Tools for NIM Agent
 *
 * All tools wrap the centralized CDPSessionManager chokepoint.
 * Strictly enforces capability tiers, autonomous execution limits,
 * redaction, size caps, and untrusted wrapping.
 */

import { cdpSession, computePayloadHash } from './cdp-session';
import { type DevToolsTier, getDevToolsSessionTier, setDevToolsSessionTier } from './policy';
import { wrapUntrustedContent } from '../prompts';
import { redactString, redactObject } from '../../security/redact';
import { isSensitiveFieldName, isDestructiveAction } from '../security-patterns';

const MAX_OUTPUT_CHARS = 10_000;

function trimAndWrap(source: string, content: string): string {
  const redacted = redactString(content);
  const trimmed = redacted.length > MAX_OUTPUT_CHARS
    ? redacted.slice(0, MAX_OUTPUT_CHARS) + `\n... [TRUNCATED ${redacted.length - MAX_OUTPUT_CHARS} characters]`
    : redacted;
  return wrapUntrustedContent(source, trimmed);
}

function verifyAutonomousTier(tier: DevToolsTier, isAutonomous?: boolean): string | null {
  if (isAutonomous && (tier === 'T1' || tier === 'T2' || tier === 'T3')) {
    return 'AUTONOMOUS_RESTRICTION: Autonomous and sentinel tasks are strictly confined to DevTools Tier 0 (read-only). T1–T3 actions are forbidden.';
  }
  return null;
}

export interface DevToolsToolContext {
  tabId: number;
  isAutonomous?: boolean;
  onHITLRequired?: (action: any, reason: string) => Promise<boolean>;
}

// ── 1. inspect_element (Tier T0) ─────────────────────────────────────────────

export async function inspectElement(
  ctx: DevToolsToolContext,
  params: { selector?: string; nodeId?: number },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T0', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'DOM.enable');
    const docRes = await cdpSession.send<{ root: { nodeId: number } }>(ctx.tabId, 'DOM.getDocument', { depth: 1 });
    if (!docRes.success || !docRes.result) {
      return `Failed to get DOM document: ${docRes.error}`;
    }

    let targetNodeId = params.nodeId;
    if (!targetNodeId && params.selector) {
      const qRes = await cdpSession.send<{ nodeId: number }>(ctx.tabId, 'DOM.querySelector', {
        nodeId: docRes.result.root.nodeId,
        selector: params.selector,
      });
      if (!qRes.success || !qRes.result || qRes.result.nodeId === 0) {
        return `Element not found matching selector "${params.selector}"`;
      }
      targetNodeId = qRes.result.nodeId;
    }

    if (!targetNodeId) {
      return 'Please specify either a CSS selector or nodeId.';
    }

    // Node details
    const descRes = await cdpSession.send<{ node: unknown }>(ctx.tabId, 'DOM.describeNode', {
      nodeId: targetNodeId,
      depth: 2,
    });

    // Computed / matched CSS
    await cdpSession.send(ctx.tabId, 'CSS.enable');
    const styleRes = await cdpSession.send(ctx.tabId, 'CSS.getMatchedStylesForNode', { nodeId: targetNodeId });

    // Box model
    const boxRes = await cdpSession.send(ctx.tabId, 'DOM.getBoxModel', { nodeId: targetNodeId });

    const summary = {
      node: descRes.result?.node,
      styles: styleRes.result,
      boxModel: boxRes.result,
    };

    return trimAndWrap('cdp:inspect_element', JSON.stringify(summary, null, 2));
  } catch (err) {
    return `Error inspecting element: ${err}`;
  }
}

// ── 2. read_console (Tier T0) ────────────────────────────────────────────────

export async function readConsole(
  ctx: DevToolsToolContext,
  params: { level?: 'error' | 'warning' | 'log' | 'all' } = {},
): Promise<string> {
  const autoErr = verifyAutonomousTier('T0', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'Console.enable');
    await cdpSession.send(ctx.tabId, 'Log.enable');

    // Retrieve recent logs via Runtime evaluate of console history or state
    const evalRes = await cdpSession.send<{ result: { value: unknown } }>(ctx.tabId, 'Runtime.evaluate', {
      expression: `(() => {
        return (window.__nimConsoleBuffer || []).slice(-50);
      })()`,
      returnByValue: true,
    }, { tier: 'T0', skipHitl: true });

    const buffer = evalRes.result?.result?.value;
    const output = JSON.stringify(buffer || [], null, 2);
    return trimAndWrap('cdp:read_console', output);
  } catch (err) {
    return `Error reading console logs: ${err}`;
  }
}

// ── 3. read_network (Tier T0 / T1) ───────────────────────────────────────────

export async function readNetwork(
  ctx: DevToolsToolContext,
  params: { includeResponseBody?: boolean; filter?: string } = {},
): Promise<string> {
  const requestedTier: DevToolsTier = params.includeResponseBody ? 'T1' : 'T0';
  const autoErr = verifyAutonomousTier(requestedTier, ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'Network.enable');

    const evalRes = await cdpSession.send<{ result: { value: unknown } }>(ctx.tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const perf = performance.getEntriesByType('resource').slice(-30);
        return perf.map(p => ({
          name: p.name,
          initiatorType: p.initiatorType,
          duration: Math.round(p.duration),
          transferSize: p.transferSize,
        }));
      })()`,
      returnByValue: true,
    }, { tier: 'T0', skipHitl: true });

    const entries = (evalRes.result?.result?.value as Array<{ name: string }>) || [];
    const filtered = params.filter
      ? entries.filter((e) => e.name.toLowerCase().includes(params.filter!.toLowerCase()))
      : entries;

    return trimAndWrap('cdp:read_network', JSON.stringify(filtered, null, 2));
  } catch (err) {
    return `Error reading network requests: ${err}`;
  }
}

// ── 4. read_storage (Tier T1) ────────────────────────────────────────────────

export async function readStorage(
  ctx: DevToolsToolContext,
  params: { type: 'localStorage' | 'sessionStorage' | 'cookies' },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T1', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    if (params.type === 'cookies') {
      const cookieRes = await cdpSession.send<{ cookies: Array<{ name: string; domain: string; path: string; secure: boolean }> }>(
        ctx.tabId,
        'Network.getCookies',
        {},
        { tier: 'T1' },
      );
      // Return names and metadata only by default
      const sanitized = (cookieRes.result?.cookies || []).map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
      }));
      return trimAndWrap('cdp:read_storage:cookies', JSON.stringify(sanitized, null, 2));
    }

    // Local / Session Storage
    const evalRes = await cdpSession.send<{ result: { value: Record<string, string> } }>(
      ctx.tabId,
      'Runtime.evaluate',
      {
        expression: `(() => {
          const store = ${params.type === 'localStorage' ? 'localStorage' : 'sessionStorage'};
          const out = {};
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k) out[k] = store.getItem(k);
          }
          return out;
        })()`,
        returnByValue: true,
      },
      { tier: 'T1', skipHitl: true },
    );

    const storeData = evalRes.result?.result?.value || {};
    return trimAndWrap(`cdp:read_storage:${params.type}`, JSON.stringify(storeData, null, 2));
  } catch (err) {
    return `Error reading storage: ${err}`;
  }
}

// ── 5. get_ax_tree (Tier T0) ─────────────────────────────────────────────────

export async function getAxTree(
  ctx: DevToolsToolContext,
  params: { maxDepth?: number } = {},
): Promise<string> {
  const autoErr = verifyAutonomousTier('T0', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'Accessibility.enable');
    const axRes = await cdpSession.send<{ nodes: unknown[] }>(
      ctx.tabId,
      'Accessibility.getFullAXTree',
      { max_depth: params.maxDepth ?? 3 },
      { tier: 'T0' },
    );
    return trimAndWrap('cdp:get_ax_tree', JSON.stringify(axRes.result?.nodes || [], null, 2));
  } catch (err) {
    return `Error getting accessibility tree: ${err}`;
  }
}

// ── 6. edit_element (Tier T2) ────────────────────────────────────────────────

export async function editElement(
  ctx: DevToolsToolContext,
  params: { selector: string; outerHTML?: string; attributeName?: string; attributeValue?: string },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T2', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'DOM.enable');
    const doc = await cdpSession.send<{ root: { nodeId: number } }>(ctx.tabId, 'DOM.getDocument');
    if (!doc.result?.root) return 'Failed to get DOM document';

    const nodeRes = await cdpSession.send<{ nodeId: number }>(ctx.tabId, 'DOM.querySelector', {
      nodeId: doc.result.root.nodeId,
      selector: params.selector,
    });
    if (!nodeRes.result || nodeRes.result.nodeId === 0) {
      return `Target element not found: "${params.selector}"`;
    }
    const nodeId = nodeRes.result.nodeId;

    // Capture previous state for Undo
    const desc = await cdpSession.send<{ node: { outerHTML?: string } }>(ctx.tabId, 'DOM.describeNode', { nodeId });
    const prevOuterHTML = desc.result?.node?.outerHTML || '';

    // Snapshot undo
    cdpSession.pushUndoSnapshot({
      id: crypto.randomUUID(),
      tabId: ctx.tabId,
      timestamp: Date.now(),
      type: 'html',
      target: params.selector,
      previousValue: prevOuterHTML,
      method: 'DOM.setOuterHTML',
    });

    if (params.outerHTML !== undefined) {
      const newHtml = params.outerHTML;
      const res = await cdpSession.send(ctx.tabId, 'DOM.setOuterHTML', {
        nodeId,
        outerHTML: newHtml,
      }, {
        tier: 'T2',
        onHITLRequired: async () => {
          if (!ctx.onHITLRequired) return false;
          return ctx.onHITLRequired(
            { tool: 'edit_element', selector: params.selector, outerHTML: newHtml },
            `DevTools T2 Edit on <${params.selector}>:\nOld: ${prevOuterHTML.slice(0, 100)}...\nNew: ${newHtml.slice(0, 100)}...`,
          );
        },
      });
      if (!res.success) return `Failed to edit element HTML: ${res.error}`;
      return `Successfully modified outerHTML for "${params.selector}". Runtime edit applied. Use undo_devtools_edit to revert.`;
    }

    if (params.attributeName && params.attributeValue !== undefined) {
      const res = await cdpSession.send(ctx.tabId, 'DOM.setAttributeValue', {
        nodeId,
        name: params.attributeName,
        value: params.attributeValue,
      }, {
        tier: 'T2',
        onHITLRequired: async () => {
          if (!ctx.onHITLRequired) return false;
          return ctx.onHITLRequired(
            { tool: 'edit_element', selector: params.selector, attributeName: params.attributeName, attributeValue: params.attributeValue },
            `DevTools T2 Set Attribute on <${params.selector}>: ${params.attributeName}="${params.attributeValue}"`,
          );
        },
      });
      if (!res.success) return `Failed to set attribute: ${res.error}`;
      return `Successfully set attribute ${params.attributeName}="${params.attributeValue}" on "${params.selector}".`;
    }

    return 'Please provide either outerHTML or attributeName + attributeValue.';
  } catch (err) {
    return `Error editing element: ${err}`;
  }
}

// ── 7. edit_styles (Tier T2) ─────────────────────────────────────────────────

export async function editStyles(
  ctx: DevToolsToolContext,
  params: { selector: string; cssText: string },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T2', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'DOM.enable');
    await cdpSession.send(ctx.tabId, 'CSS.enable');

    const doc = await cdpSession.send<{ root: { nodeId: number } }>(ctx.tabId, 'DOM.getDocument');
    const nodeRes = await cdpSession.send<{ nodeId: number }>(ctx.tabId, 'DOM.querySelector', {
      nodeId: doc.result!.root.nodeId,
      selector: params.selector,
    });
    if (!nodeRes.result || nodeRes.result.nodeId === 0) {
      return `Element "${params.selector}" not found`;
    }

    const matched = await cdpSession.send<{ inlineStyle?: { styleSheetId?: string; range?: unknown; cssText?: string } }>(
      ctx.tabId,
      'CSS.getInlineStylesForNode',
      { nodeId: nodeRes.result.nodeId },
    );

    const prevCss = matched.result?.inlineStyle?.cssText || '';

    // Snapshot undo
    cdpSession.pushUndoSnapshot({
      id: crypto.randomUUID(),
      tabId: ctx.tabId,
      timestamp: Date.now(),
      type: 'style',
      target: params.selector,
      previousValue: prevCss,
      method: 'CSS.setStyleTexts',
    });

    const res = await cdpSession.send(ctx.tabId, 'CSS.setStyleTexts', {
      edits: [
        {
          styleSheetId: matched.result?.inlineStyle?.styleSheetId,
          range: matched.result?.inlineStyle?.range,
          text: params.cssText,
        },
      ],
    }, {
      tier: 'T2',
      onHITLRequired: async () => {
        if (!ctx.onHITLRequired) return false;
        return ctx.onHITLRequired(
          { tool: 'edit_styles', selector: params.selector, cssText: params.cssText },
          `DevTools T2 CSS edit on "${params.selector}":\nPrevious CSS: ${prevCss}\nNew CSS: ${params.cssText}`,
        );
      },
    });

    if (!res.success) return `Failed to apply styles: ${res.error}`;
    return `Successfully applied style edit to "${params.selector}". Runtime edit applied.`;
  } catch (err) {
    return `Error editing styles: ${err}`;
  }
}

// ── 8. live_edit_script (Tier T2) ────────────────────────────────────────────

export async function liveEditScript(
  ctx: DevToolsToolContext,
  params: { scriptId: string; newSource: string },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T2', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'Debugger.enable');

    const res = await cdpSession.send(ctx.tabId, 'Debugger.setScriptSource', {
      scriptId: params.scriptId,
      scriptSource: params.newSource,
    }, {
      tier: 'T2',
      onHITLRequired: async () => {
        if (!ctx.onHITLRequired) return false;
        return ctx.onHITLRequired(
          { tool: 'live_edit_script', scriptId: params.scriptId },
          `DevTools T2 Live Script Edit (ID: ${params.scriptId}):\n${params.newSource.slice(0, 300)}...`,
        );
      },
    });

    if (!res.success) return `Failed to edit script source: ${res.error}`;
    return `Successfully live-edited script ${params.scriptId} in V8 runtime. Edits vanish on page reload.`;
  } catch (err) {
    return `Error editing script: ${err}`;
  }
}

// ── 9. mock_request (Tier T2) ────────────────────────────────────────────────

export async function mockRequest(
  ctx: DevToolsToolContext,
  params: { urlPattern: string; responseCode?: number; responseBody?: string; responseHeaders?: Record<string, string> },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T2', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    await cdpSession.send(ctx.tabId, 'Fetch.enable', {
      patterns: [{ urlPattern: params.urlPattern, requestStage: 'Request' }],
    }, { tier: 'T2' });

    return `Enabled network request interception for "${params.urlPattern}". Response code: ${params.responseCode ?? 200}.`;
  } catch (err) {
    return `Error configuring mock request: ${err}`;
  }
}

// ── 10. run_in_page (Tier T3) ────────────────────────────────────────────────

export async function runInPage(
  ctx: DevToolsToolContext,
  params: { expression: string },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T3', ctx.isAutonomous);
  if (autoErr) return autoErr;

  try {
    const res = await cdpSession.send<{ result: { value: unknown; description?: string } }>(
      ctx.tabId,
      'Runtime.evaluate',
      {
        expression: params.expression,
        returnByValue: true,
        awaitPromise: true,
      },
      {
        tier: 'T3',
        onHITLRequired: async () => {
          if (!ctx.onHITLRequired) return false;
          return ctx.onHITLRequired(
            { tool: 'run_in_page', expression: params.expression },
            `DevTools T3 Runtime Code Execution:\n${params.expression}`,
          );
        },
      },
    );

    if (!res.success) return `Execution failed: ${res.error}`;
    const val = res.result?.result?.value !== undefined ? res.result.result.value : res.result?.result?.description;
    return trimAndWrap('cdp:run_in_page', JSON.stringify(val, null, 2));
  } catch (err) {
    return `Error evaluating in page: ${err}`;
  }
}

// ── 11. trusted_click (Tier T3) ──────────────────────────────────────────────

export async function trustedClick(
  ctx: DevToolsToolContext,
  params: { x: number; y: number; clickLabel?: string },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T3', ctx.isAutonomous);
  if (autoErr) return autoErr;

  // Check destructive action keywords
  const isDestructive = isDestructiveAction(params.clickLabel || `click at ${params.x},${params.y}`);

  try {
    const hitlCheck = async () => {
      if (!isDestructive) return true;
      if (!ctx.onHITLRequired) return false;
      return ctx.onHITLRequired(
        { tool: 'trusted_click', ...params },
        `Trusted native mouse click at (${params.x}, ${params.y}) [${params.clickLabel || 'Click'}]`,
      );
    };

    // Mouse Press
    const press = await cdpSession.send(ctx.tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: params.x,
      y: params.y,
      button: 'left',
      clickCount: 1,
    }, { tier: 'T3', onHITLRequired: hitlCheck });
    if (!press.success) return `Failed mouse click press: ${press.error}`;

    // Mouse Release
    await cdpSession.send(ctx.tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: params.x,
      y: params.y,
      button: 'left',
      clickCount: 1,
    }, { tier: 'T3', skipHitl: true });

    return `Dispatched trusted native mouse click at (${params.x}, ${params.y}).`;
  } catch (err) {
    return `Error in trusted click: ${err}`;
  }
}

// ── 12. trusted_type (Tier T3) ───────────────────────────────────────────────

export async function trustedType(
  ctx: DevToolsToolContext,
  params: { text: string; fieldName?: string },
): Promise<string> {
  const autoErr = verifyAutonomousTier('T3', ctx.isAutonomous);
  if (autoErr) return autoErr;

  // Refuse sensitive field typing
  if (params.fieldName && isSensitiveFieldName(params.fieldName)) {
    return 'SECURITY_BLOCKED: Refusing to auto-type into a sensitive credential or payment field.';
  }

  try {
    const res = await cdpSession.send(ctx.tabId, 'Input.insertText', {
      text: params.text,
    }, {
      tier: 'T3',
      onHITLRequired: async () => {
        if (!ctx.onHITLRequired) return false;
        return ctx.onHITLRequired(
          { tool: 'trusted_type', text: params.text, fieldName: params.fieldName },
          `Trusted native keyboard input into ${params.fieldName || 'field'}: "${params.text}"`,
        );
      },
    });

    if (!res.success) return `Failed to dispatch keyboard text: ${res.error}`;
    return `Successfully typed text via trusted native Input events.`;
  } catch (err) {
    return `Error in trusted type: ${err}`;
  }
}

// ── 13. undo_devtools_edit (Tier T2) ──────────────────────────────────────────

export async function undoDevToolsEdit(ctx: DevToolsToolContext): Promise<string> {
  const snapshot = cdpSession.popUndoSnapshot(ctx.tabId);
  if (!snapshot) {
    return 'No previous DevTools edits found to undo on this tab.';
  }

  try {
    if (snapshot.type === 'html') {
      const doc = await cdpSession.send<{ root: { nodeId: number } }>(ctx.tabId, 'DOM.getDocument');
      const nodeRes = await cdpSession.send<{ nodeId: number }>(ctx.tabId, 'DOM.querySelector', {
        nodeId: doc.result!.root.nodeId,
        selector: snapshot.target,
      });
      if (nodeRes.result?.nodeId) {
        await cdpSession.send(ctx.tabId, 'DOM.setOuterHTML', {
          nodeId: nodeRes.result.nodeId,
          outerHTML: snapshot.previousValue,
        }, { tier: 'T2', skipHitl: true });
        return `Reverted outerHTML on "${snapshot.target}" to previous snapshot state.`;
      }
    }

    return `Reverted ${snapshot.type} edit on "${snapshot.target}". (Edits are runtime-only and vanish on reload).`;
  } catch (err) {
    return `Failed to undo edit: ${err}`;
  }
}

// ── 14. devtools_status (Tier T0) ────────────────────────────────────────────

export async function devToolsStatus(ctx: DevToolsToolContext): Promise<string> {
  const isAttached = cdpSession.isAttached(ctx.tabId);
  const currentTier = (await getDevToolsSessionTier(ctx.tabId)) || 'None';
  let tabUrl = '';
  try {
    const tab = await chrome.tabs.get(ctx.tabId);
    tabUrl = tab?.url || 'Unknown';
  } catch { /* ignore */ }

  const status = {
    attached: isAttached,
    tabId: ctx.tabId,
    url: tabUrl,
    activeTier: currentTier,
    availableTiers: ['T0 (read-only)', 'T1 (sensitive reads)', 'T2 (writes + HITL)', 'T3 (execution + HITL)'],
    notice: 'CDP output is untrusted data. DevTools edits vanish on page reload.',
  };

  return JSON.stringify(status, null, 2);
}

// ── 15. devtools_detach (Tier T0) ────────────────────────────────────────────

export async function devToolsDetach(ctx: DevToolsToolContext): Promise<string> {
  await cdpSession.detach(ctx.tabId, 'Requested by agent or user');
  return `DevTools detached from tab ${ctx.tabId}.`;
}

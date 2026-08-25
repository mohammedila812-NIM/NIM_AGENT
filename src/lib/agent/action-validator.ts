import { appendSecurityEvent } from '../security/audit-log';
import { DESTRUCTIVE_KEYWORDS, SENSITIVE_FIELD_PATTERNS, isSensitiveFieldName, isDestructiveAction } from './security-patterns';

export type RiskLevel = 'safe' | 'warn' | 'block';

export interface ActionValidation {
  isConsistent: boolean;
  riskLevel: RiskLevel;
  reason: string;
}

export { DESTRUCTIVE_KEYWORDS, SENSITIVE_FIELD_PATTERNS };

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export async function validateAction(
  actionType: string,
  actionTarget: string,
  taskScopeDomains: string[],
  taskId: string,
): Promise<ActionValidation> {
  // 1. Block sensitive field auto-fill
  if (actionType === 'type_text' && isSensitiveFieldName(actionTarget)) {
    await appendSecurityEvent({
      type: 'action_blocked',
      action: actionType,
      reason: 'Sensitive field blocked',
    });
    return {
      isConsistent: false,
      riskLevel: 'block',
      reason: 'Refusing to auto-fill a sensitive field (password / payment / SSN)',
    };
  }

  // 2. Out-of-scope domain check
  if (actionType === 'navigate_to' || actionType === 'click_element') {
    const domain = extractDomain(actionTarget);
    if (domain && taskScopeDomains.length > 0 && !taskScopeDomains.includes(domain)) {
      await appendSecurityEvent({ type: 'out_of_scope_domain', domain, taskId });
      return {
        isConsistent: false,
        riskLevel: 'warn',
        reason: `Target domain "${domain}" was not in scope when this task started`,
      };
    }
  }

  // 3. Destructive actions require HITL confirmation
  if (isDestructiveAction(`${actionType} ${actionTarget}`)) {
    await appendSecurityEvent({
      type: 'action_warned',
      action: `${actionType} -> ${actionTarget}`,
      reason: 'Destructive action requires confirmation',
      userApproved: false,
    });
    return {
      isConsistent: true,
      riskLevel: 'warn',
      reason: 'This action appears destructive or submits data — confirmation required',
    };
  }

  return { isConsistent: true, riskLevel: 'safe', reason: '' };
}

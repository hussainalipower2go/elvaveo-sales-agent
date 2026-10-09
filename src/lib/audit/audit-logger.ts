// ==============================================================================
// ELVAVEO Sales Agent - Append-Only Audit Logging
// ==============================================================================

import { AuditLog } from '../types/database';

export interface AuditEventParams {
  workspaceId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: 'lead' | 'draft' | 'approval' | 'send' | 'suppression' | 'webhook' | 'workspace' | 'settings' | 'follow_up';
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Sanitizes audit details to remove sensitive credentials, API keys, or long tokens.
 */
export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details) return {};

  const sanitized: Record<string, unknown> = {};
  const secretKeywords = ['key', 'secret', 'token', 'password', 'authorization', 'bearer'];

  for (const [key, value] of Object.entries(details)) {
    const isSecret = secretKeywords.some((keyword) => key.toLowerCase().includes(keyword));
    if (isSecret && typeof value === 'string') {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditDetails(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Formats an audit log record for append-only storage.
 */
export function createAuditRecord(params: AuditEventParams): Omit<AuditLog, 'id'> {
  return {
    workspace_id: params.workspaceId,
    actor_id: params.actorId || null,
    actor_email: params.actorEmail || null,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId || null,
    details: sanitizeAuditDetails(params.details),
    created_at: new Date().toISOString(),
  };
}

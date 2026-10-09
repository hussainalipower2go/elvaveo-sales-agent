// ==============================================================================
// ELVAVEO Sales Agent - Resend Webhook Processing & Delivery Reconciliation
// ==============================================================================

import { Webhook } from 'svix';
import { SendLogStatus, SuppressionReason } from '../types/database';

export interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    id?: string; // event id or email id
    from?: string;
    to?: string[];
    subject?: string;
    created_at?: string;
    status?: string;
    tags?: Array<{ name: string; value: string }> | Record<string, string>;
  };
}

export interface WebhookProcessingResult {
  valid: boolean;
  duplicate: boolean;
  eventType: string;
  providerEventId: string;
  resendEmailId?: string;
  recipientEmail?: string;
  newStatus?: SendLogStatus;
  autoSuppressionReason?: SuppressionReason;
  isTestActivity: boolean;
  errorMessage?: string;
}

/**
 * State hierarchy to prevent out-of-order webhook delivery from regressing state.
 * e.g., 'email.delivered' arriving before 'email.sent' must not regress 'delivered' back to 'sent'.
 */
const STATUS_HIERARCHY: Record<SendLogStatus, number> = {
  sending: 1,
  sent: 2,
  unknown: 2,
  delivered: 3,
  failed: 4,
  bounced: 5,
  complained: 5,
};

/**
 * Determines whether the new status is allowed to supersede the current status.
 */
export function canTransitionStatus(
  currentStatus: SendLogStatus | null | undefined,
  newStatus: SendLogStatus
): boolean {
  if (!currentStatus) return true;
  const currentLevel = STATUS_HIERARCHY[currentStatus] || 0;
  const newLevel = STATUS_HIERARCHY[newStatus] || 0;

  // Never downgrade from terminal or higher state (e.g. delivered -> sent is blocked)
  return newLevel >= currentLevel;
}

/**
 * Verifies raw request body with Svix using the Resend webhook signing secret.
 */
export function verifyResendWebhookSignature(params: {
  rawBody: string;
  headers: {
    id?: string | null;
    timestamp?: string | null;
    signature?: string | null;
  };
  secret: string;
}): { valid: boolean; payload?: ResendWebhookPayload; error?: string } {
  const { rawBody, headers, secret } = params;

  if (!secret) {
    return { valid: false, error: 'RESEND_WEBHOOK_SECRET is not configured.' };
  }

  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { valid: false, error: 'Missing required Svix webhook headers.' };
  }

  try {
    const wh = new Webhook(secret);
    wh.verify(rawBody, {
      'svix-id': headers.id,
      'svix-timestamp': headers.timestamp,
      'svix-signature': headers.signature,
    });

    const parsed = JSON.parse(rawBody) as ResendWebhookPayload;
    return { valid: true, payload: parsed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Invalid webhook signature: ${message}` };
  }
}

/**
 * Processes an inbound verified Resend webhook event.
 */
export function parseWebhookEvent(
  providerEventId: string,
  payload: ResendWebhookPayload,
  alreadyProcessedEventIds: Set<string>
): WebhookProcessingResult {
  if (alreadyProcessedEventIds.has(providerEventId)) {
    return {
      valid: true,
      duplicate: true,
      eventType: payload.type,
      providerEventId,
      isTestActivity: false,
    };
  }

  const resendEmailId = payload.data.email_id || payload.data.id;
  let recipientEmail: string | undefined;
  if (Array.isArray(payload.data.to)) {
    recipientEmail = payload.data.to[0]?.toLowerCase()?.trim();
  } else if (typeof payload.data.to === 'string') {
    recipientEmail = (payload.data.to as string).toLowerCase().trim();
  }

  // Check tags for test flag safely (supports array of objects or key-value dictionary)
  let isTestTag = false;
  const rawTags = payload.data.tags as unknown;
  if (Array.isArray(rawTags)) {
    isTestTag = rawTags.some((t: any) => t && typeof t === 'object' && t.name === 'mode' && t.value === 'test');
  } else if (rawTags && typeof rawTags === 'object') {
    const record = rawTags as Record<string, unknown>;
    isTestTag = record['mode'] === 'test' || record['is_test'] === 'true' || record['is_test'] === true;
  }

  let newStatus: SendLogStatus | undefined;
  let autoSuppressionReason: SuppressionReason | undefined;

  switch (payload.type) {
    case 'email.sent':
      newStatus = 'sent';
      break;
    case 'email.delivered':
      newStatus = 'delivered';
      break;
    case 'email.delivery_delayed':
      // Delivery delayed does not fail immediately
      break;
    case 'email.bounced':
      newStatus = 'bounced';
      autoSuppressionReason = 'bounce';
      break;
    case 'email.complained':
      newStatus = 'complained';
      autoSuppressionReason = 'complaint';
      break;
    default:
      break;
  }

  return {
    valid: true,
    duplicate: false,
    eventType: payload.type,
    providerEventId,
    resendEmailId,
    recipientEmail,
    newStatus,
    autoSuppressionReason,
    isTestActivity: isTestTag,
  };
}

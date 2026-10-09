// ==============================================================================
// ELVAVEO Sales Agent - Sending Engine & Guardrails
// ==============================================================================

import { Resend } from 'resend';
import {
  EmailDraft,
  DraftApproval,
  Lead,
  SendLog,
  SendMode,
  WorkspaceRole,
} from '../types/database';
import { canSendEmails } from '../auth/roles';
import { ELVAVEO_EMAIL_IDENTITY, validateEmailIdentity } from '../email/identity';
import {
  generateComplianceFooter,
  generateUnsubscribeHeaders,
  generateUnsubscribeToken,
} from '../email/unsubscribe';
import { computeContentHash } from '../personalization/template';
import { validatePhysicalPostalAddress } from '../email/address-validator';

export interface SendEligibilityCheck {
  canSend: boolean;
  blockingReasons: string[];
  isTestMode: boolean;
  effectiveRecipient: string;
}

export interface SendEmailParams {
  draft: EmailDraft;
  lead: Lead;
  latestApproval: DraftApproval | null;
  userRole: WorkspaceRole;
  isSuppressed: boolean;
  workspaceDailyCount: number;
  workspaceHourlyCount: number;
  lastSentToRecipientDate: string | null;
  serverSendMode: SendMode;
  testRecipients: string[];
  businessAddress: string;
  businessLegalName?: string;
  idempotencyKey?: string;
  appUrl: string;
  unsubscribeSecret: string;
  dailySendLimit: number;
  hourlySendLimit: number;
  recipientCoolDownDays: number;
  resendApiKey?: string;
  resendClientOverride?: {
    emails: {
      send: (args: Record<string, unknown>) => Promise<{ data?: { id: string } | null; error?: { message: string } | null }>;
    };
  };
}

export interface SendResult {
  success: boolean;
  status: 'sent' | 'failed' | 'unknown';
  isTest: boolean;
  effectiveRecipient: string;
  resendEmailId?: string;
  errorMessage?: string;
  idempotencyKey: string;
  blockingReasons?: string[];
}

/**
 * Builds a deterministic idempotency key for a specific draft, version, and approved content hash.
 * Does NOT generate a random timestamp, ensuring retries reuse the exact same key.
 */
export function generateDeterministicIdempotencyKey(params: {
  workspaceId: string;
  draftId: string;
  draftVersion: number;
  contentHash: string;
}): string {
  const shortHash = (params.contentHash || 'v1').slice(0, 16);
  return `elvaveo:${params.workspaceId}:${params.draftId}:v${params.draftVersion}:${shortHash}`;
}

/**
 * Evaluates all pre-conditions and gating rules immediately before sending.
 */
export function checkSendEligibility(params: {
  draft: EmailDraft;
  lead: Lead;
  latestApproval: DraftApproval | null;
  userRole: WorkspaceRole;
  isSuppressed: boolean;
  workspaceDailyCount: number;
  workspaceHourlyCount: number;
  lastSentToRecipientDate: string | null;
  serverSendMode: SendMode;
  testRecipients: string[];
  dailySendLimit: number;
  hourlySendLimit: number;
  recipientCoolDownDays: number;
  businessAddress?: string;
}): SendEligibilityCheck {
  const blockingReasons: string[] = [];
  const isTestMode = params.serverSendMode === 'test';

  // 1. Authorization check
  if (!canSendEmails(params.userRole)) {
    blockingReasons.push(
      `Role "${params.userRole}" is not authorized to send emails. Only reviewers, admins, and owners can send.`
    );
  }

  // 2. Draft status & Approval check
  if (params.draft.status !== 'approved') {
    blockingReasons.push(
      `Draft is in "${params.draft.status}" status. Only approved drafts can be dispatched.`
    );
  }

  if (!params.latestApproval) {
    blockingReasons.push('Draft has no recorded approval history.');
  } else {
    if (params.latestApproval.decision !== 'approved') {
      blockingReasons.push('The latest recorded review decision was not an approval.');
    }
    if (params.latestApproval.draft_version !== params.draft.version) {
      blockingReasons.push(
        `Version mismatch: Approved version is v${params.latestApproval.draft_version}, but current draft is v${params.draft.version}.`
      );
    }

    // Verify current content hash matches the approved hash
    const currentHash = computeContentHash({
      recipientEmail: params.draft.recipient_email,
      senderEmail: params.draft.sender_email,
      replyToEmail: params.draft.reply_to_email,
      subject: params.draft.subject,
      bodyText: params.draft.body_text,
      bodyHtml: params.draft.body_html,
      footerText: params.draft.footer_text,
      footerHtml: params.draft.footer_html,
    });

    if (currentHash !== params.latestApproval.content_hash) {
      blockingReasons.push(
        'Content tampering detected: Draft content differs from the version approved by reviewer. Review required.'
      );
    }
  }

  // 3. Sender and Reply-to Identity check
  const identityCheck = validateEmailIdentity(
    params.draft.sender_email,
    params.draft.reply_to_email
  );
  if (!identityCheck.valid) {
    blockingReasons.push(identityCheck.error || 'Invalid sender or reply-to identity.');
  }

  // 4. Rate limits check (Durable database counters)
  if (params.workspaceDailyCount >= params.dailySendLimit) {
    blockingReasons.push(
      `Workspace daily sending limit reached (${params.workspaceDailyCount}/${params.dailySendLimit}).`
    );
  }

  if (params.workspaceHourlyCount >= params.hourlySendLimit) {
    blockingReasons.push(
      `Workspace hourly sending limit reached (${params.workspaceHourlyCount}/${params.hourlySendLimit}).`
    );
  }

  // 5. Mode-specific checks & Recipient routing
  let effectiveRecipient = '';

  if (isTestMode) {
    if (!params.testRecipients || params.testRecipients.length === 0) {
      blockingReasons.push(
        'Test mode active: No TEST_RECIPIENTS configured on server. Lead email is never used as fallback.'
      );
    } else {
      // Direct exclusively to the first configured test address
      effectiveRecipient = params.testRecipients[0];
    }
  } else {
    // LIVE MODE
    effectiveRecipient = params.draft.recipient_email;

    // Consent requirement
    if (params.lead.consent_status !== 'opted_in') {
      blockingReasons.push(
        `Affirmative consent required for live outreach. Lead consent status is "${params.lead.consent_status}".`
      );
    }

    // Suppression check
    if (params.isSuppressed) {
      blockingReasons.push(
        `Recipient "${params.draft.recipient_email}" is on the workspace suppression list.`
      );
    }

    // Cooldown check for same recipient
    if (params.lastSentToRecipientDate && params.recipientCoolDownDays > 0) {
      const lastSentTime = new Date(params.lastSentToRecipientDate).getTime();
      const cooldownMs = params.recipientCoolDownDays * 24 * 60 * 60 * 1000;
      if (Date.now() - lastSentTime < cooldownMs) {
        blockingReasons.push(
          `Recipient cooldown active: Outreach was sent on ${params.lastSentToRecipientDate}. Minimum wait is ${params.recipientCoolDownDays} days.`
        );
      }
    }

    // Physical postal address requirement for live compliance
    const addressCheck = validatePhysicalPostalAddress(params.businessAddress);
    if (!addressCheck.valid) {
      blockingReasons.push(
        ...addressCheck.errors.map((err) => `Postal address compliance blocked: ${err}`)
      );
    }
  }

  return {
    canSend: blockingReasons.length === 0,
    blockingReasons,
    isTestMode,
    effectiveRecipient,
  };
}

/**
 * Dispatches an approved email draft through Resend with full guardrails and idempotency.
 */
export async function executeSendEmail(params: SendEmailParams): Promise<SendResult> {
  const isTestMode = params.serverSendMode === 'test';

  const eligibility = checkSendEligibility({
    draft: params.draft,
    lead: params.lead,
    latestApproval: params.latestApproval,
    userRole: params.userRole,
    isSuppressed: params.isSuppressed,
    workspaceDailyCount: params.workspaceDailyCount,
    workspaceHourlyCount: params.workspaceHourlyCount,
    lastSentToRecipientDate: params.lastSentToRecipientDate,
    serverSendMode: params.serverSendMode,
    testRecipients: params.testRecipients,
    dailySendLimit: params.dailySendLimit,
    hourlySendLimit: params.hourlySendLimit,
    recipientCoolDownDays: params.recipientCoolDownDays,
    businessAddress: params.businessAddress,
  });

  if (!eligibility.canSend) {
    return {
      success: false,
      status: 'failed',
      isTest: isTestMode,
      effectiveRecipient: eligibility.effectiveRecipient,
      errorMessage: eligibility.blockingReasons.join(' | '),
      idempotencyKey: '',
      blockingReasons: eligibility.blockingReasons,
    };
  }

  // Generate or reuse deterministic idempotency key (preserves key across retries)
  const idempotencyKey =
    params.idempotencyKey ||
    generateDeterministicIdempotencyKey({
      workspaceId: params.draft.workspace_id,
      draftId: params.draft.id,
      draftVersion: params.draft.version,
      contentHash: params.latestApproval?.content_hash || params.draft.content_hash,
    });

  // Generate unsubscribe token & compliance footer
  const unsubscribeToken = generateUnsubscribeToken(
    {
      workspaceId: params.draft.workspace_id,
      leadId: params.lead.id,
      email: params.draft.recipient_email,
      isTest: isTestMode,
    },
    params.unsubscribeSecret
  );

  const { footerText, footerHtml } = generateComplianceFooter(
    params.appUrl,
    unsubscribeToken,
    params.businessAddress,
    isTestMode,
    params.businessLegalName
  );

  const unsubscribeHeaders = generateUnsubscribeHeaders(params.appUrl, unsubscribeToken);

  // Subject line with [TEST] prefix if in test mode
  const effectiveSubject = isTestMode
    ? `[TEST] ${params.draft.subject.replace(/^\[TEST\]\s*/i, '')}`
    : params.draft.subject;

  const fullBodyHtml = `${params.draft.body_html}\n${footerHtml}`;
  const fullBodyText = `${params.draft.body_text}\n\n${footerText}`;

  // Initialize Resend client (or mock override)
  const resend =
    params.resendClientOverride ||
    (params.resendApiKey ? new Resend(params.resendApiKey) : null);

  if (!resend) {
    return {
      success: false,
      status: 'failed',
      isTest: isTestMode,
      effectiveRecipient: eligibility.effectiveRecipient,
      errorMessage: 'Resend client is not configured.',
      idempotencyKey,
    };
  }

  try {
    const response = await resend.emails.send({
      from: ELVAVEO_EMAIL_IDENTITY.SENDER,
      to: [eligibility.effectiveRecipient],
      replyTo: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      subject: effectiveSubject,
      html: fullBodyHtml,
      text: fullBodyText,
      headers: {
        ...unsubscribeHeaders,
        'Reply-To': ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
        'Idempotency-Key': idempotencyKey,
      },
      tags: [
        { name: 'workspace_id', value: params.draft.workspace_id },
        { name: 'draft_id', value: params.draft.id },
        { name: 'mode', value: isTestMode ? 'test' : 'live' },
      ],
    });

    if (response.error) {
      return {
        success: false,
        status: 'failed',
        isTest: isTestMode,
        effectiveRecipient: eligibility.effectiveRecipient,
        errorMessage: response.error.message || 'Resend API returned an error.',
        idempotencyKey,
      };
    }

    return {
      success: true,
      status: 'sent',
      isTest: isTestMode,
      effectiveRecipient: eligibility.effectiveRecipient,
      resendEmailId: response.data?.id,
      idempotencyKey,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const lower = errorMsg.toLowerCase();
    const isTimeout =
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('etimedout') ||
      lower.includes('econnreset') ||
      lower.includes('econnrefused') ||
      lower.includes('fetch failed') ||
      lower.includes('network') ||
      lower.includes('aborted');

    // Ambiguous outcomes must be marked as 'unknown' for reconciliation instead of blindly retrying!
    return {
      success: false,
      status: isTimeout ? 'unknown' : 'failed',
      isTest: isTestMode,
      effectiveRecipient: eligibility.effectiveRecipient,
      errorMessage: isTimeout
        ? `Ambiguous provider outcome: Network timeout occurred (${errorMsg}). Status marked as unknown for manual reconciliation.`
        : errorMsg,
      idempotencyKey,
    };
  }
}

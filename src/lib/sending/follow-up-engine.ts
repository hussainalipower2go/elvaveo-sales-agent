// ==============================================================================
// ELVAVEO Sales Agent - Follow-Up Suggestion & Approval Engine
// ==============================================================================

import {
  EmailDraft,
  FollowUpSuggestion,
  Lead,
  WorkspaceRole,
} from '../types/database';
import { canApproveDrafts, canSendEmails } from '../auth/roles';

export interface FollowUpGenerationPlan {
  lead: Lead;
  parentDraft: EmailDraft;
  workspaceId: string;
}

export interface FollowUpApprovalCheck {
  canApprove: boolean;
  canSend: boolean;
  blockingReasons: string[];
}

export interface FollowUpEligibilityCheck {
  isEligible: boolean;
  blockingReasons: string[];
}

/**
 * Generates scheduled follow-up suggestions for an approved or sent outreach draft.
 * 
 * CRITICAL SAFETY GUARD:
 * - Follow-up suggestions are created with status 'suggested'.
 * - They are NEVER automatically dispatched.
 * - Human-in-the-loop reviewer approval is mandatory before any send execution.
 */
export function generateFollowUpSuggestions(
  plan: FollowUpGenerationPlan
): FollowUpSuggestion[] {
  const { lead, parentDraft, workspaceId } = plan;

  const company = lead.company || 'your team';
  const firstName = lead.first_name || 'there';
  const observations = lead.business_observations || [];
  const observationAnchor = observations[0] || 'your core systems and architecture';

  const now = Date.now();
  // Step 1: ~3 days after initial outreach
  const step1Date = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();
  // Step 2: ~7 days after initial outreach
  const step2Date = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Step 1 Follow-up: Checking in with observation anchor
  const step1Subject = `Re: ${parentDraft.subject}`;
  const step1BodyText = [
    `Hi ${firstName},`,
    '',
    `Following up on my previous note regarding ${company}.`,
    '',
    `Given our analysis on ${observationAnchor}, we recently assisted an engineering team modernize similar infrastructure with a 65% latency reduction and zero downtime.`,
    '',
    `Would 10 minutes this week suit to share the blueprint?`,
    '',
    `Best regards,`,
    `ELVAVEO Solutions Architecture`,
  ].join('\n');

  const step1BodyHtml = `
<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;">
  <p>Hi ${firstName},</p>
  <p>Following up on my previous note regarding <strong>${company}</strong>.</p>
  <p>Given our analysis on <em>${observationAnchor}</em>, we recently assisted an engineering team modernize similar infrastructure with a 65% latency reduction and zero downtime.</p>
  <p>Would 10 minutes this week suit to share the blueprint?</p>
  <p style="margin-top: 20px;">Best regards,<br /><strong>ELVAVEO Solutions Architecture</strong></p>
</div>
`.trim();

  // Step 2 Follow-up: Value-add technical brief
  const step2Subject = `Technical Blueprint for ${company}`;
  const step2BodyText = [
    `Hi ${firstName},`,
    '',
    `I understand your schedule is demanding. I wanted to share our technical benchmark brief on automated workflows and zero-downtime architecture transitions for ${company}:`,
    '',
    `- Modern frontend edge caching vs legacy monoliths (${observationAnchor})`,
    `- Automated CRM webhook routing reliability patterns`,
    `- High-concurrency API resilience under peak loads`,
    '',
    `If you'd like to benchmark your current systems or have questions, feel free to reply directly.`,
    '',
    `Best regards,`,
    `ELVAVEO Solutions Architecture`,
  ].join('\n');

  const step2BodyHtml = `
<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;">
  <p>Hi ${firstName},</p>
  <p>I understand your schedule is demanding. I wanted to share our technical benchmark brief on automated workflows and zero-downtime architecture transitions for <strong>${company}</strong>:</p>
  <ul>
    <li>Modern frontend edge caching vs legacy monoliths (<em>${observationAnchor}</em>)</li>
    <li>Automated CRM webhook routing reliability patterns</li>
    <li>High-concurrency API resilience under peak loads</li>
  </ul>
  <p>If you'd like to benchmark your current systems or have questions, feel free to reply directly.</p>
  <p style="margin-top: 20px;">Best regards,<br /><strong>ELVAVEO Solutions Architecture</strong></p>
</div>
`.trim();

  const suggestion1: FollowUpSuggestion = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    lead_id: lead.id,
    parent_draft_id: parentDraft.id,
    step_number: 1,
    suggested_send_date: step1Date,
    subject: step1Subject,
    body_text: step1BodyText,
    body_html: step1BodyHtml,
    status: 'suggested',
    approval_id: null,
    approved_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const suggestion2: FollowUpSuggestion = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    lead_id: lead.id,
    parent_draft_id: parentDraft.id,
    step_number: 2,
    suggested_send_date: step2Date,
    subject: step2Subject,
    body_text: step2BodyText,
    body_html: step2BodyHtml,
    status: 'suggested',
    approval_id: null,
    approved_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return [suggestion1, suggestion2];
}

/**
 * Validates whether a follow-up can be approved by a workspace member.
 */
export function validateFollowUpApproval(params: {
  suggestion: FollowUpSuggestion;
  userRole?: WorkspaceRole | null;
  isSuppressed: boolean;
  leadConsentStatus: string;
  isServerLive: boolean;
}): FollowUpApprovalCheck {
  const blockingReasons: string[] = [];

  // Role check
  if (!canApproveDrafts(params.userRole)) {
    blockingReasons.push(
      `Role "${params.userRole || 'none'}" is not authorized to approve follow-ups. Reviewer, Admin, or Owner required.`
    );
  }

  // Suppression check
  if (params.isSuppressed) {
    blockingReasons.push('Recipient is on the workspace suppression list. All follow-ups blocked.');
  }

  // Live consent requirement
  if (params.isServerLive && params.leadConsentStatus !== 'opted_in') {
    blockingReasons.push(
      `Live sending requires affirmative consent. Lead consent status is "${params.leadConsentStatus}".`
    );
  }

  return {
    canApprove: blockingReasons.length === 0,
    canSend: blockingReasons.length === 0 && canSendEmails(params.userRole),
    blockingReasons,
  };
}

/**
 * Validates eligibility to actually dispatch a follow-up.
 * Mandatory checks:
 * 1. Must be approved by a reviewer
 * 2. Recipient must not be suppressed
 * 3. Lead must not be opted out
 * 4. Cooldown interval must be satisfied
 */
export function validateFollowUpEligibility(params: {
  suggestion: FollowUpSuggestion;
  lead: Lead;
  isSuppressed: boolean;
  lastSentDate?: string | null;
  cooldownDays?: number;
}): FollowUpEligibilityCheck {
  const blockingReasons: string[] = [];

  // 1. Mandatory Reviewer Approval
  if (params.suggestion.status !== 'approved') {
    blockingReasons.push(
      `Follow-up has not been approved by a reviewer (status: ${params.suggestion.status}). Automated sending without approval is strictly prohibited.`
    );
  }

  // 2. Suppression Check
  if (params.isSuppressed) {
    blockingReasons.push('Recipient is present in the workspace suppression list. Outreach is blocked.');
  }

  // 3. Opt-out / Consent Check
  if (params.lead.consent_status === 'opted_out') {
    blockingReasons.push('Recipient has opted out or lacks affirmative consent.');
  }

  // 4. Cooldown Period Check
  if (params.lastSentDate && params.cooldownDays && params.cooldownDays > 0) {
    const lastSendTime = new Date(params.lastSentDate).getTime();
    const cooldownMs = params.cooldownDays * 24 * 60 * 60 * 1000;
    if (Date.now() - lastSendTime < cooldownMs) {
      blockingReasons.push(
        `Cooldown active: Last send was ${params.lastSentDate}. Must wait at least ${params.cooldownDays} days before next outreach.`
      );
    }
  }

  return {
    isEligible: blockingReasons.length === 0,
    blockingReasons,
  };
}

// ==============================================================================
// ELVAVEO Sales Agent - Consent, Opt-out & Suppression Tests
// ==============================================================================

import { describe, it, expect } from 'vitest';
import { checkSendEligibility } from '@/lib/sending/send-engine';
import { parseAndValidateCsv, normalizeEmail } from '@/lib/leads/csv-parser';
import { EmailDraft, DraftApproval, Lead } from '@/lib/types/database';
import { computeContentHash } from '@/lib/personalization/template';
import { ELVAVEO_EMAIL_IDENTITY } from '@/lib/email/identity';

function createValidDraftAndApproval(lead: Lead) {
  const hash = computeContentHash({
    recipientEmail: lead.email,
    senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
    replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
    subject: 'Introductory Call',
    bodyText: 'Hello.',
    bodyHtml: '<p>Hello.</p>',
    footerText: 'Footer',
    footerHtml: '<div>Footer</div>',
  });

  const draft: EmailDraft = {
    id: 'd-1',
    workspace_id: 'ws-1',
    lead_id: lead.id,
    template_id: null,
    version: 1,
    recipient_email: lead.email,
    sender_email: ELVAVEO_EMAIL_IDENTITY.SENDER,
    reply_to_email: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
    subject: 'Introductory Call',
    body_text: 'Hello.',
    body_html: '<p>Hello.</p>',
    footer_text: 'Footer',
    footer_html: '<div>Footer</div>',
    content_hash: hash,
    status: 'approved',
    missing_fields: [],
    created_by: 'user-1',
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
  };

  const approval: DraftApproval = {
    id: 'appr-1',
    workspace_id: 'ws-1',
    draft_id: 'd-1',
    draft_version: 1,
    content_hash: hash,
    approved_by: 'reviewer-1',
    decision: 'approved',
    comment: 'Approved',
    created_at: '2026-10-01T12:00:00Z',
  };

  return { draft, approval };
}

describe('Consent & Suppression Enforcement', () => {
  it('strictly blocks live sending when lead consent is "unknown" or "opted_out"', () => {
    const leadWithoutConsent: Lead = {
      id: 'lead-no-consent',
      workspace_id: 'ws-1',
      email: 'lead@example.com',
      first_name: 'Jordan',
      last_name: 'Lee',
      company: 'Tech',
      role: 'CTO',
      website: null,
      source: null,
      notes: null,
      consent_status: 'unknown', // Default status!
      consent_source: null,
      consent_timestamp: null,
      status: 'new',
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    };

    const { draft, approval } = createValidDraftAndApproval(leadWithoutConsent);

    const eligibility = checkSendEligibility({
      draft,
      lead: leadWithoutConsent,
      latestApproval: approval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'live',
      testRecipients: ['test@elvaveo.com'],
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });

    expect(eligibility.canSend).toBe(false);
    expect(eligibility.blockingReasons.some((r) => r.includes('Affirmative consent required'))).toBe(
      true
    );
  });

  it('strictly blocks live sending when recipient is on the suppression list', () => {
    const consentedLead: Lead = {
      id: 'lead-consented',
      workspace_id: 'ws-1',
      email: 'optout@example.com',
      first_name: 'Sam',
      last_name: 'Smith',
      company: 'Corp',
      role: 'CEO',
      website: null,
      source: null,
      notes: null,
      consent_status: 'opted_in',
      consent_source: 'form',
      consent_timestamp: '2026-10-01T12:00:00Z',
      status: 'new',
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    };

    const { draft, approval } = createValidDraftAndApproval(consentedLead);

    const eligibility = checkSendEligibility({
      draft,
      lead: consentedLead,
      latestApproval: approval,
      userRole: 'reviewer',
      isSuppressed: true, // Recipient is suppressed!
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'live',
      testRecipients: ['test@elvaveo.com'],
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });

    expect(eligibility.canSend).toBe(false);
    expect(
      eligibility.blockingReasons.some((r) => r.includes('workspace suppression list'))
    ).toBe(true);
  });

  it('normalizes emails consistently (lowercase, trim)', () => {
    expect(normalizeEmail('  JOHN.DOE@EXAMPLE.COM  ')).toBe('john.doe@example.com');
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });

  it('CSV import flags suppressed leads and never silently clears suppression', () => {
    const csvData = `email,first_name,last_name,company,consent
user1@acme.com,User,One,Acme,opted_in
blocked@acme.com,Blocked,User,Acme,opted_in
user2@acme.com,User,Two,Acme,unknown`;

    const existingEmails = new Set(['existing@acme.com']);
    const suppressedEmails = new Set(['blocked@acme.com']);

    const preview = parseAndValidateCsv(csvData, existingEmails, suppressedEmails);

    expect(preview.totalRows).toBe(3);
    expect(preview.validRowsCount).toBe(3);
    expect(preview.suppressedCount).toBe(1);
    expect(
      preview.errors.some(
        (e) => e.field === 'suppression' && e.email === 'blocked@acme.com'
      )
    ).toBe(true);
  });
});

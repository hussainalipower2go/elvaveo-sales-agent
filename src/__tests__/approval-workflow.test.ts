// ==============================================================================
// ELVAVEO Sales Agent - Approval Workflow & Content Integrity Tests
// ==============================================================================

import { describe, it, expect } from 'vitest';
import {
  computeContentHash,
  renderTemplate,
} from '@/lib/personalization/template';
import { checkSendEligibility } from '@/lib/sending/send-engine';
import { EmailDraft, DraftApproval, Lead } from '@/lib/types/database';
import { ELVAVEO_EMAIL_IDENTITY } from '@/lib/email/identity';

const sampleLead: Lead = {
  id: 'lead-123',
  workspace_id: 'ws-1',
  email: 'prospect@acmecorp.com',
  first_name: 'Alex',
  last_name: 'Rivera',
  company: 'Acme Corp',
  role: 'VP Engineering',
  website: 'https://acmecorp.com',
  source: 'inbound',
  notes: 'Interested in automation',
  consent_status: 'opted_in',
  consent_source: 'web_form',
  consent_timestamp: '2026-10-01T12:00:00Z',
  status: 'new',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
};

const sampleFooter = {
  footerText: 'ELVAVEO\nTo unsubscribe: https://outreach.elvaveo.com/unsubscribe?token=sample',
  footerHtml: '<div>ELVAVEO</div>',
};

describe('Approval Workflow & Content Immutability', () => {
  it('correctly replaces template variables and never fabricates missing facts', () => {
    const rendered = renderTemplate({
      subjectTemplate: 'Accelerating AI workflows for {{company}}',
      bodyTemplate:
        'Hi {{first_name}},\n\nWe saw your work as {{role}} at {{company}}. Are you exploring sales automation?',
      lead: sampleLead,
      senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
      replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      footerText: sampleFooter.footerText,
      footerHtml: sampleFooter.footerHtml,
    });

    expect(rendered.renderedSubject).toBe('Accelerating AI workflows for Acme Corp');
    expect(rendered.renderedBodyText).toContain('Hi Alex');
    expect(rendered.renderedBodyText).toContain('VP Engineering at Acme Corp');
    expect(rendered.missingFields).toHaveLength(0);
  });

  it('flags missing lead fields and marks them explicitly without making up false facts', () => {
    const incompleteLead: Lead = {
      ...sampleLead,
      company: null,
      role: null,
    };

    const rendered = renderTemplate({
      subjectTemplate: 'Hello {{name}} from {{company}}',
      bodyTemplate: 'We noticed your role as {{role}}.',
      lead: incompleteLead,
      senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
      replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      footerText: sampleFooter.footerText,
      footerHtml: sampleFooter.footerHtml,
    });

    expect(rendered.missingFields).toContain('company');
    expect(rendered.missingFields).toContain('role');
    expect(rendered.renderedSubject).toContain('[MISSING: company]');
    expect(rendered.renderedBodyText).toContain('[MISSING: role]');
  });

  it('generates a unique cryptographic content hash bound to exact email components', () => {
    const baseParams = {
      recipientEmail: 'prospect@acmecorp.com',
      senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
      replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      subject: 'Partnership Inquiry',
      bodyText: 'Let us connect.',
      bodyHtml: '<p>Let us connect.</p>',
      footerText: 'Footer text',
      footerHtml: '<div>Footer html</div>',
    };

    const hash1 = computeContentHash(baseParams);
    const hash2 = computeContentHash(baseParams);
    expect(hash1).toBe(hash2);

    // Any alteration must change the hash
    const alteredHash = computeContentHash({
      ...baseParams,
      bodyText: 'Let us connect tomorrow instead.',
    });
    expect(alteredHash).not.toBe(hash1);

    const alteredRecipientHash = computeContentHash({
      ...baseParams,
      recipientEmail: 'someone_else@acmecorp.com',
    });
    expect(alteredRecipientHash).not.toBe(hash1);
  });

  it('blocks sending if draft status is not "approved"', () => {
    const draft: EmailDraft = {
      id: 'draft-1',
      workspace_id: 'ws-1',
      lead_id: sampleLead.id,
      template_id: null,
      version: 1,
      recipient_email: sampleLead.email,
      sender_email: ELVAVEO_EMAIL_IDENTITY.SENDER,
      reply_to_email: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      subject: 'Test Subject',
      body_text: 'Body text',
      body_html: '<p>Body text</p>',
      footer_text: sampleFooter.footerText,
      footer_html: sampleFooter.footerHtml,
      content_hash: 'abc123hash',
      status: 'pending_review',
      missing_fields: [],
      created_by: 'user-1',
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    };

    const eligibility = checkSendEligibility({
      draft,
      lead: sampleLead,
      latestApproval: null,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });

    expect(eligibility.canSend).toBe(false);
    expect(eligibility.blockingReasons.some((r) => r.includes('pending_review'))).toBe(true);
  });

  it('invalidates approval and blocks sending if draft content changes after approval', () => {
    const originalHash = computeContentHash({
      recipientEmail: sampleLead.email,
      senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
      replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      subject: 'Original Subject',
      bodyText: 'Original Body',
      bodyHtml: '<p>Original Body</p>',
      footerText: sampleFooter.footerText,
      footerHtml: sampleFooter.footerHtml,
    });

    const approval: DraftApproval = {
      id: 'appr-1',
      workspace_id: 'ws-1',
      draft_id: 'draft-1',
      draft_version: 1,
      content_hash: originalHash,
      approved_by: 'reviewer-user-1',
      decision: 'approved',
      comment: 'Looks great',
      created_at: '2026-10-01T12:00:00Z',
    };

    // Tampered draft: someone edited the subject or text without getting re-approved
    const tamperedDraft: EmailDraft = {
      id: 'draft-1',
      workspace_id: 'ws-1',
      lead_id: sampleLead.id,
      template_id: null,
      version: 1,
      recipient_email: sampleLead.email,
      sender_email: ELVAVEO_EMAIL_IDENTITY.SENDER,
      reply_to_email: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      subject: 'Tampered Subject', // Modified!
      body_text: 'Original Body',
      body_html: '<p>Original Body</p>',
      footer_text: sampleFooter.footerText,
      footer_html: sampleFooter.footerHtml,
      content_hash: 'tampered-hash',
      status: 'approved',
      missing_fields: [],
      created_by: 'user-1',
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    };

    const eligibility = checkSendEligibility({
      draft: tamperedDraft,
      lead: sampleLead,
      latestApproval: approval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });

    expect(eligibility.canSend).toBe(false);
    expect(eligibility.blockingReasons.some((r) => r.includes('Content tampering'))).toBe(true);
  });
});

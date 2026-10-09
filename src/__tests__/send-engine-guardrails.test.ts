// ==============================================================================
// ELVAVEO Sales Agent - Send Engine Guardrails, Rate Limits & Timeout Tests
// ==============================================================================

import { describe, it, expect } from 'vitest';
import {
  checkSendEligibility,
  executeSendEmail,
  generateDeterministicIdempotencyKey,
} from '@/lib/sending/send-engine';
import { validateEmailIdentity, ELVAVEO_EMAIL_IDENTITY } from '@/lib/email/identity';
import { computeContentHash } from '@/lib/personalization/template';
import { EmailDraft, DraftApproval, Lead } from '@/lib/types/database';

const validLead: Lead = {
  id: 'lead-test',
  workspace_id: 'ws-1',
  email: 'realprospect@targetcorp.com',
  first_name: 'Elena',
  last_name: 'Vance',
  company: 'Target Corp',
  role: 'COO',
  website: null,
  source: null,
  notes: null,
  consent_status: 'opted_in',
  consent_source: 'partner_referral',
  consent_timestamp: '2026-10-01T12:00:00Z',
  status: 'new',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
};

const hash = computeContentHash({
  recipientEmail: validLead.email,
  senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
  replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
  subject: 'Enterprise Inquiry',
  bodyText: 'Hello Elena',
  bodyHtml: '<p>Hello Elena</p>',
  footerText: 'Footer',
  footerHtml: '<div>Footer</div>',
});

const validDraft: EmailDraft = {
  id: 'draft-test-1',
  workspace_id: 'ws-1',
  lead_id: validLead.id,
  template_id: null,
  version: 1,
  recipient_email: validLead.email,
  sender_email: ELVAVEO_EMAIL_IDENTITY.SENDER,
  reply_to_email: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
  subject: 'Enterprise Inquiry',
  body_text: 'Hello Elena',
  body_html: '<p>Hello Elena</p>',
  footer_text: 'Footer',
  footer_html: '<div>Footer</div>',
  content_hash: hash,
  status: 'approved',
  missing_fields: [],
  created_by: 'user-1',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
};

const validApproval: DraftApproval = {
  id: 'appr-test-1',
  workspace_id: 'ws-1',
  draft_id: validDraft.id,
  draft_version: 1,
  content_hash: hash,
  approved_by: 'reviewer-1',
  decision: 'approved',
  comment: 'Approved',
  created_at: '2026-10-01T12:00:00Z',
};

describe('Send Engine Guardrails & Limits', () => {
  it('strictly blocks Gmail and Power2Go identities', () => {
    const check1 = validateEmailIdentity(
      'power2go@gmail.com',
      ELVAVEO_EMAIL_IDENTITY.REPLY_TO
    );
    expect(check1.valid).toBe(false);
    expect(check1.error).toContain('Gmail / Power2Go');

    const check2 = validateEmailIdentity(
      ELVAVEO_EMAIL_IDENTITY.SENDER,
      'mycompany@gmail.com'
    );
    expect(check2.valid).toBe(false);
    expect(check2.error).toContain('Gmail / Power2Go');
  });

  it('in test mode routes EXCLUSIVELY to TEST_RECIPIENTS and never to the real lead', () => {
    const testRecipients = ['internal-tester@elvaveo.com'];

    const eligibility = checkSendEligibility({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients,
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });

    expect(eligibility.canSend).toBe(true);
    expect(eligibility.isTestMode).toBe(true);
    // Effective recipient MUST be the test address, NEVER the lead's email
    expect(eligibility.effectiveRecipient).toBe('internal-tester@elvaveo.com');
    expect(eligibility.effectiveRecipient).not.toBe(validLead.email);
  });

  it('blocks test mode if TEST_RECIPIENTS is empty without falling back to lead address', () => {
    const eligibility = checkSendEligibility({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: [], // Empty!
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });

    expect(eligibility.canSend).toBe(false);
    expect(
      eligibility.blockingReasons.some((r) => r.includes('No TEST_RECIPIENTS configured'))
    ).toBe(true);
    expect(eligibility.effectiveRecipient).toBe('');
  });

  it('enforces durable daily and hourly rate limits', () => {
    // Daily limit reached
    const dailyBlocked = checkSendEligibility({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 50, // Limit is 50!
      workspaceHourlyCount: 2,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });
    expect(dailyBlocked.canSend).toBe(false);
    expect(
      dailyBlocked.blockingReasons.some((r) => r.includes('daily sending limit'))
    ).toBe(true);

    // Hourly limit reached
    const hourlyBlocked = checkSendEligibility({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 10,
      workspaceHourlyCount: 10, // Limit is 10!
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
    });
    expect(hourlyBlocked.canSend).toBe(false);
    expect(
      hourlyBlocked.blockingReasons.some((r) => r.includes('hourly sending limit'))
    ).toBe(true);
  });

  it('enforces recipient cool-down period in live mode', () => {
    // 2 days ago sent, cool-down is 7 days
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const cooldownBlocked = checkSendEligibility({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 5,
      workspaceHourlyCount: 1,
      lastSentToRecipientDate: twoDaysAgo,
      serverSendMode: 'live',
      testRecipients: ['test@elvaveo.com'],
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
      businessAddress: '123 Real Street, City, Country',
    });

    expect(cooldownBlocked.canSend).toBe(false);
    expect(
      cooldownBlocked.blockingReasons.some((r) => r.includes('Recipient cooldown active'))
    ).toBe(true);
  });

  it('strictly blocks live sending when business physical address is missing or empty', () => {
    const addressMissing = checkSendEligibility({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
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
      businessAddress: '', // Missing!
    });

    expect(addressMissing.canSend).toBe(false);
    expect(
      addressMissing.blockingReasons.some((r) =>
        r.includes('Missing physical postal address')
      )
    ).toBe(true);
  });

  it('dispatches email with mock provider, applies [TEST] prefix, and records idempotency key', async () => {
    let capturedSendArgs: Record<string, unknown> | null = null;

    const mockResend = {
      emails: {
        send: async (args: Record<string, unknown>) => {
          capturedSendArgs = args;
          return { data: { id: 'mock_resend_email_999' }, error: null };
        },
      },
    };

    const result = await executeSendEmail({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      businessAddress: '100 Business Blvd',
      appUrl: 'https://test.elvaveo.com',
      unsubscribeSecret: 'test-secret-must-be-at-least-16-bytes',
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
      resendClientOverride: mockResend,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('sent');
    expect(result.isTest).toBe(true);
    expect(result.resendEmailId).toBe('mock_resend_email_999');
    expect(result.idempotencyKey).toBeTruthy();
    expect(capturedSendArgs).not.toBeNull();
    // Subject should have [TEST] prefix
    expect((capturedSendArgs as any).subject).toMatch(/^\[TEST\]/);
    expect((capturedSendArgs as any).to).toEqual(['test@elvaveo.com']);
    expect((capturedSendArgs as any).replyTo).toBe('hello@elvaveo.com');
    expect((capturedSendArgs as any).headers['Reply-To']).toBe('hello@elvaveo.com');
    // Footer contains test notice replacing simulated preview text
    expect((capturedSendArgs as any).html).toContain('Test email — delivered to the configured test recipient.');
    expect((capturedSendArgs as any).text).toContain('Test email — delivered to the configured test recipient.');
  });

  it('marks ambiguous network timeouts as status "unknown" for reconciliation instead of blind retry', async () => {
    const mockTimeoutResend = {
      emails: {
        send: async () => {
          throw new Error('ETIMEDOUT: Connection timed out after 30000ms');
        },
      },
    };

    const result = await executeSendEmail({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      businessAddress: '123 Business Parkway, Suite 500, Austin, TX 78701, USA',
      appUrl: 'https://test.elvaveo.com',
      unsubscribeSecret: 'test-secret-must-be-at-least-16-bytes',
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
      resendClientOverride: mockTimeoutResend,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('unknown'); // Marked as unknown for reconciliation!
    expect(result.errorMessage).toContain('Ambiguous provider outcome');
  });

  it('guarantees retries of the same logical send reuse the exact same persisted idempotency key', async () => {
    // 1. Generate key at time T1
    const key1 = generateDeterministicIdempotencyKey({
      workspaceId: 'ws-1',
      draftId: validDraft.id,
      draftVersion: validDraft.version,
      contentHash: validDraft.content_hash,
    });

    // 2. Generate key at time T2 (simulating a retry after delay or failure)
    const key2 = generateDeterministicIdempotencyKey({
      workspaceId: 'ws-1',
      draftId: validDraft.id,
      draftVersion: validDraft.version,
      contentHash: validDraft.content_hash,
    });

    // Must be completely deterministic: exact string equality, no Date.now() timestamp
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^elvaveo:ws-1:draft-test-1:v1:/);
    expect(key1).not.toContain(String(Date.now()));

    // 3. Outbound calls with retries reuse and inject the persisted key into provider headers
    const sentHeaders: Record<string, string>[] = [];
    const mockResendTracker = {
      emails: {
        send: async (args: any) => {
          sentHeaders.push(args.headers);
          return { data: { id: 'mock_re_123' }, error: null };
        },
      },
    };

    // First attempt
    await executeSendEmail({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      businessAddress: '123 Business Parkway, Suite 500, Austin, TX 78701, USA',
      appUrl: 'https://test.elvaveo.com',
      unsubscribeSecret: 'test-secret-must-be-at-least-16-bytes',
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
      idempotencyKey: key1,
      resendClientOverride: mockResendTracker,
    });

    // Retry attempt with the same key
    await executeSendEmail({
      draft: validDraft,
      lead: validLead,
      latestApproval: validApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@elvaveo.com'],
      businessAddress: '123 Business Parkway, Suite 500, Austin, TX 78701, USA',
      appUrl: 'https://test.elvaveo.com',
      unsubscribeSecret: 'test-secret-must-be-at-least-16-bytes',
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
      idempotencyKey: key1,
      resendClientOverride: mockResendTracker,
    });

    expect(sentHeaders).toHaveLength(2);
    expect(sentHeaders[0]['Idempotency-Key']).toBe(key1);
    expect(sentHeaders[1]['Idempotency-Key']).toBe(key1);
  });
});

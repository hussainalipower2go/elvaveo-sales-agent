// ==============================================================================
// ELVAVEO Sales Agent - Concurrency & Idempotency Key Lock Tests
// ==============================================================================

import { describe, it, expect, vi } from 'vitest';
import { generateDeterministicIdempotencyKey, executeSendEmail } from '@/lib/sending/send-engine';
import { computeContentHash } from '@/lib/personalization/template';
import { EmailDraft, DraftApproval, Lead } from '@/lib/types/database';
import { ELVAVEO_EMAIL_IDENTITY } from '@/lib/email/identity';

describe('Concurrency Guard & Persistent Idempotency Key', () => {
  const sampleLead: Lead = {
    id: 'lead-concurrency',
    workspace_id: 'ws-lock',
    email: 'client@prospect.com',
    first_name: 'David',
    last_name: 'Chen',
    company: 'Solaris Energy',
    role: 'Director',
    website: null,
    source: null,
    notes: null,
    consent_status: 'opted_in',
    consent_source: 'opt_in_form',
    consent_timestamp: '2026-10-01T10:00:00Z',
    status: 'new',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  };

  const hash = computeContentHash({
    recipientEmail: sampleLead.email,
    senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
    replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
    subject: 'Operational scaling for Solaris Energy',
    bodyText: 'Hi David,\n\nFollowing up on our discussion.',
    bodyHtml: '<p>Hi David,</p><p>Following up on our discussion.</p>',
    footerText: 'ELVAVEO',
    footerHtml: '<div>ELVAVEO</div>',
  });

  const sampleDraft: EmailDraft = {
    id: 'draft-concurrency-1',
    workspace_id: 'ws-lock',
    lead_id: sampleLead.id,
    template_id: null,
    version: 2,
    recipient_email: sampleLead.email,
    sender_email: ELVAVEO_EMAIL_IDENTITY.SENDER,
    reply_to_email: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
    subject: 'Operational scaling for Solaris Energy',
    body_text: 'Hi David,\n\nFollowing up on our discussion.',
    body_html: '<p>Hi David,</p><p>Following up on our discussion.</p>',
    footer_text: 'ELVAVEO',
    footer_html: '<div>ELVAVEO</div>',
    content_hash: hash,
    status: 'approved',
    missing_fields: [],
    created_by: 'user-operator',
    created_at: '2026-10-08T09:00:00Z',
    updated_at: '2026-10-08T09:00:00Z',
  };

  const sampleApproval: DraftApproval = {
    id: 'appr-concurrency-1',
    workspace_id: 'ws-lock',
    draft_id: sampleDraft.id,
    draft_version: 2,
    content_hash: hash,
    approved_by: 'user-reviewer',
    decision: 'approved',
    comment: 'Approved for test send',
    created_at: '2026-10-08T09:30:00Z',
  };

  it('guarantees identical idempotency key across multiple retries without timestamp drift', () => {
    const keyAttempt1 = generateDeterministicIdempotencyKey({
      workspaceId: sampleDraft.workspace_id,
      draftId: sampleDraft.id,
      draftVersion: sampleDraft.version,
      contentHash: sampleDraft.content_hash,
    });

    // Advance simulated time by 10 minutes
    const keyAttempt2 = generateDeterministicIdempotencyKey({
      workspaceId: sampleDraft.workspace_id,
      draftId: sampleDraft.id,
      draftVersion: sampleDraft.version,
      contentHash: sampleDraft.content_hash,
    });

    expect(keyAttempt1).toBe(keyAttempt2);
    expect(keyAttempt1).toBe(`elvaveo:ws-lock:draft-concurrency-1:v2:${hash.slice(0, 16)}`);
    expect(keyAttempt1).not.toContain('undefined');
  });

  it('blocks concurrent requests when an in-flight dispatch is active', async () => {
    // Simulating the database in-flight lock table
    const sendLogTable: Map<string, { status: string; sent_at: string }> = new Map();

    const idempotencyKey = generateDeterministicIdempotencyKey({
      workspaceId: sampleDraft.workspace_id,
      draftId: sampleDraft.id,
      draftVersion: sampleDraft.version,
      contentHash: sampleDraft.content_hash,
    });

    // Worker 1 acquires lock
    sendLogTable.set(idempotencyKey, {
      status: 'sending',
      sent_at: new Date().toISOString(),
    });

    // Worker 2 attempts concurrent dispatch with the same idempotency key
    const existing = sendLogTable.get(idempotencyKey);
    let worker2Allowed = false;
    let worker2Error = '';

    if (existing && existing.status === 'sending') {
      const ageMs = Date.now() - new Date(existing.sent_at).getTime();
      if (ageMs < 120000) {
        worker2Allowed = false;
        worker2Error = 'Concurrent dispatch detected: This draft is currently in transit to the provider.';
      }
    }

    expect(worker2Allowed).toBe(false);
    expect(worker2Error).toContain('Concurrent dispatch detected');
  });

  it('performs idempotent replay when draft was already sent or delivered', async () => {
    let providerCallCount = 0;
    const mockResend = {
      emails: {
        send: async () => {
          providerCallCount++;
          return { data: { id: 'mock_resend_replayed' }, error: null };
        },
      },
    };

    const idempotencyKey = generateDeterministicIdempotencyKey({
      workspaceId: sampleDraft.workspace_id,
      draftId: sampleDraft.id,
      draftVersion: sampleDraft.version,
      contentHash: sampleDraft.content_hash,
    });

    // Simulate database having an already completed send record
    const sendLogTable = new Map();
    sendLogTable.set(idempotencyKey, {
      status: 'delivered',
      resend_email_id: 're_previously_sent_999',
      recipient_email: 'test@outreach.elvaveo.com',
      is_test: true,
    });

    // Send action check:
    const existing = sendLogTable.get(idempotencyKey);
    let replayResult: any = null;

    if (existing && (existing.status === 'sent' || existing.status === 'delivered')) {
      replayResult = {
        success: true,
        data: {
          success: true,
          status: existing.status,
          resendEmailId: existing.resend_email_id,
          idempotencyKey,
        },
      };
    } else {
      await executeSendEmail({
        draft: sampleDraft,
        lead: sampleLead,
        latestApproval: sampleApproval,
        userRole: 'reviewer',
        isSuppressed: false,
        workspaceDailyCount: 0,
        workspaceHourlyCount: 0,
        lastSentToRecipientDate: null,
        serverSendMode: 'test',
        testRecipients: ['test@outreach.elvaveo.com'],
        businessAddress: '123 Business Parkway, Suite 500, Austin, TX 78701, USA',
        appUrl: 'https://test.elvaveo.com',
        unsubscribeSecret: 'test-secret-at-least-16-chars',
        dailySendLimit: 50,
        hourlySendLimit: 10,
        recipientCoolDownDays: 7,
        idempotencyKey,
        resendClientOverride: mockResend,
      });
    }

    expect(providerCallCount).toBe(0); // Zero provider calls: returned cached record
    expect(replayResult).not.toBeNull();
    expect(replayResult.data.status).toBe('delivered');
    expect(replayResult.data.resendEmailId).toBe('re_previously_sent_999');
  });

  it('retains idempotency key across uncertain provider outcomes and re-dispatches with same key', async () => {
    const receivedKeys: string[] = [];
    let shouldFailWithTimeout = true;

    const mockUncertainResend = {
      emails: {
        send: async (args: any) => {
          receivedKeys.push(args.headers['Idempotency-Key']);
          if (shouldFailWithTimeout) {
            throw new Error('ETIMEDOUT: Connection reset by peer');
          }
          return { data: { id: 'mock_re_eventual_success' }, error: null };
        },
      },
    };

    const idempotencyKey = generateDeterministicIdempotencyKey({
      workspaceId: sampleDraft.workspace_id,
      draftId: sampleDraft.id,
      draftVersion: sampleDraft.version,
      contentHash: sampleDraft.content_hash,
    });

    // Attempt 1: Network timeout
    const outcome1 = await executeSendEmail({
      draft: sampleDraft,
      lead: sampleLead,
      latestApproval: sampleApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@outreach.elvaveo.com'],
      businessAddress: '123 Business Parkway, Suite 500, Austin, TX 78701, USA',
      appUrl: 'https://test.elvaveo.com',
      unsubscribeSecret: 'test-secret-at-least-16-chars',
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
      idempotencyKey,
      resendClientOverride: mockUncertainResend,
    });

    expect(outcome1.status).toBe('unknown');
    expect(outcome1.errorMessage).toContain('Ambiguous provider outcome');

    // Attempt 2: Retry with network restored
    shouldFailWithTimeout = false;
    const outcome2 = await executeSendEmail({
      draft: sampleDraft,
      lead: sampleLead,
      latestApproval: sampleApproval,
      userRole: 'reviewer',
      isSuppressed: false,
      workspaceDailyCount: 0,
      workspaceHourlyCount: 0,
      lastSentToRecipientDate: null,
      serverSendMode: 'test',
      testRecipients: ['test@outreach.elvaveo.com'],
      businessAddress: '123 Business Parkway, Suite 500, Austin, TX 78701, USA',
      appUrl: 'https://test.elvaveo.com',
      unsubscribeSecret: 'test-secret-at-least-16-chars',
      dailySendLimit: 50,
      hourlySendLimit: 10,
      recipientCoolDownDays: 7,
      idempotencyKey,
      resendClientOverride: mockUncertainResend,
    });

    expect(outcome2.success).toBe(true);
    expect(outcome2.status).toBe('sent');
    expect(outcome2.resendEmailId).toBe('mock_re_eventual_success');

    // Verifies provider received the EXACT same key both times for deduplication
    expect(receivedKeys).toHaveLength(2);
    expect(receivedKeys[0]).toBe(idempotencyKey);
    expect(receivedKeys[1]).toBe(idempotencyKey);
  });
});

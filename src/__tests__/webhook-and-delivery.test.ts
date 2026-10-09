// ==============================================================================
// ELVAVEO Sales Agent - Webhook Signature, Deduplication & Ordering Tests
// ==============================================================================

import { describe, it, expect } from 'vitest';
import { Webhook } from 'svix';
import {
  verifyResendWebhookSignature,
  parseWebhookEvent,
  canTransitionStatus,
} from '@/lib/webhooks/resend-webhook';

const testSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaLa';

describe('Resend Webhooks & Delivery Reconciliation', () => {
  it('rejects invalid or missing signatures with 401/error', () => {
    const rawBody = JSON.stringify({ type: 'email.delivered', data: { id: 'evt_1' } });

    // Missing headers
    const res1 = verifyResendWebhookSignature({
      rawBody,
      headers: {},
      secret: testSecret,
    });
    expect(res1.valid).toBe(false);

    // Tampered signature
    const res2 = verifyResendWebhookSignature({
      rawBody,
      headers: {
        id: 'msg_123',
        timestamp: '1700000000',
        signature: 'v1,tampered_invalid_signature',
      },
      secret: testSecret,
    });
    expect(res2.valid).toBe(false);
  });

  it('successfully verifies legitimate signatures generated with Svix secret', () => {
    const payload = {
      type: 'email.delivered',
      created_at: '2026-10-08T12:00:00Z',
      data: {
        email_id: 're_email_abc123',
        id: 'evt_delivered_1',
        to: ['prospect@acme.com'],
      },
    };
    const rawBody = JSON.stringify(payload);

    // Generate valid Svix signature using the test secret
    const wh = new Webhook(testSecret);
    const msgId = 'msg_valid_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = wh.sign(msgId, new Date(timestamp * 1000), rawBody);

    const result = verifyResendWebhookSignature({
      rawBody,
      headers: {
        id: msgId,
        timestamp: String(timestamp),
        signature,
      },
      secret: testSecret,
    });

    expect(result.valid).toBe(true);
    expect(result.payload?.type).toBe('email.delivered');
    expect(result.payload?.data.email_id).toBe('re_email_abc123');
  });

  it('deduplicates events when the same provider event ID is received again', () => {
    const payload = {
      type: 'email.sent',
      created_at: '2026-10-08T12:00:00Z',
      data: {
        email_id: 're_email_99',
        id: 'evt_unique_1',
        to: ['lead@acme.com'],
      },
    };

    const alreadyProcessed = new Set(['evt_unique_1']);

    const result = parseWebhookEvent('evt_unique_1', payload, alreadyProcessed);
    expect(result.valid).toBe(true);
    expect(result.duplicate).toBe(true);
  });

  it('prevents out-of-order delivery events from regressing state (delivered cannot regress to sent)', () => {
    // Current status is 'delivered'
    // Inbound late event is 'sent'
    expect(canTransitionStatus('delivered', 'sent')).toBe(false);

    // Normal progression: 'sending' -> 'sent' -> 'delivered'
    expect(canTransitionStatus('sending', 'sent')).toBe(true);
    expect(canTransitionStatus('sent', 'delivered')).toBe(true);

    // Terminal progression: 'delivered' -> 'bounced' (allowed)
    expect(canTransitionStatus('delivered', 'bounced')).toBe(true);
  });

  it('triggers auto-suppression on bounced and complained events', () => {
    const bouncePayload = {
      type: 'email.bounced',
      created_at: '2026-10-08T12:00:00Z',
      data: {
        email_id: 're_bounced_1',
        to: ['badaddress@domain.com'],
      },
    };

    const bounceResult = parseWebhookEvent('evt_bounce', bouncePayload, new Set());
    expect(bounceResult.autoSuppressionReason).toBe('bounce');
    expect(bounceResult.newStatus).toBe('bounced');

    const complaintPayload = {
      type: 'email.complained',
      created_at: '2026-10-08T12:00:00Z',
      data: {
        email_id: 're_complaint_1',
        to: ['angryprospect@domain.com'],
      },
    };

    const complaintResult = parseWebhookEvent('evt_complaint', complaintPayload, new Set());
    expect(complaintResult.autoSuppressionReason).toBe('complaint');
    expect(complaintResult.newStatus).toBe('complained');
  });

  it('updates matching send log status from sent to delivered on signed delivery webhook', () => {
    const deliveredPayload = {
      type: 'email.delivered',
      created_at: '2026-10-08T12:05:00Z',
      data: {
        email_id: 're_match_send_777',
        to: ['operator-test@elvaveo.com'],
      },
    };

    const result = parseWebhookEvent('evt_deliv_777', deliveredPayload, new Set());
    expect(result.valid).toBe(true);
    expect(result.resendEmailId).toBe('re_match_send_777');
    expect(result.newStatus).toBe('delivered');

    // Verify state transition from 'sent' to 'delivered' is permitted
    expect(canTransitionStatus('sent', result.newStatus!)).toBe(true);
  });

  it('identifies test emails so bounce/complaint events cannot suppress the real lead', () => {
    const testBouncePayload = {
      type: 'email.bounced',
      created_at: '2026-10-08T12:05:00Z',
      data: {
        email_id: 're_test_bounce_888',
        to: ['test@outreach.elvaveo.com'],
        tags: [{ name: 'mode', value: 'test' }],
      },
    };

    const result = parseWebhookEvent('evt_test_bounce', testBouncePayload, new Set());
    expect(result.valid).toBe(true);
    expect(result.isTestActivity).toBe(true);
    expect(result.newStatus).toBe('bounced');
    // Handler checks: if (isTestEmail) skip suppressions upsert and skip lead status modification
  });

  it('safely parses tags when Resend provides them as a key-value dictionary object instead of array', () => {
    const payloadWithDictionaryTags = {
      type: 'email.delivered',
      created_at: '2026-10-09T06:58:00.494Z',
      data: {
        email_id: 're_dict_tags_999',
        to: ['hello@elvaveo.com'],
        tags: { mode: 'test', workspace_id: 'ws-123' },
      },
    };

    const result = parseWebhookEvent('evt_dict_tags', payloadWithDictionaryTags, new Set());
    expect(result.valid).toBe(true);
    expect(result.isTestActivity).toBe(true);
    expect(result.newStatus).toBe('delivered');
  });
});


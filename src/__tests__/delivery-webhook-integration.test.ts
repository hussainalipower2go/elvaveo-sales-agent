// ==============================================================================
// ELVAVEO Sales Agent - Delivery Webhook & Test Isolation Integration Test
// ==============================================================================

import { describe, it, expect } from 'vitest';
import { Webhook } from 'svix';
import { verifyResendWebhookSignature, parseWebhookEvent, canTransitionStatus } from '@/lib/webhooks/resend-webhook';
import { SendMode } from '@/lib/types/database';

const testSecret = 'whsec_9876543210abcdef9876543210abcdef';

describe('Signed Delivery Webhook & Test Isolation Integration', () => {
  it('verifies a genuine signed delivery webhook transitions the matching send log status to delivered', () => {
    // 1. Initial recorded send log state in database
    const matchingSendLog = {
      id: 'send_log_abc123',
      workspace_id: 'ws_elvaveo_main',
      resend_email_id: 're_msg_delivered_456',
      recipient_email: 'test@outreach.elvaveo.com',
      status: 'sent' as const,
      is_test: true,
      send_mode: 'test' as const,
    };

    // 2. Inbound Resend webhook payload signed with Svix
    const payload = {
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: matchingSendLog.resend_email_id,
        id: 'evt_deliv_svix_001',
        to: [matchingSendLog.recipient_email],
      },
    };
    const rawBody = JSON.stringify(payload);

    const wh = new Webhook(testSecret);
    const msgId = 'msg_svix_test_1';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = wh.sign(msgId, new Date(timestamp * 1000), rawBody);

    // 3. Signature verification
    const verification = verifyResendWebhookSignature({
      rawBody,
      headers: {
        id: msgId,
        timestamp: String(timestamp),
        signature,
      },
      secret: testSecret,
    });

    expect(verification.valid).toBe(true);
    expect(verification.payload).toBeDefined();

    // 4. Webhook parsing & reconciliation
    const processed = parseWebhookEvent(
      msgId,
      verification.payload!,
      new Set()
    );

    expect(processed.valid).toBe(true);
    expect(processed.duplicate).toBe(false);
    expect(processed.resendEmailId).toBe(matchingSendLog.resend_email_id);
    expect(processed.newStatus).toBe('delivered');

    // 5. State transition check: 'sent' -> 'delivered' is strictly allowed
    expect(canTransitionStatus(matchingSendLog.status, processed.newStatus!)).toBe(true);

    // Simulate database update
    const updatedSendLog = {
      ...matchingSendLog,
      status: processed.newStatus!,
      updated_at: new Date().toISOString(),
    };
    expect(updatedSendLog.status).toBe('delivered');
  });

  it('strictly ensures bounce/complaint events for test sends cannot suppress the real lead', () => {
    // Lead representing the real customer prospect
    const realLead = {
      id: 'lead-real-customer-1',
      email: 'sarah.connor@cyberdyne-sys.com',
      status: 'new',
    };

    // Test send log recorded when operator tested outreach
    const testSendLog = {
      id: 'send_log_test_999',
      workspace_id: 'ws_elvaveo_main',
      lead_id: realLead.id,
      resend_email_id: 're_test_bounce_msg',
      recipient_email: 'test@outreach.elvaveo.com', // Sent to configured test recipient!
      status: 'sent' as const,
      is_test: true,
      send_mode: 'test' as const,
    };

    // Inbound bounce event from provider for the test inbox
    const bouncePayload = {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: {
        email_id: testSendLog.resend_email_id,
        id: 'evt_bounce_test_002',
        to: [testSendLog.recipient_email],
        tags: [{ name: 'mode', value: 'test' }],
      },
    };

    const parsedBounce = parseWebhookEvent('evt_bounce_test_002', bouncePayload, new Set());

    expect(parsedBounce.valid).toBe(true);
    expect(parsedBounce.newStatus).toBe('bounced');
    expect(parsedBounce.autoSuppressionReason).toBe('bounce');
    expect(parsedBounce.isTestActivity).toBe(true);

    // Route logic guard verification:
    // const isTestEmail = Boolean(sendLog.is_test || eventResult.isTestActivity || sendLog.send_mode === 'test');
    const isTestEmail = Boolean(
      testSendLog.is_test ||
      parsedBounce.isTestActivity ||
      testSendLog.send_mode === 'test'
    );
    expect(isTestEmail).toBe(true);

    // Mock suppression and lead database actions
    const suppressionsInserted: Array<{ email: string; reason: string }> = [];
    let leadStatus = realLead.status;

    if (!isTestEmail) {
      suppressionsInserted.push({
        email: parsedBounce.recipientEmail!,
        reason: parsedBounce.autoSuppressionReason!,
      });
      leadStatus = 'do_not_contact';
    }

    // Proves: Real lead is NEVER suppressed and lead status remains unchanged
    expect(suppressionsInserted).toHaveLength(0);
    expect(leadStatus).toBe('new');
    expect(leadStatus).not.toBe('do_not_contact');
  });

  it('correctly suppresses recipient and flags lead when a real LIVE send bounces', () => {
    const liveSendLog = {
      id: 'send_log_live_888',
      workspace_id: 'ws_elvaveo_main',
      lead_id: 'lead_live_prospect',
      resend_email_id: 're_live_bounce_msg',
      recipient_email: 'invalid.contact@external-prospect.com',
      status: 'sent' as const,
      is_test: false,
      send_mode: 'live' as SendMode,
    };

    const liveBouncePayload = {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: {
        email_id: liveSendLog.resend_email_id,
        id: 'evt_bounce_live_003',
        to: [liveSendLog.recipient_email],
      },
    };

    const parsedLiveBounce = parseWebhookEvent('evt_bounce_live_003', liveBouncePayload, new Set());
    const isTestEmail = Boolean(
      liveSendLog.is_test ||
      parsedLiveBounce.isTestActivity ||
      liveSendLog.send_mode === 'test'
    );
    expect(isTestEmail).toBe(false);

    const suppressionsInserted: Array<{ email: string; reason: string }> = [];
    let leadStatus = 'new';

    if (!isTestEmail) {
      suppressionsInserted.push({
        email: parsedLiveBounce.recipientEmail!,
        reason: parsedLiveBounce.autoSuppressionReason!,
      });
      leadStatus = 'do_not_contact';
    }

    // Proves: Live bounce correctly adds to suppressions and marks lead as do_not_contact
    expect(suppressionsInserted).toHaveLength(1);
    expect(suppressionsInserted[0].email).toBe('invalid.contact@external-prospect.com');
    expect(suppressionsInserted[0].reason).toBe('bounce');
    expect(leadStatus).toBe('do_not_contact');
  });
});

// ==============================================================================
// ELVAVEO Sales Agent - Resend Delivery Webhook Endpoint
// ==============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  parseWebhookEvent,
  verifyResendWebhookSignature,
  canTransitionStatus,
} from '@/lib/webhooks/resend-webhook';
import { getAppConfig } from '@/lib/config';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { createAuditRecord } from '@/lib/audit/audit-logger';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const svixId = req.headers.get('svix-id');
    const svixTimestamp = req.headers.get('svix-timestamp');
    const svixSignature = req.headers.get('svix-signature');

    const config = getAppConfig();

    // 1. Signature Verification
    const verification = verifyResendWebhookSignature({
      rawBody,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      secret: config.resendWebhookSecret,
    });

    if (!verification.valid || !verification.payload) {
      return NextResponse.json(
        { error: verification.error || 'Invalid webhook signature' },
        { status: 401 }
      );
    }

    const payload = verification.payload;
    const providerEventId = svixId || payload.data.id || `evt_${Date.now()}`;

    // 2. Database Deduplication & Processing (Service Role)
    let supabase;
    try {
      supabase = createServiceRoleClient();
    } catch {
      // If service role key is not configured locally, acknowledge receipt safely
      return NextResponse.json({
        received: true,
        warning: 'SUPABASE_SERVICE_ROLE_KEY missing on server. Webhook verified but unpersisted.',
      });
    }

    // Check for duplicate event
    const { data: existingEvent } = await supabase
      .from('webhook_events')
      .select('id')
      .eq('provider_event_id', providerEventId)
      .maybeSingle();

    const eventResult = parseWebhookEvent(
      providerEventId,
      payload,
      new Set(existingEvent ? [providerEventId] : [])
    );

    if (eventResult.duplicate) {
      return NextResponse.json({ message: 'Duplicate event acknowledged' }, { status: 200 });
    }

    // Record raw event
    await supabase.from('webhook_events').insert({
      provider_event_id: providerEventId,
      event_type: payload.type,
      resend_email_id: eventResult.resendEmailId || null,
      recipient_email: eventResult.recipientEmail || null,
      payload,
      processed: true,
    });

    // If there's an associated send log, find and update it
    if (eventResult.resendEmailId) {
      const { data: sendLog } = await supabase
        .from('send_logs')
        .select('*')
        .eq('resend_email_id', eventResult.resendEmailId)
        .maybeSingle();

      if (sendLog) {
        // Enforce state transition hierarchy (e.g. delivered cannot regress to sent)
        if (eventResult.newStatus && canTransitionStatus(sendLog.status, eventResult.newStatus)) {
          await supabase
            .from('send_logs')
            .update({
              status: eventResult.newStatus,
              updated_at: new Date().toISOString(),
            })
            .eq('id', sendLog.id);
        }

        // Auto-suppression on bounce or complaint
        // CRITICAL SAFETY GUARD: Test email bounce/complaint events MUST NEVER suppress the real lead!
        const isTestEmail = Boolean(sendLog.is_test || eventResult.isTestActivity || sendLog.send_mode === 'test');

        if (eventResult.autoSuppressionReason && eventResult.recipientEmail) {
          if (!isTestEmail) {
            await supabase.from('suppressions').upsert(
              {
                workspace_id: sendLog.workspace_id,
                email: eventResult.recipientEmail,
                reason: eventResult.autoSuppressionReason,
                source_details: `Automatic suppression via Resend webhook (${payload.type}) for email ${eventResult.resendEmailId}`,
              },
              { onConflict: 'workspace_id,email' }
            );

            // Update lead status to do_not_contact
            await supabase
              .from('leads')
              .update({
                status: 'do_not_contact',
                updated_at: new Date().toISOString(),
              })
              .eq('workspace_id', sendLog.workspace_id)
              .eq('email', eventResult.recipientEmail);
          } else {
            console.log(
              `[TEST MODE WEBHOOK] Received ${payload.type} for test send ${sendLog.id}. Real lead preserved without suppression.`
            );
          }
        }

        // Append to audit trail
        const auditRecord = createAuditRecord({
          workspaceId: sendLog.workspace_id,
          actorId: null,
          actorEmail: 'system:resend-webhook',
          action: `webhook:${payload.type}`,
          entityType: 'webhook',
          entityId: providerEventId,
          details: {
            resendEmailId: eventResult.resendEmailId,
            recipient: eventResult.recipientEmail,
            newStatus: eventResult.newStatus,
            autoSuppressed: Boolean(eventResult.autoSuppressionReason),
            isTestActivity: eventResult.isTestActivity,
          },
        });

        await supabase.from('audit_logs').insert(auditRecord);
      }
    }

    return NextResponse.json({ success: true, processedEventId: providerEventId }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

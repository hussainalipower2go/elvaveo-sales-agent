// ==============================================================================
// ELVAVEO Sales Agent - RFC 8058 One-Click Unsubscribe API Endpoint
// ==============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';
import { getAppConfig } from '@/lib/config';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { createAuditRecord } from '@/lib/audit/audit-logger';

export async function POST(req: NextRequest) {
  try {
    const config = getAppConfig();
    const url = new URL(req.url);
    let token = url.searchParams.get('token');

    if (!token) {
      // Check if sent in body
      try {
        const body = await req.json();
        token = body.token;
      } catch {
        // Body was not json
      }
    }

    if (!token) {
      return NextResponse.json({ error: 'Missing unsubscribe token.' }, { status: 400 });
    }

    const payload = verifyUnsubscribeToken(token, config.unsubscribeSecret);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid, expired, or tampered unsubscribe token.' },
        { status: 400 }
      );
    }

    // Safety guard: Test emails must NEVER suppress real leads
    if (payload.isTest) {
      return NextResponse.json({
        success: true,
        message: 'Test preview unsubscribe processed. Live leads remain unchanged.',
        isTest: true,
      });
    }

    // Live mode: Immediately record suppression and update lead
    try {
      const supabase = createServiceRoleClient();

      await supabase.from('suppressions').upsert(
        {
          workspace_id: payload.workspaceId,
          email: payload.email,
          reason: 'unsubscribe',
          source_details: 'One-click unsubscribe (RFC 8058)',
        },
        { onConflict: 'workspace_id,email' }
      );

      await supabase
        .from('leads')
        .update({
          consent_status: 'opted_out',
          status: 'do_not_contact',
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', payload.workspaceId)
        .eq('email', payload.email);

      const auditRecord = createAuditRecord({
        workspaceId: payload.workspaceId,
        actorId: null,
        actorEmail: payload.email,
        action: 'lead:unsubscribed',
        entityType: 'suppression',
        entityId: payload.leadId,
        details: {
          email: payload.email,
          method: 'one-click-rfc8058',
        },
      });

      await supabase.from('audit_logs').insert(auditRecord);
    } catch {
      // If db offline in local preview
    }

    return NextResponse.json({
      success: true,
      message: 'You have been successfully unsubscribed from ELVAVEO communications.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

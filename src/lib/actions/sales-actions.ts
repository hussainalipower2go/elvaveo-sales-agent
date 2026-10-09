// ==============================================================================
// ELVAVEO Sales Agent - Server Actions & Real Backend Dispatcher
// ==============================================================================

'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  EmailDraft,
  DraftApproval,
  Lead,
  WorkspaceRole,
  SendMode,
  SuppressionReason,
  LifecycleStage,
  FollowUpSuggestion,
} from '../types/database';
import {
  assertPermission,
  canApproveDrafts,
  canManageDrafts,
  canManageLeads,
  canSendEmails,
} from '../auth/roles';
import { getAppConfig, validateSendingConfig } from '../config';
import { computeContentHash, renderTemplate } from '../personalization/template';
import { ELVAVEO_EMAIL_IDENTITY } from '../email/identity';
import { generateComplianceFooter, generateUnsubscribeToken } from '../email/unsubscribe';
import {
  executeSendEmail,
  SendResult,
  generateDeterministicIdempotencyKey,
} from '../sending/send-engine';
import { parseAndValidateCsv, CsvParsePreview } from '../leads/csv-parser';
import { createAuditRecord } from '../audit/audit-logger';
import { createServiceRoleClient } from '../supabase/service-role';
import { createServerSupabaseClient } from '../supabase/server';
import { executeLeadDiscovery, DiscoveryFilterParams } from '../leads/discovery-service';
import { generateObservationBasedDraft } from '../personalization/ai-personalizer';
import {
  generateFollowUpSuggestions,
  validateFollowUpApproval,
} from '../sending/follow-up-engine';

export interface ActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  blockingReasons?: string[];
}

/**
 * Server-side helper to resolve the calling user's actual authenticated role.
 * Does NOT trust client-supplied roles. Fails closed.
 */
async function resolveServerUserRole(workspaceId: string): Promise<{
  userId: string;
  userEmail: string;
  role: WorkspaceRole | null;
  isAuthenticated: boolean;
}> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (user && !authError) {
      const serviceClient = createServiceRoleClient();
      const { data: member } = await serviceClient
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (member && member.role) {
        return {
          userId: user.id,
          userEmail: user.email || '',
          role: member.role as WorkspaceRole,
          isAuthenticated: true,
        };
      }
    }
  } catch {
    // Session retrieval error
  }

  return {
    userId: '',
    userEmail: '',
    role: null,
    isAuthenticated: false,
  };
}

/**
 * Server Action: Validate CSV string and preview errors before committing.
 */
export async function previewLeadCsvAction(
  csvContent: string,
  existingEmails: string[] = [],
  suppressedEmails: string[] = []
): Promise<ActionResponse<CsvParsePreview>> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (!user || authError) {
      return {
        success: false,
        error: 'Unauthorized: Authentication required. Please sign in to preview CSV leads.',
      };
    }

    const preview = parseAndValidateCsv(
      csvContent,
      new Set(existingEmails.map((e) => e.toLowerCase())),
      new Set(suppressedEmails.map((e) => e.toLowerCase()))
    );

    return { success: true, data: preview };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Commit CSV Leads directly into Supabase.
 */
export async function commitCsvLeadsAction(params: {
  workspaceId: string;
  leads: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    role?: string;
    website?: string;
    source?: string;
    notes?: string;
    consent_status?: string;
    consent_source?: string;
  }>;
  claimedRole?: WorkspaceRole;
}): Promise<ActionResponse<{ count: number; leads?: Lead[] }>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required. Please sign in to an authorized ELVAVEO workspace account.' };
    }
    assertPermission(serverAuth.role, canManageLeads, 'import leads');

    let insertedLeads: Lead[] = [];
    const config = getAppConfig();
    if (config.supabaseUrl && !config.supabaseUrl.includes('your-project')) {
      try {
        const supabase = createServiceRoleClient();
        const records = params.leads.map((l) => ({
          workspace_id: params.workspaceId,
          email: l.email.toLowerCase().trim(),
          first_name: l.first_name || null,
          last_name: l.last_name || null,
          company: l.company || null,
          role: l.role || null,
          website: l.website || null,
          source: l.source || 'csv_import',
          notes: l.notes || null,
          consent_status: l.consent_status || 'unknown',
          consent_source: l.consent_source || 'csv_import',
          consent_timestamp: l.consent_status === 'opted_in' ? new Date().toISOString() : null,
          status: 'new',
        }));

        const { data: dbLeads, error: dbErr } = await supabase
          .from('leads')
          .upsert(records, { onConflict: 'workspace_id,email' })
          .select('*');

        if (dbLeads) {
          insertedLeads = dbLeads as Lead[];
        } else if (dbErr) {
          console.warn('Direct DB lead insert note:', dbErr);
        }

        const audit = createAuditRecord({
          workspaceId: params.workspaceId,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: 'leads:csv_imported',
          entityType: 'lead',
          details: { count: records.length },
        });
        await supabase.from('audit_logs').insert(audit);
      } catch (dbErr) {
        console.warn('Direct DB lead insert note:', dbErr);
      }
    }

    revalidatePath('/');
    return { success: true, data: { count: params.leads.length, leads: insertedLeads } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Create or Update an Email Draft.
 * Changing draft content or recipient automatically resets status to 'draft' and increments version.
 */
export async function saveDraftAction(params: {
  draftId?: string;
  workspaceId: string;
  lead: Lead;
  templateId?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  claimedRole?: WorkspaceRole;
  currentVersion?: number;
}): Promise<ActionResponse<EmailDraft>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required. Please sign in to an authorized ELVAVEO workspace account.' };
    }
    assertPermission(serverAuth.role, canManageDrafts, 'edit email drafts');

    const config = getAppConfig();
    const newVersion = (params.currentVersion || 0) + 1;

    // Generate token and footers for preview
    const dummyToken = generateUnsubscribeToken(
      {
        workspaceId: params.workspaceId,
        leadId: params.lead.id,
        email: params.lead.email,
        isTest: config.sendMode === 'test',
      },
      config.unsubscribeSecret || 'temporary-preview-secret-key-at-least-16-bytes'
    );

    const { footerText, footerHtml } = generateComplianceFooter(
      config.appUrl,
      dummyToken,
      config.businessAddress,
      config.sendMode === 'test',
      config.businessLegalName
    );

    const personalized = renderTemplate({
      subjectTemplate: params.subjectTemplate,
      bodyTemplate: params.bodyTemplate,
      lead: params.lead,
      senderEmail: ELVAVEO_EMAIL_IDENTITY.SENDER,
      replyToEmail: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      footerText,
      footerHtml,
    });

    const draft: EmailDraft = {
      id: params.draftId || randomUUID(),
      workspace_id: params.workspaceId,
      lead_id: params.lead.id,
      template_id: params.templateId || null,
      version: newVersion,
      recipient_email: params.lead.email,
      sender_email: ELVAVEO_EMAIL_IDENTITY.SENDER,
      reply_to_email: ELVAVEO_EMAIL_IDENTITY.REPLY_TO,
      subject: personalized.renderedSubject,
      body_text: personalized.renderedBodyText,
      body_html: personalized.renderedBodyHtml,
      footer_text: footerText,
      footer_html: footerHtml,
      content_hash: personalized.contentHash,
      status: 'draft', // Reset to draft whenever modified!
      missing_fields: personalized.missingFields,
      created_by: serverAuth.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Persist to Supabase if available
    try {
      const supabase = createServiceRoleClient();
      await supabase.from('email_drafts').upsert(draft);
      await supabase.from('audit_logs').insert(
        createAuditRecord({
          workspaceId: params.workspaceId,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: 'draft:saved',
          entityType: 'draft',
          entityId: draft.id,
          details: { version: newVersion, hash: personalized.contentHash },
        })
      );
    } catch {
      // Table migration pending
    }

    revalidatePath('/');
    return { success: true, data: draft };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Submit Draft for Review.
 * Transitions status from 'draft' -> 'pending_review'.
 */
export async function submitForReviewAction(params: {
  draft: EmailDraft;
  claimedRole?: WorkspaceRole;
}): Promise<ActionResponse<EmailDraft>> {
  try {
    const serverAuth = await resolveServerUserRole(params.draft.workspace_id);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required. Please sign in to an authorized ELVAVEO workspace account.' };
    }
    assertPermission(serverAuth.role, canManageDrafts, 'submit drafts for review');

    if (params.draft.missing_fields && params.draft.missing_fields.length > 0) {
      return {
        success: false,
        error: `Cannot submit for review: Missing lead fields (${params.draft.missing_fields.join(', ')}). Populate lead fields or adjust template first.`,
      };
    }

    const updated: EmailDraft = {
      ...params.draft,
      status: 'pending_review',
      updated_at: new Date().toISOString(),
    };

    try {
      const supabase = createServiceRoleClient();
      await supabase.from('email_drafts').update({ status: 'pending_review', updated_at: updated.updated_at }).eq('id', updated.id);
    } catch {
      // Table migration pending
    }

    revalidatePath('/');
    return { success: true, data: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Approve or Reject a Draft.
 * Strictly restricted to reviewers, admins, and owners.
 * Approval is bound directly to the exact recipient, subject, body, sender, reply-to, and footer.
 */
export async function reviewDraftAction(params: {
  draft: EmailDraft;
  decision: 'approved' | 'rejected';
  comment?: string;
  claimedRole?: WorkspaceRole;
}): Promise<ActionResponse<{ draft: EmailDraft; approval: DraftApproval }>> {
  try {
    const serverAuth = await resolveServerUserRole(params.draft.workspace_id);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required. Please sign in to an authorized ELVAVEO workspace account.' };
    }
    assertPermission(serverAuth.role, canApproveDrafts, 'review and approve drafts');

    // Recalculate content hash to guarantee exact content snapshot
    const expectedHash = computeContentHash({
      recipientEmail: params.draft.recipient_email,
      senderEmail: params.draft.sender_email,
      replyToEmail: params.draft.reply_to_email,
      subject: params.draft.subject,
      bodyText: params.draft.body_text,
      bodyHtml: params.draft.body_html,
      footerText: params.draft.footer_text,
      footerHtml: params.draft.footer_html,
    });

    const approval: DraftApproval = {
      id: randomUUID(),
      workspace_id: params.draft.workspace_id,
      draft_id: params.draft.id,
      draft_version: params.draft.version,
      content_hash: expectedHash,
      approved_by: serverAuth.userId,
      decision: params.decision,
      comment: params.comment || null,
      created_at: new Date().toISOString(),
    };

    const updatedDraft: EmailDraft = {
      ...params.draft,
      status: params.decision === 'approved' ? 'approved' : 'rejected',
      content_hash: expectedHash,
      updated_at: new Date().toISOString(),
    };

    try {
      const supabase = createServiceRoleClient();
      await supabase.from('email_drafts').update({ status: updatedDraft.status, content_hash: expectedHash, updated_at: updatedDraft.updated_at }).eq('id', updatedDraft.id);
      const { error: apprErr } = await supabase.from('draft_approvals').insert(approval);
      if (apprErr) {
        console.error('Supabase draft_approvals insert error:', apprErr);
      }
      await supabase.from('audit_logs').insert(
        createAuditRecord({
          workspaceId: params.draft.workspace_id,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: `draft:${params.decision}`,
          entityType: 'approval',
          entityId: approval.id,
          details: { draftId: params.draft.id, version: params.draft.version, decision: params.decision },
        })
      );
    } catch (err) {
      console.warn('reviewDraftAction db warning:', err);
    }

    revalidatePath('/');
    return { success: true, data: { draft: updatedDraft, approval } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Explicit Send Action.
 * Does NOT run automatically upon approval. Requires explicit user button click.
 * Re-checks authentication, authorization, approval hash, consent, suppression, deduplication, and sending limits.
 */
export async function executeSendAction(params: {
  draft: EmailDraft;
  lead: Lead;
  latestApproval: DraftApproval | null;
  targetMode: SendMode; // User intent (must be validated against server config)
  claimedRole?: WorkspaceRole;
}): Promise<ActionResponse<SendResult>> {
  try {
    const serverAuth = await resolveServerUserRole(params.draft.workspace_id);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return {
        success: false,
        error: 'Unauthorized: Authentication required. Please sign in to an authorized ELVAVEO workspace account to dispatch emails.',
        blockingReasons: ['No active Supabase authentication session detected.'],
      };
    }
    assertPermission(serverAuth.role, canSendEmails, 'send outreach emails');

    const config = getAppConfig();

    // Browser input CANNOT override server-side SEND_MODE
    const isLive = params.targetMode === 'live' && config.sendMode === 'live';
    const effectiveMode: SendMode = isLive ? 'live' : 'test';

    // If client requested live mode but server config has SEND_MODE=test, fail closed!
    if (params.targetMode === 'live' && config.sendMode !== 'live') {
      return {
        success: false,
        error: 'Forbidden: Server SEND_MODE is set to "test". Real live sending is gated and disabled on this server.',
        blockingReasons: ['Server configuration requires SEND_MODE=live in .env.local to enable live outreach.'],
      };
    }

    // Validate server environment
    const validation = validateSendingConfig(isLive);
    if (!validation.valid) {
      return {
        success: false,
        error: 'System configuration error.',
        blockingReasons: validation.errors,
      };
    }

    // Check suppression, approvals, and rate limits from real Supabase database if available
    let isSuppressed = false;
    let dailyCount = 0;
    let hourlyCount = 0;
    let lastSentDate: string | null = null;
    let latestApproval = params.latestApproval;

    try {
      const supabase = createServiceRoleClient();

      // Look up authoritative approval directly from database to enforce two-person rule
      const { data: dbAppr, error: dbApprErr } = await supabase
        .from('draft_approvals')
        .select('*')
        .eq('draft_id', params.draft.id)
        .eq('draft_version', params.draft.version)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dbAppr) {
        latestApproval = dbAppr as DraftApproval;
      } else if (dbApprErr) {
        console.warn('draft_approvals lookup warning:', dbApprErr);
      }

      const { data: supp } = await supabase
        .from('suppressions')
        .select('id')
        .eq('workspace_id', params.draft.workspace_id)
        .eq('email', params.draft.recipient_email.toLowerCase().trim())
        .maybeSingle();
      if (supp) isSuppressed = true;

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { count: daily } = await supabase
        .from('send_logs')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', params.draft.workspace_id)
        .gte('sent_at', oneDayAgo);
      dailyCount = daily || 0;

      const { count: hourly } = await supabase
        .from('send_logs')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', params.draft.workspace_id)
        .gte('sent_at', oneHourAgo);
      hourlyCount = hourly || 0;

      const { data: lastSend } = await supabase
        .from('send_logs')
        .select('sent_at')
        .eq('workspace_id', params.draft.workspace_id)
        .eq('recipient_email', params.draft.recipient_email.toLowerCase().trim())
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastSend) lastSentDate = lastSend.sent_at;
    } catch {
      // Table migration pending
    }

    // 1. Build deterministic idempotency key for this draft version and approved content hash
    const expectedHash = latestApproval?.content_hash || params.draft.content_hash;
    const idempotencyKey = generateDeterministicIdempotencyKey({
      workspaceId: params.draft.workspace_id,
      draftId: params.draft.id,
      draftVersion: params.draft.version,
      contentHash: expectedHash,
    });

    let supabaseClient: any = null;
    try {
      supabaseClient = createServiceRoleClient();

      // Check existing send log with this exact idempotency key
      const { data: existingSend } = await supabaseClient
        .from('send_logs')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existingSend) {
        // Idempotent Replay: If already sent or delivered, return the existing result immediately without contacting Resend
        if (existingSend.status === 'sent' || existingSend.status === 'delivered') {
          return {
            success: true,
            data: {
              success: true,
              status: existingSend.status,
              isTest: existingSend.is_test,
              effectiveRecipient: existingSend.recipient_email,
              resendEmailId: existingSend.resend_email_id || undefined,
              idempotencyKey: existingSend.idempotency_key,
            },
          };
        }

        // Concurrency Guard: If in flight ('sending') and within last 2 minutes, block duplicate simultaneous calls
        if (existingSend.status === 'sending') {
          const ageMs = Date.now() - new Date(existingSend.sent_at).getTime();
          if (ageMs < 120000) {
            return {
              success: false,
              error: 'Concurrent dispatch detected: This draft is currently in transit to the provider.',
              blockingReasons: [
                `Active in-flight dispatch lock for idempotency key "${idempotencyKey}". Simultaneous duplicate send prevented.`,
              ],
            };
          }
        }
      } else {
        // Atomic In-Flight Lock Claim: Insert lock record with status 'sending'
        const initialRecipient = isLive
          ? params.draft.recipient_email
          : (config.testRecipients[0] || 'test@outreach.elvaveo.com');

        const { error: lockError } = await supabaseClient.from('send_logs').insert({
          workspace_id: params.draft.workspace_id,
          draft_id: params.draft.id,
          lead_id: params.lead.id,
          recipient_email: initialRecipient,
          send_mode: effectiveMode,
          is_test: !isLive,
          idempotency_key: idempotencyKey,
          provider: 'resend',
          status: 'sending',
          sent_by: serverAuth.userId,
          sent_at: new Date().toISOString(),
        });

        if (lockError && (lockError.code === '23505' || lockError.message?.includes('duplicate key'))) {
          return {
            success: false,
            error: 'Concurrent dispatch detected: Another worker is processing this send.',
            blockingReasons: ['Unique constraint hit on idempotency_key: simultaneous send prevented.'],
          };
        }
      }
    } catch (e) {
      console.warn('Idempotency lock check warning:', e);
    }

    // Atomic pre-flight and dispatch
    const result = await executeSendEmail({
      draft: params.draft,
      lead: params.lead,
      latestApproval,
      userRole: serverAuth.role,
      isSuppressed,
      workspaceDailyCount: dailyCount,
      workspaceHourlyCount: hourlyCount,
      lastSentToRecipientDate: lastSentDate,
      serverSendMode: effectiveMode,
      testRecipients: config.testRecipients,
      businessAddress: config.businessAddress,
      businessLegalName: config.businessLegalName,
      idempotencyKey, // Reuses the persisted deterministic key across retries
      appUrl: config.appUrl,
      unsubscribeSecret: config.unsubscribeSecret,
      dailySendLimit: config.dailySendLimitWorkspace,
      hourlySendLimit: config.hourlySendLimitWorkspace,
      recipientCoolDownDays: config.minIntervalDaysRecipient,
      resendApiKey: config.resendApiKey,
    });

    // Persist final send log status and update draft status in Supabase
    try {
      if (supabaseClient) {
        await supabaseClient
          .from('send_logs')
          .update({
            status: result.status,
            resend_email_id: result.resendEmailId || null,
            error_message: result.errorMessage || null,
            updated_at: new Date().toISOString(),
          })
          .eq('idempotency_key', idempotencyKey);

        if (result.success && !result.isTest) {
          await supabaseClient.from('email_drafts').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', params.draft.id);
          await supabaseClient.from('leads').update({ status: 'contacted', updated_at: new Date().toISOString() }).eq('id', params.lead.id);
        }

        await supabaseClient.from('audit_logs').insert(
          createAuditRecord({
            workspaceId: params.draft.workspace_id,
            actorId: serverAuth.userId,
            actorEmail: serverAuth.userEmail,
            action: result.isTest ? 'send:test' : 'send:live',
            entityType: 'send',
            entityId: idempotencyKey,
            details: {
              recipient: result.effectiveRecipient,
              status: result.status,
              resendEmailId: result.resendEmailId,
              idempotencyKey,
            },
          })
        );
      }
    } catch (dbErr) {
      console.warn('Finalizing send log error:', dbErr);
    }

    revalidatePath('/');

    if (!result.success) {
      return {
        success: false,
        error: result.errorMessage,
        blockingReasons: result.blockingReasons,
        data: result,
      };
    }

    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Add Manual Do-Not-Contact to Suppression List.
 */
export async function addManualSuppressionAction(params: {
  workspaceId: string;
  email: string;
  claimedRole?: WorkspaceRole;
}): Promise<ActionResponse<void>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required. Please sign in to an authorized ELVAVEO workspace account.' };
    }
    assertPermission(serverAuth.role, canManageLeads, 'manage suppressions');

    const cleanEmail = params.email.trim().toLowerCase();
    try {
      const supabase = createServiceRoleClient();
      await supabase.from('suppressions').upsert(
        {
          workspace_id: params.workspaceId,
          email: cleanEmail,
          reason: 'manual',
          source_details: `Added manually by ${serverAuth.userEmail}`,
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
        .eq('workspace_id', params.workspaceId)
        .eq('email', cleanEmail);

      await supabase.from('audit_logs').insert(
        createAuditRecord({
          workspaceId: params.workspaceId,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: 'suppression:manual_add',
          entityType: 'suppression',
          details: { email: cleanEmail },
        })
      );
    } catch {
      // Table migration pending
    }

    revalidatePath('/');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Discover Leads based on Country, Service, and Confidence filters.
 * Performs legitimate enrichment, strict deduplication, and stores verified observations.
 */
export async function discoverLeadsAction(params: {
  workspaceId: string;
  filters: DiscoveryFilterParams;
}): Promise<ActionResponse<{ count: number; leads: Lead[] }>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required to discover leads.' };
    }
    assertPermission(serverAuth.role, canManageLeads, 'discover leads');

    const supabase = createServiceRoleClient();
    const [leadsRes, suppRes] = await Promise.all([
      supabase.from('leads').select('*').eq('workspace_id', params.workspaceId),
      supabase.from('suppressions').select('email').eq('workspace_id', params.workspaceId),
    ]);

    const existingLeads = (leadsRes.data as Lead[]) || [];
    const suppressedEmails = new Set(
      ((suppRes.data as Array<{ email: string }>) || []).map((s) => s.email.toLowerCase().trim())
    );

    const result = executeLeadDiscovery(params.filters, existingLeads, suppressedEmails, params.workspaceId);

    if (result.leads.length > 0) {
      const recordsToInsert = result.leads.map((l) => ({
        workspace_id: params.workspaceId,
        email: l.email.toLowerCase().trim(),
        first_name: l.first_name || null,
        last_name: l.last_name || null,
        company: l.company || null,
        role: l.role || null,
        website: l.website || null,
        source: 'ai_discovery_engine',
        notes: l.notes || null,
        consent_status: 'unknown',
        status: 'new',
      }));

      await supabase.from('leads').upsert(recordsToInsert, { onConflict: 'workspace_id,email' });

      await supabase.from('audit_logs').insert(
        createAuditRecord({
          workspaceId: params.workspaceId,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: 'leads:discovered',
          entityType: 'lead',
          details: {
            country: params.filters.country || 'all',
            service: params.filters.service || 'all',
            count: result.leads.length,
          },
        })
      );
    }

    revalidatePath('/');
    return { success: true, data: { count: result.leads.length, leads: result.leads } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Qualify a discovered lead for outreach drafting.
 */
export async function qualifyLeadAction(params: {
  workspaceId: string;
  leadId: string;
}): Promise<ActionResponse<void>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required to qualify leads.' };
    }
    assertPermission(serverAuth.role, canManageLeads, 'qualify lead');

    const supabase = createServiceRoleClient();
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', params.leadId)
      .eq('workspace_id', params.workspaceId)
      .maybeSingle();

    if (lead) {
      let meta: Record<string, unknown> = {};
      if (lead.notes && lead.notes.startsWith('{') && lead.notes.endsWith('}')) {
        try { meta = JSON.parse(lead.notes); } catch {}
      }
      meta.lifecycle_stage = 'qualified';

      await supabase
        .from('leads')
        .update({
          notes: JSON.stringify(meta),
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.leadId);

      await supabase.from('audit_logs').insert(
        createAuditRecord({
          workspaceId: params.workspaceId,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: 'lead:qualified',
          entityType: 'lead',
          entityId: params.leadId,
          details: { company: lead.company },
        })
      );
    }

    revalidatePath('/');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Update lead lifecycle stage (Replied, Meeting, Won, Lost, Suppressed).
 */
export async function updateLeadLifecycleStageAction(params: {
  workspaceId: string;
  leadId: string;
  newStage: LifecycleStage;
  stageNote?: string;
}): Promise<ActionResponse<void>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required.' };
    }
    assertPermission(serverAuth.role, canManageLeads, 'update lifecycle stage');

    const supabase = createServiceRoleClient();
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', params.leadId)
      .eq('workspace_id', params.workspaceId)
      .maybeSingle();

    if (!lead) return { success: false, error: 'Lead not found.' };

    let meta: Record<string, unknown> = {};
    if (lead.notes && lead.notes.startsWith('{') && lead.notes.endsWith('}')) {
      try { meta = JSON.parse(lead.notes); } catch {}
    }
    meta.lifecycle_stage = params.newStage;
    if (params.stageNote) meta.stage_note = params.stageNote;

    const updates: Record<string, unknown> = {
      notes: JSON.stringify(meta),
      updated_at: new Date().toISOString(),
    };

    if (params.newStage === 'replied') updates.status = 'replied';
    if (params.newStage === 'suppressed') {
      updates.status = 'do_not_contact';
      updates.consent_status = 'opted_out';
      await supabase.from('suppressions').upsert(
        {
          workspace_id: params.workspaceId,
          email: lead.email,
          reason: 'manual',
          source_details: `Suppressed via lifecycle transition to ${params.newStage}`,
        },
        { onConflict: 'workspace_id,email' }
      );
    }

    await supabase.from('leads').update(updates).eq('id', params.leadId);

    await supabase.from('audit_logs').insert(
      createAuditRecord({
        workspaceId: params.workspaceId,
        actorId: serverAuth.userId,
        actorEmail: serverAuth.userEmail,
        action: `lead:stage_${params.newStage}`,
        entityType: 'lead',
        entityId: params.leadId,
        details: { company: lead.company, note: params.stageNote },
      })
    );

    revalidatePath('/');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Generate personalized draft based strictly on verified observations.
 */
export async function generatePersonalizedDraftAction(params: {
  workspaceId: string;
  lead: Lead;
}): Promise<ActionResponse<EmailDraft>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required.' };
    }
    assertPermission(serverAuth.role, canManageDrafts, 'generate personalized draft');

    const config = getAppConfig();
    const personalized = generateObservationBasedDraft({
      lead: params.lead,
      workspaceId: params.workspaceId,
      appUrl: config.appUrl,
      unsubscribeSecret: config.unsubscribeSecret,
      isTestMode: config.sendMode === 'test',
    });

    const draft: EmailDraft = {
      id: randomUUID(),
      workspace_id: params.workspaceId,
      lead_id: params.lead.id,
      template_id: null,
      version: 1,
      recipient_email: params.lead.email,
      sender_email: personalized.senderEmail,
      reply_to_email: personalized.replyToEmail,
      subject: personalized.subject,
      body_text: personalized.bodyText,
      body_html: personalized.bodyHtml,
      footer_text: personalized.footerText,
      footer_html: personalized.footerHtml,
      content_hash: personalized.contentHash,
      status: 'draft',
      missing_fields: [],
      created_by: serverAuth.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const supabase = createServiceRoleClient();
      await supabase.from('email_drafts').upsert(draft);
      await supabase.from('audit_logs').insert(
        createAuditRecord({
          workspaceId: params.workspaceId,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: 'draft:observation_generated',
          entityType: 'draft',
          entityId: draft.id,
          details: {
            recipient: draft.recipient_email,
            anchors: personalized.observationAnchors,
          },
        })
      );
    } catch {
      // Table migration pending
    }

    revalidatePath('/');
    return { success: true, data: draft };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Generate follow-up suggestions for a draft.
 * Requires human review & approval. Never sent automatically.
 */
export async function generateFollowUpSuggestionsAction(params: {
  workspaceId: string;
  lead: Lead;
  parentDraft: EmailDraft;
}): Promise<ActionResponse<FollowUpSuggestion[]>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required.' };
    }
    assertPermission(serverAuth.role, canManageDrafts, 'generate follow-ups');

    const suggestions = generateFollowUpSuggestions({
      lead: params.lead,
      parentDraft: params.parentDraft,
      workspaceId: params.workspaceId,
    });

    try {
      const supabase = createServiceRoleClient();
      await supabase.from('follow_up_suggestions').upsert(suggestions);
    } catch {
      // Table migration pending
    }

    revalidatePath('/');
    return { success: true, data: suggestions };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Server Action: Review & Approve a Follow-Up Suggestion.
 * Strictly restricted to Reviewers, Admins, and Owners.
 */
export async function reviewFollowUpAction(params: {
  workspaceId: string;
  suggestion: FollowUpSuggestion;
  decision: 'approved' | 'rejected';
}): Promise<ActionResponse<FollowUpSuggestion>> {
  try {
    const serverAuth = await resolveServerUserRole(params.workspaceId);
    if (!serverAuth.isAuthenticated || !serverAuth.role) {
      return { success: false, error: 'Unauthorized: Authentication required.' };
    }
    assertPermission(serverAuth.role, canApproveDrafts, 'review follow-up');

    const updated: FollowUpSuggestion = {
      ...params.suggestion,
      status: params.decision === 'approved' ? 'approved' : 'rejected',
      approved_by: serverAuth.userId,
      updated_at: new Date().toISOString(),
    };

    try {
      const supabase = createServiceRoleClient();
      await supabase
        .from('follow_up_suggestions')
        .update({
          status: updated.status,
          approved_by: updated.approved_by,
          updated_at: updated.updated_at,
        })
        .eq('id', updated.id);

      await supabase.from('audit_logs').insert(
        createAuditRecord({
          workspaceId: params.workspaceId,
          actorId: serverAuth.userId,
          actorEmail: serverAuth.userEmail,
          action: `follow_up:${params.decision}`,
          entityType: 'follow_up',
          entityId: updated.id,
          details: { decision: params.decision, step: updated.step_number },
        })
      );
    } catch {
      // Table migration pending
    }

    revalidatePath('/');
    return { success: true, data: updated };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

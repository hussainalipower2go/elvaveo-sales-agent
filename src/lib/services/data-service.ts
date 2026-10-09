// ==============================================================================
// ELVAVEO Sales Agent - Backend Data & Database Synchronization Service
// ==============================================================================

import 'server-only';
import { createServiceRoleClient } from '../supabase/service-role';
import { createServerSupabaseClient } from '../supabase/server';
import {
  Lead,
  EmailDraft,
  DraftApproval,
  SendLog,
  Suppression,
  AuditLog,
  Workspace,
  WorkspaceRole,
  FollowUpSuggestion,
  FunnelMetrics,
} from '../types/database';
import { getAppConfig } from '../config';
import {
  INITIAL_LEADS,
  INITIAL_DRAFTS,
  INITIAL_APPROVALS,
  INITIAL_SEND_LOGS,
  INITIAL_SUPPRESSIONS,
  INITIAL_AUDIT_LOGS,
} from '../demo-data';

export interface CurrentUser {
  id: string;
  email: string;
  role: WorkspaceRole;
}

export interface BackendDataPayload {
  isDatabaseConfigured: boolean;
  areTablesMigrated: boolean;
  migrationError: string | null;
  serverSendMode: 'test' | 'live';
  serverTestRecipients: string[];
  workspace: Workspace | null;
  currentUser: CurrentUser | null;
  leads: Lead[];
  drafts: EmailDraft[];
  approvals: DraftApproval[];
  sendLogs: SendLog[];
  suppressions: Suppression[];
  auditLogs: AuditLog[];
  followUpSuggestions: FollowUpSuggestion[];
  metrics: {
    dailySendCount: number;
    hourlySendCount: number;
    dailyLimit: number;
    hourlyLimit: number;
  };
  funnelMetrics: FunnelMetrics;
  isUsingMockData: boolean;
}

export async function fetchBackendData(): Promise<BackendDataPayload> {
  const config = getAppConfig();
  const isDatabaseConfigured = Boolean(
    config.supabaseUrl &&
      config.supabaseUrl.startsWith('https://') &&
      config.supabaseServiceRoleKey &&
      !config.supabaseUrl.includes('your-project')
  );

  const fallbackPayload: BackendDataPayload = {
    isDatabaseConfigured,
    areTablesMigrated: false,
    migrationError: isDatabaseConfigured
      ? 'Supabase tables (public.workspaces, etc.) not detected in schema cache. Apply the SQL migration.'
      : 'Supabase credentials not configured.',
    serverSendMode: config.sendMode,
    serverTestRecipients: config.testRecipients,
    workspace: null,
    currentUser: null,
    leads: INITIAL_LEADS,
    drafts: INITIAL_DRAFTS,
    approvals: INITIAL_APPROVALS,
    sendLogs: INITIAL_SEND_LOGS,
    suppressions: INITIAL_SUPPRESSIONS,
    auditLogs: INITIAL_AUDIT_LOGS,
    followUpSuggestions: [],
    metrics: {
      dailySendCount: 0,
      hourlySendCount: 0,
      dailyLimit: config.dailySendLimitWorkspace,
      hourlyLimit: config.hourlySendLimitWorkspace,
    },
    funnelMetrics: {
      discovered: INITIAL_LEADS.filter((l) => l.lifecycle_stage === 'discovered').length,
      qualified: INITIAL_LEADS.filter((l) => l.lifecycle_stage === 'qualified').length,
      drafts: INITIAL_DRAFTS.filter((d) => d.status === 'draft').length,
      pendingApproval: INITIAL_DRAFTS.filter((d) => d.status === 'pending_review').length,
      approved: INITIAL_DRAFTS.filter((d) => d.status === 'approved').length,
      sent: INITIAL_SEND_LOGS.filter((s) => s.status === 'sent' || s.status === 'delivered').length,
      replied: INITIAL_LEADS.filter((l) => l.status === 'replied' || l.lifecycle_stage === 'replied').length,
      meetings: INITIAL_LEADS.filter((l) => l.lifecycle_stage === 'meeting').length,
      clientsWon: INITIAL_LEADS.filter((l) => l.lifecycle_stage === 'won').length,
    },
    isUsingMockData: true,
  };

  if (!isDatabaseConfigured) {
    return fallbackPayload;
  }

  try {
    const supabase = createServiceRoleClient();

    // Probe workspaces table to verify schema migration
    const { data: workspaces, error: wsError } = await supabase
      .from('workspaces')
      .select('*')
      .limit(1);

    if (wsError) {
      return {
        ...fallbackPayload,
        areTablesMigrated: false,
        migrationError: `Migration needed: Table 'public.workspaces' not found (${wsError.message}). Run the SQL migration in Supabase SQL editor.`,
      };
    }

    // Fetch real data from all application tables
    const [leadsRes, draftsRes, apprRes, sendsRes, suppRes, auditRes] =
      await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('email_drafts').select('*').order('created_at', { ascending: false }),
        supabase.from('draft_approvals').select('*').order('created_at', { ascending: false }),
        supabase.from('send_logs').select('*').order('sent_at', { ascending: false }),
        supabase.from('suppressions').select('*').order('created_at', { ascending: false }),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50),
      ]);

    const realLeads = (leadsRes.data as Lead[]) || [];
    const realDrafts = (draftsRes.data as EmailDraft[]) || [];
    const realApprovals = (apprRes.data as DraftApproval[]) || [];
    const realSendLogs = (sendsRes.data as SendLog[]) || [];
    const realSuppressions = (suppRes.data as Suppression[]) || [];
    const realAuditLogs = (auditRes.data as AuditLog[]) || [];

    // Query follow-up suggestions if table exists
    let realFollowUps: FollowUpSuggestion[] = [];
    try {
      const { data: fuData } = await supabase
        .from('follow_up_suggestions')
        .select('*')
        .order('created_at', { ascending: false });
      if (fuData) {
        realFollowUps = fuData as FollowUpSuggestion[];
      }
    } catch {
      // Table migration pending
    }

    // Parse discovery metadata for leads
    const parsedLeads: Lead[] = realLeads.map((l) => {
      let meta: Record<string, unknown> = {};
      if (l.notes && l.notes.startsWith('{') && l.notes.endsWith('}')) {
        try {
          meta = JSON.parse(l.notes);
        } catch {
          // Pass
        }
      }
      return {
        ...l,
        country: l.country || (meta.country as Lead['country']) || null,
        target_service: l.target_service || (meta.target_service as Lead['target_service']) || null,
        source_url: l.source_url || (meta.source_url as string) || null,
        researched_at: l.researched_at || (meta.researched_at as string) || null,
        business_observations: l.business_observations || (meta.business_observations as string[]) || null,
        confidence_level: l.confidence_level || (meta.confidence_level as Lead['confidence_level']) || null,
        permission_type: l.permission_type || (meta.permission_type as Lead['permission_type']) || (l.consent_status === 'opted_in' ? 'verified_opt_in' : 'unknown'),
        lifecycle_stage: l.lifecycle_stage || (meta.lifecycle_stage as Lead['lifecycle_stage']) || (l.status === 'contacted' ? 'sent' : l.status === 'replied' ? 'replied' : l.consent_status === 'opted_in' ? 'qualified' : 'discovered'),
      };
    });

    const funnelMetrics: FunnelMetrics = {
      discovered: parsedLeads.filter((l) => l.lifecycle_stage === 'discovered' || (!l.lifecycle_stage && l.source === 'ai_discovery_engine')).length,
      qualified: parsedLeads.filter((l) => l.lifecycle_stage === 'qualified' || (l.consent_status === 'opted_in' && l.status === 'new')).length,
      drafts: realDrafts.filter((d) => d.status === 'draft').length,
      pendingApproval: realDrafts.filter((d) => d.status === 'pending_review').length,
      approved: realDrafts.filter((d) => d.status === 'approved').length,
      sent: realSendLogs.filter((s) => s.status === 'sent' || s.status === 'delivered').length,
      replied: parsedLeads.filter((l) => l.status === 'replied' || l.lifecycle_stage === 'replied').length,
      meetings: parsedLeads.filter((l) => l.lifecycle_stage === 'meeting').length,
      clientsWon: parsedLeads.filter((l) => l.lifecycle_stage === 'won').length,
    };

    // Calculate real rate limit counts from durable send_logs
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

    const dailySendCount = realSendLogs.filter((s) => s.sent_at >= oneDayAgo).length;
    const hourlySendCount = realSendLogs.filter((s) => s.sent_at >= oneHourAgo).length;

    const currentWorkspace: Workspace =
      workspaces && workspaces.length > 0
        ? workspaces[0]
        : {
            id: 'ws-default',
            name: 'ELVAVEO Primary Workspace',
            slug: 'elvaveo-primary',
            daily_send_limit: config.dailySendLimitWorkspace,
            hourly_send_limit: config.hourlySendLimitWorkspace,
            recipient_cool_down_days: config.minIntervalDaysRecipient,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

    let currentUser: CurrentUser | null = null;
    try {
      const serverSupabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await serverSupabase.auth.getUser();

      if (user) {
        const { data: member } = await supabase
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', currentWorkspace.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (member && member.role) {
          currentUser = {
            id: user.id,
            email: user.email || '',
            role: member.role as WorkspaceRole,
          };
        }
      }
    } catch {
      // Session lookup note
    }

    return {
      isDatabaseConfigured: true,
      areTablesMigrated: true,
      migrationError: null,
      serverSendMode: config.sendMode,
      serverTestRecipients: config.testRecipients,
      workspace: currentWorkspace,
      currentUser,
      leads: parsedLeads,
      drafts: realDrafts,
      approvals: realApprovals,
      sendLogs: realSendLogs,
      suppressions: realSuppressions,
      auditLogs: realAuditLogs,
      followUpSuggestions: realFollowUps,
      metrics: {
        dailySendCount,
        hourlySendCount,
        dailyLimit: currentWorkspace.daily_send_limit,
        hourlyLimit: currentWorkspace.hourly_send_limit,
      },
      funnelMetrics,
      isUsingMockData: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...fallbackPayload,
      migrationError: `Database query error: ${message}`,
    };
  }
}

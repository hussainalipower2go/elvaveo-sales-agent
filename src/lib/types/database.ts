// ==============================================================================
// ELVAVEO Sales Agent - Database & Domain TypeScript Definitions
// ==============================================================================

export type WorkspaceRole = 'owner' | 'admin' | 'reviewer' | 'operator';

export type LeadConsentStatus = 'unknown' | 'opted_in' | 'opted_out';

export type LeadStatus = 'new' | 'contacted' | 'replied' | 'unresponsive' | 'do_not_contact';

export type SuppressionReason = 'unsubscribe' | 'manual' | 'bounce' | 'complaint';

export type DraftStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown';

export type SendMode = 'test' | 'live';

export type SendLogStatus =
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'delivered'
  | 'bounced'
  | 'complained';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  daily_send_limit: number;
  hourly_send_limit: number;
  recipient_cool_down_days: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
  updated_at: string;
}

export type TargetCountry = 'USA' | 'UK' | 'UAE' | 'Canada';

export type TargetService =
  | 'website_development'
  | 'crm_development'
  | 'custom_saas';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type PermissionType = 'unknown' | 'verified_opt_in';

export type LifecycleStage =
  | 'discovered'
  | 'qualified'
  | 'drafted'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'replied'
  | 'meeting'
  | 'won'
  | 'lost'
  | 'suppressed';

export interface Lead {
  id: string;
  workspace_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  website: string | null;
  source: string | null;
  notes: string | null;
  consent_status: LeadConsentStatus;
  consent_source: string | null;
  consent_timestamp: string | null;
  status: LeadStatus;
  country?: TargetCountry | null;
  target_service?: TargetService | null;
  source_url?: string | null;
  researched_at?: string | null;
  business_observations?: string[] | null;
  confidence_level?: ConfidenceLevel | null;
  permission_type?: PermissionType;
  lifecycle_stage?: LifecycleStage;
  created_at: string;
  updated_at: string;
}

export interface FollowUpSuggestion {
  id: string;
  workspace_id: string;
  lead_id: string;
  parent_draft_id: string;
  step_number: number;
  suggested_send_date: string;
  subject: string;
  body_text: string;
  body_html: string;
  status: 'suggested' | 'pending_approval' | 'approved' | 'rejected' | 'sent' | 'cancelled';
  approval_id?: string | null;
  approved_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FunnelMetrics {
  discovered: number;
  qualified: number;
  drafts: number;
  pendingApproval: number;
  approved: number;
  sent: number;
  replied: number;
  meetings: number;
  clientsWon: number;
}

export interface Suppression {
  id: string;
  workspace_id: string;
  email: string;
  reason: SuppressionReason;
  source_details: string | null;
  created_at: string;
}

export interface EmailTemplate {
  id: string;
  workspace_id: string;
  name: string;
  subject_template: string;
  body_template: string;
  created_at: string;
  updated_at: string;
}

export interface EmailDraft {
  id: string;
  workspace_id: string;
  lead_id: string;
  template_id: string | null;
  version: number;
  recipient_email: string;
  sender_email: string;
  reply_to_email: string;
  subject: string;
  body_text: string;
  body_html: string;
  footer_text: string;
  footer_html: string;
  content_hash: string;
  status: DraftStatus;
  missing_fields: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftApproval {
  id: string;
  workspace_id: string;
  draft_id: string;
  draft_version: number;
  content_hash: string;
  approved_by: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  created_at: string;
}

export interface SendLog {
  id: string;
  workspace_id: string;
  draft_id: string | null;
  lead_id: string | null;
  recipient_email: string;
  send_mode: SendMode;
  is_test: boolean;
  idempotency_key: string;
  provider: string;
  resend_email_id: string | null;
  status: SendLogStatus;
  error_message: string | null;
  sent_by: string | null;
  sent_at: string;
  updated_at: string;
}

export interface WebhookEventRecord {
  id: string;
  provider_event_id: string;
  event_type: string;
  resend_email_id: string | null;
  recipient_email: string | null;
  payload: Record<string, unknown>;
  processed: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

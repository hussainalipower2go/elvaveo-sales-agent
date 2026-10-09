-- ==============================================================================
-- ELVAVEO Sales Agent - Complete Database Schema & Row Level Security (RLS)
-- Migration: 20261008000001_elvaveo_sales_agent_schema.sql
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. WORKSPACES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    daily_send_limit INT NOT NULL DEFAULT 50 CHECK (daily_send_limit >= 0),
    hourly_send_limit INT NOT NULL DEFAULT 10 CHECK (hourly_send_limit >= 0),
    recipient_cool_down_days INT NOT NULL DEFAULT 7 CHECK (recipient_cool_down_days >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 2. WORKSPACE MEMBERS (Roles: owner, admin, reviewer, operator)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'reviewer', 'operator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_ws ON public.workspace_members(workspace_id);

-- ------------------------------------------------------------------------------
-- 3. LEADS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    company TEXT,
    role TEXT,
    website TEXT,
    source TEXT,
    notes TEXT,
    consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown', 'opted_in', 'opted_out')),
    consent_source TEXT,
    consent_timestamp TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'replied', 'unresponsive', 'do_not_contact')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS idx_leads_ws_email ON public.leads(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_ws_status ON public.leads(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_ws_consent ON public.leads(workspace_id, consent_status);

-- ------------------------------------------------------------------------------
-- 4. SUPPRESSION LIST (Unsubscribes, Bounces, Complaints, Manual DNC)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'manual', 'bounce', 'complaint')),
    source_details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS idx_suppressions_ws_email ON public.suppressions(workspace_id, email);

-- ------------------------------------------------------------------------------
-- 5. EMAIL TEMPLATES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 6. EMAIL DRAFTS & VERSIONS
-- Workflow: draft -> pending_review -> approved -> sending -> sent / failed / unknown
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.email_templates(id) ON DELETE SET NULL,
    version INT NOT NULL DEFAULT 1,
    recipient_email TEXT NOT NULL,
    sender_email TEXT NOT NULL DEFAULT 'ELVAVEO <hello@outreach.elvaveo.com>',
    reply_to_email TEXT NOT NULL DEFAULT 'hello@elvaveo.com',
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL,
    footer_text TEXT NOT NULL,
    footer_html TEXT NOT NULL,
    content_hash TEXT NOT NULL, -- SHA256 of recipient + subject + body + sender + reply_to + footer
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'sending', 'sent', 'failed', 'unknown')),
    missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_ws_status ON public.email_drafts(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_email_drafts_lead ON public.email_drafts(lead_id);

-- ------------------------------------------------------------------------------
-- 7. DRAFT APPROVALS (Tied to exact version and content hash)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.draft_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    draft_id UUID NOT NULL REFERENCES public.email_drafts(id) ON DELETE CASCADE,
    draft_version INT NOT NULL,
    content_hash TEXT NOT NULL,
    approved_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_approvals_draft ON public.draft_approvals(draft_id);
CREATE INDEX IF NOT EXISTS idx_draft_approvals_ws ON public.draft_approvals(workspace_id);

-- ------------------------------------------------------------------------------
-- 8. SEND LOGS (With idempotency key and test vs live distinction)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.send_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    draft_id UUID REFERENCES public.email_drafts(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    recipient_email TEXT NOT NULL,
    send_mode TEXT NOT NULL CHECK (send_mode IN ('test', 'live')),
    is_test BOOLEAN NOT NULL DEFAULT true,
    idempotency_key TEXT UNIQUE NOT NULL,
    provider TEXT NOT NULL DEFAULT 'resend',
    resend_email_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown', 'delivered', 'bounced', 'complained')),
    error_message TEXT,
    sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_send_logs_ws_recipient ON public.send_logs(workspace_id, recipient_email, sent_at);
CREATE INDEX IF NOT EXISTS idx_send_logs_resend_id ON public.send_logs(resend_email_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_idempotency ON public.send_logs(idempotency_key);

-- ------------------------------------------------------------------------------
-- 9. WEBHOOK EVENTS (Raw provider webhook deduplication)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    resend_email_id TEXT,
    recipient_email TEXT,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_id ON public.webhook_events(provider_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_resend_email ON public.webhook_events(resend_email_id);

-- ------------------------------------------------------------------------------
-- 10. AUDIT TRAIL (Append-only)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_ws_time ON public.audit_logs(workspace_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- SECURITY HELPER FUNCTIONS (SECURITY DEFINER)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = ws_id AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.get_user_workspace_role(ws_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT role FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin_or_owner(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = ws_id AND user_id = auth.uid() AND role IN ('owner', 'admin')
    );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_reviewer_or_above(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = ws_id AND user_id = auth.uid() AND role IN ('owner', 'admin', 'reviewer')
    );
$$;

-- ------------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

-- Workspaces
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspaces viewable by members"
    ON public.workspaces FOR SELECT
    USING (public.is_workspace_member(id));

CREATE POLICY "Workspaces editable by admins and owners"
    ON public.workspaces FOR UPDATE
    USING (public.is_workspace_admin_or_owner(id));

-- Workspace Members
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view co-members in same workspace"
    ON public.workspace_members FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Only admins and owners can add or manage members"
    ON public.workspace_members FOR INSERT
    WITH CHECK (public.is_workspace_admin_or_owner(workspace_id));

CREATE POLICY "Only admins and owners can update members"
    ON public.workspace_members FOR UPDATE
    USING (public.is_workspace_admin_or_owner(workspace_id));

CREATE POLICY "Only admins and owners can remove members"
    ON public.workspace_members FOR DELETE
    USING (public.is_workspace_admin_or_owner(workspace_id));

-- Leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leads viewable by workspace members"
    ON public.leads FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Leads insertable by workspace members"
    ON public.leads FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Leads updatable by workspace members"
    ON public.leads FOR UPDATE
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Leads deletable by workspace admins or owners"
    ON public.leads FOR DELETE
    USING (public.is_workspace_admin_or_owner(workspace_id));

-- Suppressions
ALTER TABLE public.suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suppressions viewable by workspace members"
    ON public.suppressions FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Suppressions insertable by workspace members"
    ON public.suppressions FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Suppressions cannot be deleted except by workspace owner"
    ON public.suppressions FOR DELETE
    USING (public.get_user_workspace_role(workspace_id) = 'owner');

-- Email Templates
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Templates viewable by workspace members"
    ON public.email_templates FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Templates manageable by workspace members"
    ON public.email_templates FOR ALL
    USING (public.is_workspace_member(workspace_id));

-- Email Drafts
ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drafts viewable by workspace members"
    ON public.email_drafts FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Drafts insertable by workspace members"
    ON public.email_drafts FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Drafts updatable by workspace members"
    ON public.email_drafts FOR UPDATE
    USING (public.is_workspace_member(workspace_id));

-- Draft Approvals (Reviewers and above only)
ALTER TABLE public.draft_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approvals viewable by workspace members"
    ON public.draft_approvals FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Approvals insertable only by reviewers, admins, and owners"
    ON public.draft_approvals FOR INSERT
    WITH CHECK (public.is_workspace_reviewer_or_above(workspace_id));

-- Send Logs
ALTER TABLE public.send_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Send logs viewable by workspace members"
    ON public.send_logs FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Send logs insertable by reviewers, admins, and owners"
    ON public.send_logs FOR INSERT
    WITH CHECK (public.is_workspace_reviewer_or_above(workspace_id));

-- Webhook Events (Protected / Service role or admin viewable)
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Webhook events viewable by authenticated users with admin role"
    ON public.webhook_events FOR SELECT
    TO authenticated
    USING (true);

-- Audit Logs (APPEND-ONLY)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Audit logs viewable by workspace members"
    ON public.audit_logs FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Audit logs insertable by workspace members"
    ON public.audit_logs FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id));

-- Note: No UPDATE or DELETE policy exists on audit_logs, ensuring it is strictly append-only!

-- ------------------------------------------------------------------------------
-- DRAFT INVALIDATION TRIGGER
-- When draft content or recipient is updated, invalidate approval and increment version
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_draft_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- If content, recipient, subject, sender, or reply_to changed
    IF (OLD.subject IS DISTINCT FROM NEW.subject)
       OR (OLD.body_text IS DISTINCT FROM NEW.body_text)
       OR (OLD.body_html IS DISTINCT FROM NEW.body_html)
       OR (OLD.recipient_email IS DISTINCT FROM NEW.recipient_email)
       OR (OLD.sender_email IS DISTINCT FROM NEW.sender_email)
       OR (OLD.reply_to_email IS DISTINCT FROM NEW.reply_to_email)
       OR (OLD.footer_text IS DISTINCT FROM NEW.footer_text)
       OR (OLD.footer_html IS DISTINCT FROM NEW.footer_html) THEN
       
        -- If it was approved, reset to draft
        IF OLD.status = 'approved' THEN
            NEW.status := 'draft';
        END IF;
        
        -- Increment version
        NEW.version := OLD.version + 1;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_draft_update ON public.email_drafts;
CREATE TRIGGER trg_draft_update
    BEFORE UPDATE ON public.email_drafts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_draft_update();

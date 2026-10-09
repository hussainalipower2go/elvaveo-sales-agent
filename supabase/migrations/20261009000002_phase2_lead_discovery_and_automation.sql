-- ==============================================================================
-- ELVAVEO Sales Agent - Phase 2 Migration: Lead Discovery & Outreach Automation
-- ==============================================================================

-- 1. Extend Leads Table with Discovery, Verification, & Lifecycle Tracking
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS country TEXT CHECK (country IN ('USA', 'UK', 'UAE', 'Canada'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS target_service TEXT CHECK (target_service IN ('website_development', 'crm_development', 'custom_saas'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS researched_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS business_observations JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS confidence_level TEXT CHECK (confidence_level IN ('high', 'medium', 'low'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS permission_type TEXT DEFAULT 'unknown' CHECK (permission_type IN ('unknown', 'verified_opt_in'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT DEFAULT 'discovered' CHECK (lifecycle_stage IN ('discovered', 'qualified', 'drafted', 'pending_approval', 'approved', 'sent', 'replied', 'meeting', 'won', 'lost', 'suppressed'));

CREATE INDEX IF NOT EXISTS idx_leads_ws_country_service ON public.leads(workspace_id, country, target_service);
CREATE INDEX IF NOT EXISTS idx_leads_lifecycle ON public.leads(workspace_id, lifecycle_stage);

-- 2. Follow-Up Suggestions Table (Requires Explicit Human Review & Approval)
CREATE TABLE IF NOT EXISTS public.follow_up_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    parent_draft_id UUID REFERENCES public.email_drafts(id) ON DELETE CASCADE,
    step_number INT NOT NULL DEFAULT 2,
    suggested_send_date TIMESTAMPTZ NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'pending_approval', 'approved', 'rejected', 'sent', 'cancelled')),
    approval_id UUID REFERENCES public.draft_approvals(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_ws_status ON public.follow_up_suggestions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead ON public.follow_up_suggestions(lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_draft ON public.follow_up_suggestions(parent_draft_id);

-- 3. Row Level Security on Follow-Up Suggestions
ALTER TABLE public.follow_up_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Follow ups viewable by workspace members"
    ON public.follow_up_suggestions FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Follow ups insertable by workspace members"
    ON public.follow_up_suggestions FOR INSERT
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Follow ups approvable by reviewers, admins, and owners"
    ON public.follow_up_suggestions FOR UPDATE
    USING (public.is_workspace_reviewer_or_above(workspace_id));

CREATE POLICY "Follow ups deletable by admins and owners"
    ON public.follow_up_suggestions FOR DELETE
    USING (public.is_workspace_admin_or_owner(workspace_id));

-- ==============================================================================
-- ELVAVEO Sales Agent - Phase 3 Migration: Real Client Discovery & Qualification Scoring
-- ==============================================================================

-- 1. Extend Leads Table with Qualification Scores & Public Contact Channels
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qualification_score INT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qualification_explanation TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qualification_reasons JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS public_contact_channel TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_qualification_score ON public.leads(workspace_id, qualification_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_public_channel ON public.leads(workspace_id, public_contact_channel);

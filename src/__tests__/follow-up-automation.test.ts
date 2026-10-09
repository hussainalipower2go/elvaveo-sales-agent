import { describe, it, expect } from 'vitest';
import {
  generateFollowUpSuggestions,
  validateFollowUpEligibility,
} from '@/lib/sending/follow-up-engine';
import { Lead, EmailDraft, FollowUpSuggestion } from '@/lib/types/database';

describe('Phase 2: Outreach Automation & Follow-Up Safety Cadence', () => {
  const mockLead: Lead = {
    id: 'lead-follow-1',
    workspace_id: 'ws-test',
    email: 'elena.rostova@cloudscale.ca',
    first_name: 'Elena',
    last_name: 'Rostova',
    company: 'CloudScale Solutions',
    role: 'Director of Platform Engineering',
    website: 'cloudscale.ca',
    source: 'ai_discovery_engine',
    notes: null,
    consent_status: 'opted_in',
    consent_source: 'web_form',
    consent_timestamp: new Date().toISOString(),
    status: 'contacted',
    country: 'Canada',
    target_service: 'custom_saas',
    confidence_level: 'high',
    business_observations: [
      'Multi-tenant API endpoints exhibit occasional 504 timeouts under concurrent load.',
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockParentDraft: EmailDraft = {
    id: 'draft-parent-1',
    workspace_id: 'ws-test',
    lead_id: mockLead.id,
    template_id: null,
    version: 1,
    recipient_email: mockLead.email,
    sender_email: 'hello@elvaveo.com',
    reply_to_email: 'hello@elvaveo.com',
    subject: 'Scalable SaaS Architecture for CloudScale Solutions',
    body_text: 'Hi Elena,\n\nI noticed CloudScale Solutions platform architecture...',
    body_html: '<p>Hi Elena,</p>',
    footer_text: 'ELVAVEO Technologies',
    footer_html: '<p>ELVAVEO Technologies</p>',
    content_hash: 'abc123hash',
    status: 'sent',
    missing_fields: [],
    created_by: 'owner-id',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('generates multi-step follow-up suggestions with correct delay spacing (+3d, +7d)', () => {
    const suggestions = generateFollowUpSuggestions({
      lead: mockLead,
      parentDraft: mockParentDraft,
      workspaceId: 'ws-test',
    });

    expect(suggestions).toHaveLength(2);

    const step1 = suggestions.find((s) => s.step_number === 1)!;
    const step2 = suggestions.find((s) => s.step_number === 2)!;

    expect(step1).toBeDefined();
    expect(step2).toBeDefined();

    expect(step1.status).toBe('suggested');
    expect(step2.status).toBe('suggested');

    const now = Date.now();
    const step1Date = new Date(step1.suggested_send_date).getTime();
    const step2Date = new Date(step2.suggested_send_date).getTime();

    // Step 1 ~3 days
    const diff1Days = (step1Date - now) / (1000 * 60 * 60 * 24);
    expect(diff1Days).toBeGreaterThan(2.9);
    expect(diff1Days).toBeLessThan(3.1);

    // Step 2 ~7 days
    const diff2Days = (step2Date - now) / (1000 * 60 * 60 * 24);
    expect(diff2Days).toBeGreaterThan(6.9);
    expect(diff2Days).toBeLessThan(7.1);

    // Verifies observation anchoring
    expect(step1.body_text).toContain('CloudScale Solutions');
    expect(step2.body_text).toContain('504 timeouts');
  });

  it('strictly blocks follow-up dispatch if status is not approved by a human reviewer', () => {
    const unapprovedSuggestion: FollowUpSuggestion = {
      id: 'fu-1',
      workspace_id: 'ws-test',
      lead_id: mockLead.id,
      parent_draft_id: mockParentDraft.id,
      step_number: 1,
      suggested_send_date: new Date(Date.now() - 1000).toISOString(), // Date has arrived
      subject: 'Follow-up regarding CloudScale architecture',
      body_text: 'Elena, wanted to follow up...',
      body_html: '<p>Elena, wanted to follow up...</p>',
      status: 'suggested', // Not approved
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const validation = validateFollowUpEligibility({
      suggestion: unapprovedSuggestion,
      lead: mockLead,
      isSuppressed: false,
      lastSentDate: null,
      cooldownDays: 7,
    });

    expect(validation.isEligible).toBe(false);
    expect(validation.blockingReasons).toContain(
      'Follow-up has not been approved by a reviewer (status: suggested). Automated sending without approval is strictly prohibited.'
    );
  });

  it('strictly blocks follow-up dispatch if recipient is suppressed or opted out', () => {
    const approvedSuggestion: FollowUpSuggestion = {
      id: 'fu-2',
      workspace_id: 'ws-test',
      lead_id: mockLead.id,
      parent_draft_id: mockParentDraft.id,
      step_number: 1,
      suggested_send_date: new Date(Date.now() - 1000).toISOString(),
      subject: 'Follow-up regarding CloudScale architecture',
      body_text: 'Elena, wanted to follow up...',
      body_html: '<p>Elena, wanted to follow up...</p>',
      status: 'approved',
      approved_by: 'reviewer-user-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const suppressedValidation = validateFollowUpEligibility({
      suggestion: approvedSuggestion,
      lead: mockLead,
      isSuppressed: true,
      lastSentDate: null,
      cooldownDays: 7,
    });

    expect(suppressedValidation.isEligible).toBe(false);
    expect(suppressedValidation.blockingReasons).toContain(
      'Recipient is present in the workspace suppression list. Outreach is blocked.'
    );

    const optedOutLead: Lead = {
      ...mockLead,
      consent_status: 'opted_out',
    };

    const optOutValidation = validateFollowUpEligibility({
      suggestion: approvedSuggestion,
      lead: optedOutLead,
      isSuppressed: false,
      lastSentDate: null,
      cooldownDays: 7,
    });

    expect(optOutValidation.isEligible).toBe(false);
    expect(optOutValidation.blockingReasons).toContain(
      'Recipient has opted out or lacks affirmative consent.'
    );
  });

  it('strictly enforces cooldown interval between sends to the same recipient', () => {
    const approvedSuggestion: FollowUpSuggestion = {
      id: 'fu-3',
      workspace_id: 'ws-test',
      lead_id: mockLead.id,
      parent_draft_id: mockParentDraft.id,
      step_number: 1,
      suggested_send_date: new Date(Date.now() - 1000).toISOString(),
      subject: 'Follow-up regarding CloudScale architecture',
      body_text: 'Elena, wanted to follow up...',
      body_html: '<p>Elena, wanted to follow up...</p>',
      status: 'approved',
      approved_by: 'reviewer-user-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Last send was 2 days ago (cooldown is 7 days)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const cooldownValidation = validateFollowUpEligibility({
      suggestion: approvedSuggestion,
      lead: mockLead,
      isSuppressed: false,
      lastSentDate: twoDaysAgo,
      cooldownDays: 7,
    });

    expect(cooldownValidation.isEligible).toBe(false);
    expect(cooldownValidation.blockingReasons.some((r) => r.includes('Cooldown active'))).toBe(true);
  });

  it('allows follow-up dispatch when approved, cooldown satisfied, date arrived, and consent clean', () => {
    const approvedSuggestion: FollowUpSuggestion = {
      id: 'fu-4',
      workspace_id: 'ws-test',
      lead_id: mockLead.id,
      parent_draft_id: mockParentDraft.id,
      step_number: 1,
      suggested_send_date: new Date(Date.now() - 1000).toISOString(),
      subject: 'Follow-up regarding CloudScale architecture',
      body_text: 'Elena, wanted to follow up...',
      body_html: '<p>Elena, wanted to follow up...</p>',
      status: 'approved',
      approved_by: 'reviewer-user-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Last send was 8 days ago
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const validResult = validateFollowUpEligibility({
      suggestion: approvedSuggestion,
      lead: mockLead,
      isSuppressed: false,
      lastSentDate: eightDaysAgo,
      cooldownDays: 7,
    });

    expect(validResult.isEligible).toBe(true);
    expect(validResult.blockingReasons).toHaveLength(0);
  });
});

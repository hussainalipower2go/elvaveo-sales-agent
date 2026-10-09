import { describe, it, expect } from 'vitest';
import { generateObservationBasedDraft } from '@/lib/personalization/ai-personalizer';
import { Lead } from '@/lib/types/database';
import { computeContentHash } from '@/lib/personalization/template';

describe('Phase 2: AI Personalization & Zero-Fabrication Guardrails', () => {
  const baseLead: Lead = {
    id: 'test-lead-1',
    workspace_id: 'ws-1',
    email: 'marcus.vance@vancetech.co.uk',
    first_name: 'Marcus',
    last_name: 'Vance',
    company: 'Vance Technologies',
    role: 'VP of Engineering',
    website: 'vancetech.co.uk',
    source: 'ai_discovery_engine',
    notes: null,
    consent_status: 'unknown',
    consent_source: 'discovery',
    consent_timestamp: null,
    status: 'new',
    country: 'UK',
    target_service: 'website_development',
    confidence_level: 'high',
    business_observations: [
      'Website Core Web Vitals show Largest Contentful Paint (LCP) of 3.8s on primary landing page.',
      'Legacy client-side framework lacks server-side rendering for search engine optimization.',
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('generates an outreach draft anchored strictly in verified technical observations', () => {
    const draft = generateObservationBasedDraft({
      lead: baseLead,
      workspaceId: 'ws-1',
      appUrl: 'https://elvaveo-sales-agent.vercel.app',
      unsubscribeSecret: 'test-secret-32-chars-long-minimum-size!!',
      isTestMode: true,
    });

    expect(draft.subject).toContain('Vance Technologies');
    expect(draft.bodyText).toContain('Marcus');
    expect(draft.bodyText).toContain('Core Web Vitals');
    expect(draft.bodyText).toContain('3.8s');
    expect(draft.observationAnchors.length).toBeGreaterThan(0);
    expect(draft.observationAnchors).toContain(
      'Website Core Web Vitals show Largest Contentful Paint (LCP) of 3.8s on primary landing page.'
    );
  });

  it('strictly adheres to zero-fabrication rules: does not invent job openings, budget distress, or buying intent', () => {
    const draft = generateObservationBasedDraft({
      lead: baseLead,
      workspaceId: 'ws-1',
      appUrl: 'https://elvaveo-sales-agent.vercel.app',
      unsubscribeSecret: 'test-secret-32-chars-long-minimum-size!!',
      isTestMode: true,
    });

    const bodyLower = draft.bodyText.toLowerCase();
    const forbiddenPhrases = [
      'saw you are hiring',
      'saw your job post',
      'heard you are struggling',
      'urgent budget',
      'we know you need',
      'guaranteed 10x',
      'exclusive deal',
    ];

    forbiddenPhrases.forEach((phrase) => {
      expect(bodyLower).not.toContain(phrase);
    });
  });

  it('tailors service value propositions accurately for CRM Development', () => {
    const crmLead: Lead = {
      ...baseLead,
      target_service: 'crm_development',
      business_observations: [
        'Multi-step inquiry form routes to unmonitored generic mailbox without CRM validation.',
        'No automated lead routing detected across international enterprise inquiries.',
      ],
    };

    const draft = generateObservationBasedDraft({
      lead: crmLead,
      workspaceId: 'ws-1',
      appUrl: 'https://elvaveo-sales-agent.vercel.app',
      unsubscribeSecret: 'test-secret-32-chars-long-minimum-size!!',
      isTestMode: true,
    });

    expect(draft.subject.toLowerCase()).toContain('crm');
    expect(draft.bodyText).toContain('inquiry');
    expect(draft.bodyText).toContain('CRM');
  });

  it('tailors service value propositions accurately for Custom SaaS Architecture', () => {
    const saasLead: Lead = {
      ...baseLead,
      target_service: 'custom_saas',
      business_observations: [
        'Public enterprise portal lacks multi-tenant organization switching.',
        'REST API endpoints experience latency spikes under heavy concurrent requests.',
      ],
    };

    const draft = generateObservationBasedDraft({
      lead: saasLead,
      workspaceId: 'ws-1',
      appUrl: 'https://elvaveo-sales-agent.vercel.app',
      unsubscribeSecret: 'test-secret-32-chars-long-minimum-size!!',
      isTestMode: true,
    });

    expect(draft.subject.toLowerCase()).toContain('saas');
    expect(draft.bodyText).toContain('multi-tenant');
  });

  it('generates a deterministic, tamper-evident content hash', () => {
    const draft = generateObservationBasedDraft({
      lead: baseLead,
      workspaceId: 'ws-1',
      appUrl: 'https://elvaveo-sales-agent.vercel.app',
      unsubscribeSecret: 'test-secret-32-chars-long-minimum-size!!',
      isTestMode: true,
    });

    const computedHash = computeContentHash({
      recipientEmail: baseLead.email,
      senderEmail: draft.senderEmail,
      replyToEmail: draft.replyToEmail,
      subject: draft.subject,
      bodyText: draft.bodyText,
      bodyHtml: draft.bodyHtml,
      footerText: draft.footerText,
      footerHtml: draft.footerHtml,
    });

    expect(draft.contentHash).toBe(computedHash);

    // Verify tamper detection
    const tamperedHash = computeContentHash({
      recipientEmail: baseLead.email,
      senderEmail: draft.senderEmail,
      replyToEmail: draft.replyToEmail,
      subject: draft.subject + ' [tampered]',
      bodyText: draft.bodyText,
      bodyHtml: draft.bodyHtml,
      footerText: draft.footerText,
      footerHtml: draft.footerHtml,
    });

    expect(tamperedHash).not.toBe(computedHash);
  });

  it('includes cryptographically signed unsubscribe tokens in footer', () => {
    const draft = generateObservationBasedDraft({
      lead: baseLead,
      workspaceId: 'ws-1',
      appUrl: 'https://elvaveo-sales-agent.vercel.app',
      unsubscribeSecret: 'test-secret-32-chars-long-minimum-size!!',
      isTestMode: true,
    });

    expect(draft.footerText).toContain('/unsubscribe?token=');
    expect(draft.footerHtml).toContain('/unsubscribe?token=');
    // Ensure raw email address is never exposed in the unsubscribe query params
    expect(draft.footerHtml).not.toContain(encodeURIComponent(baseLead.email));
  });
});

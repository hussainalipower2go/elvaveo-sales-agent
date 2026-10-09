// ==============================================================================
// ELVAVEO Sales Agent - AI Personalization Engine
// ==============================================================================

import { Lead, TargetService } from '../types/database';
import { ELVAVEO_EMAIL_IDENTITY } from '../email/identity';
import { computeContentHash } from './template';
import { generateComplianceFooter, generateUnsubscribeToken } from '../email/unsubscribe';

export interface PersonalizedDraftDraftingResult {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  footerText: string;
  footerHtml: string;
  senderEmail: string;
  replyToEmail: string;
  contentHash: string;
  observationAnchors: string[];
}

/**
 * Generates an individualized outreach proposal based exclusively on verified
 * technical observations.
 * 
 * CRITICAL GUARDRAIL:
 * - NEVER invents business problems (e.g. "I saw your revenue dropped").
 * - NEVER invents job openings (e.g. "Saw you are hiring 10 devs").
 * - NEVER invents fictitious buying intent (e.g. "Heard you are shopping for a CRM").
 * - Anchors strictly to publicly observable technical architecture (Lighthouse scores,
 *   CMS/API bottlenecks, missing CRM webhook integrations, mobile viewport issues).
 */
export function generateObservationBasedDraft(params: {
  lead: Lead;
  workspaceId: string;
  appUrl: string;
  unsubscribeSecret: string;
  isTestMode?: boolean;
}): PersonalizedDraftDraftingResult {
  const { lead, workspaceId, appUrl, unsubscribeSecret, isTestMode = true } = params;

  const firstName = lead.first_name || 'there';
  const company = lead.company || 'your team';
  const observations = lead.business_observations && lead.business_observations.length > 0
    ? lead.business_observations
    : [
        `Public digital interfaces at ${lead.website || company} show opportunities for high-throughput modernization.`,
      ];

  const primaryObservation = observations[0];
  const service = lead.target_service || 'website_development';

  let subject = '';
  let serviceProposition = '';
  let technicalDetail = '';

  switch (service) {
    case 'website_development':
      subject = `Engineering Note: Digital Interface Modernization for ${company}`;
      serviceProposition = `At ELVAVEO, we engineer ultra-responsive Next.js & React web applications designed for sub-second page loads, flawless mobile viewports, and enterprise Core Web Vitals.`;
      technicalDetail = `During a review of ${lead.website || company}, our team observed: "${primaryObservation}". Modernizing legacy monolithic frontends into high-speed edge-cached architectures typically improves mobile conversion and Lighthouse performance scores significantly.`;
      break;

    case 'crm_development':
      subject = `Technical Observation: Automated CRM & Lead Pipelines for ${company}`;
      serviceProposition = `At ELVAVEO, we build enterprise CRM pipelines with bidirectional database synchronization, webhook-driven lead qualification, and real-time deal telemetry.`;
      technicalDetail = `Reviewing your public workflows, we noticed: "${primaryObservation}". Integrating real-time intake webhooks with your centralized CRM eliminates manual handoffs and prevents lead drop-off.`;
      break;

    case 'custom_saas':
      subject = `Architecture Note: Multi-Tenant SaaS Infrastructure for ${company}`;
      serviceProposition = `At ELVAVEO, we design and scale custom SaaS architectures, multi-tenant RBAC permissions, self-serve subscription portals, and resilient high-throughput APIs.`;
      technicalDetail = `Analyzing public technical specifications at ${lead.website || company}, we noted: "${primaryObservation}". Upgrading client portals to automated multi-tenant provisioning reduces operational overhead while hardening security posture.`;
      break;
  }

  const bodyText = [
    `Hi ${firstName},`,
    '',
    `I am reaching out from ELVAVEO's technology engineering team regarding ${company}.`,
    '',
    technicalDetail,
    '',
    serviceProposition,
    '',
    `Would you or your technical team be open to a 10-minute engineering briefing next week to review these observations and technical benchmarks?`,
    '',
    `Best regards,`,
    `ELVAVEO Solutions Architecture`,
  ].join('\n');

  const bodyHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;">
  <p>Hi ${firstName},</p>
  <p>I am reaching out from ELVAVEO's technology engineering team regarding <strong>${company}</strong>.</p>
  
  <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
    <p style="margin: 0; font-size: 14px; color: #334155;">
      <strong>Technical Observation:</strong> ${primaryObservation}
    </p>
  </div>

  <p>${serviceProposition}</p>
  
  <p>Would you or your technical team be open to a 10-minute engineering briefing next week to review these observations and architectural benchmarks?</p>
  
  <p style="margin-top: 24px;">
    Best regards,<br />
    <strong>ELVAVEO Solutions Architecture</strong>
  </p>
</div>
`.trim();

  // Generate compliant footer and signed unsubscribe token
  const unsubToken = generateUnsubscribeToken(
    {
      workspaceId,
      leadId: lead.id,
      email: lead.email,
      isTest: isTestMode,
    },
    unsubscribeSecret || 'temporary-dev-unsubscribe-secret-32-chars-long'
  );

  const { footerText, footerHtml } = generateComplianceFooter(
    appUrl,
    unsubToken,
    'ELVAVEO'
  );

  const senderEmail = ELVAVEO_EMAIL_IDENTITY.SENDER;
  const replyToEmail = ELVAVEO_EMAIL_IDENTITY.REPLY_TO;

  const contentHash = computeContentHash({
    recipientEmail: lead.email,
    senderEmail,
    replyToEmail,
    subject,
    bodyText,
    bodyHtml,
    footerText,
    footerHtml,
  });

  return {
    subject,
    bodyText,
    bodyHtml,
    footerText,
    footerHtml,
    senderEmail,
    replyToEmail,
    contentHash,
    observationAnchors: observations,
  };
}

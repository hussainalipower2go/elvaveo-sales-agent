// ==============================================================================
// ELVAVEO Sales Agent - Template Personalization & Content Integrity
// ==============================================================================

import crypto from 'crypto';
import { Lead } from '../types/database';

export interface PersonalizationResult {
  renderedSubject: string;
  renderedBodyText: string;
  renderedBodyHtml: string;
  missingFields: string[];
  contentHash: string;
}

/**
 * Supported personalization variables.
 * Deterministic: Strictly derived from verified lead data. Never fabricated.
 */
export const SUPPORTED_VARIABLES = [
  'name',
  'first_name',
  'last_name',
  'company',
  'role',
  'website',
  'email',
] as const;

export type SupportedVariable = (typeof SUPPORTED_VARIABLES)[number];

/**
 * Computes an exact SHA-256 hash representing the complete outbound email package.
 * Ties approval directly to sender, reply-to, recipient, subject, body, and footer.
 */
export function computeContentHash(params: {
  recipientEmail: string;
  senderEmail: string;
  replyToEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  footerText: string;
  footerHtml: string;
}): string {
  const normalized = [
    (params.recipientEmail || '').trim().toLowerCase(),
    (params.senderEmail || '').trim(),
    (params.replyToEmail || '').trim().toLowerCase(),
    (params.subject || '').trim(),
    (params.bodyText || '').trim(),
    (params.bodyHtml || '').trim(),
    (params.footerText || '').trim(),
    (params.footerHtml || '').trim(),
  ].join('||');

  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

/**
 * Renders a template using verified lead fields.
 * Identifies missing fields without inventing or guessing false information.
 */
export function renderTemplate(params: {
  subjectTemplate: string;
  bodyTemplate: string;
  lead: Partial<Lead> & { email: string };
  senderEmail: string;
  replyToEmail: string;
  footerText: string;
  footerHtml: string;
}): PersonalizationResult {
  const { subjectTemplate, bodyTemplate, lead, senderEmail, replyToEmail, footerText, footerHtml } =
    params;

  const fullName =
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    lead.first_name ||
    '';

  const values: Record<SupportedVariable, string | null | undefined> = {
    name: fullName || null,
    first_name: lead.first_name || null,
    last_name: lead.last_name || null,
    company: lead.company || null,
    role: lead.role || null,
    website: lead.website || null,
    email: lead.email || null,
  };

  const missingFieldsSet = new Set<string>();

  // Helper to replace variables and track missing ones
  const replaceVars = (text: string): string => {
    return text.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, varName) => {
      const key = varName.toLowerCase() as SupportedVariable;
      if (key in values) {
        const val = values[key];
        if (val && val.trim().length > 0) {
          return val.trim();
        }
        missingFieldsSet.add(key);
        return `[MISSING: ${key}]`;
      }
      missingFieldsSet.add(varName);
      return `[UNKNOWN: ${varName}]`;
    });
  };

  const renderedSubject = replaceVars(subjectTemplate);
  const renderedBodyText = replaceVars(bodyTemplate);

  // Convert plain text newlines to basic HTML paragraphs
  const htmlBodyContent = renderedBodyText
    .split('\n\n')
    .map((paragraph) => `<p style="margin:0 0 16px 0;line-height:1.6;">${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const renderedBodyHtml = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111827;line-height:1.6;max-width:600px;">
  ${htmlBodyContent}
</div>`.trim();

  const missingFields = Array.from(missingFieldsSet);

  const contentHash = computeContentHash({
    recipientEmail: lead.email,
    senderEmail,
    replyToEmail,
    subject: renderedSubject,
    bodyText: renderedBodyText,
    bodyHtml: renderedBodyHtml,
    footerText,
    footerHtml,
  });

  return {
    renderedSubject,
    renderedBodyText,
    renderedBodyHtml,
    missingFields,
    contentHash,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==============================================================================
// ELVAVEO Sales Agent - Unsubscribe Tokens & Compliance Footers
// ==============================================================================

import crypto from 'crypto';

export interface UnsubscribePayload {
  workspaceId: string;
  leadId: string;
  email: string;
  isTest: boolean;
  createdAt: number;
}

/**
 * Creates a cryptographically signed, tamper-proof unsubscribe token.
 * Does NOT expose raw email in plain text.
 */
export function generateUnsubscribeToken(
  payload: Omit<UnsubscribePayload, 'createdAt'>,
  secret: string
): string {
  const fullPayload: UnsubscribePayload = {
    ...payload,
    createdAt: Date.now(),
  };

  const payloadString = JSON.stringify(fullPayload);
  const encodedPayload = Buffer.from(payloadString, 'utf-8').toString('base64url');

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(encodedPayload);
  const signature = hmac.digest('base64url');

  return `${encodedPayload}.${signature}`;
}

/**
 * Validates the cryptographic signature of an unsubscribe token.
 * Returns the decoded payload if valid, or null if invalid or tampered with.
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string
): UnsubscribePayload | null {
  try {
    if (!token || !token.includes('.')) {
      return null;
    }

    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
      return null;
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(encodedPayload);
    const expectedSignature = hmac.digest('base64url');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (sigBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }

    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const parsed = JSON.parse(payloadJson) as UnsubscribePayload;

    if (!parsed.workspaceId || !parsed.email) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Generates RFC 8058 compliant email headers for one-click unsubscribe.
 */
export function generateUnsubscribeHeaders(
  appUrl: string,
  token: string
): {
  'List-Unsubscribe': string;
  'List-Unsubscribe-Post': string;
} {
  const cleanAppUrl = appUrl.replace(/\/$/, '');
  const oneClickUrl = `${cleanAppUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  const mailtoAddress = `mailto:unsubscribe@outreach.elvaveo.com?subject=unsubscribe`;

  return {
    'List-Unsubscribe': `<${oneClickUrl}>, <${mailtoAddress}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Generates plain-text and HTML compliance footers with physical address and unsubscribe link.
 */
export function generateComplianceFooter(
  appUrl: string,
  token: string,
  businessAddress?: string,
  isTest: boolean = false,
  businessLegalName?: string
): {
  footerText: string;
  footerHtml: string;
} {
  const cleanAppUrl = appUrl.replace(/\/$/, '');
  const webUnsubscribeUrl = `${cleanAppUrl}/unsubscribe?token=${encodeURIComponent(token)}`;

  const testNotice = isTest
    ? '\n[TEST MODE: Test email — delivered to the configured test recipient. Real lead was not contacted.]'
    : '';

  const testNoticeHtml = isTest
    ? `<div style="font-size:11px;color:#d97706;margin-bottom:8px;font-weight:600;">[TEST MODE: Test email — delivered to the configured test recipient.]</div>`
    : '';

  const cleanName = (businessLegalName || 'ELVAVEO').trim();
  const cleanAddress = (businessAddress || '').trim();

  const footerText = [
    '---',
    cleanName,
    cleanAddress ? cleanAddress : null,
    `To unsubscribe and cease receiving outreach: ${webUnsubscribeUrl}`,
    testNotice,
  ]
    .filter(Boolean)
    .join('\n');

  const addressHtml = cleanAddress
    ? `<p style="margin:0 0 8px 0;">${escapeHtml(cleanAddress)}</p>`
    : '';

  const footerHtml = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:sans-serif;font-size:12px;color:#6b7280;line-height:1.5;">
  ${testNoticeHtml}
  <p style="margin:0 0 4px 0;font-weight:600;color:#374151;">${escapeHtml(cleanName)}</p>
  ${addressHtml}
  <p style="margin:0;">
    If you no longer wish to receive these communications, you can 
    <a href="${webUnsubscribeUrl}" style="color:#2563eb;text-decoration:underline;">unsubscribe here</a>.
  </p>
</div>`.trim();

  return {
    footerText,
    footerHtml,
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

// ==============================================================================
// ELVAVEO Sales Agent - Unsubscribe Compliance & Token Integrity Tests
// ==============================================================================

import { describe, it, expect } from 'vitest';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  generateUnsubscribeHeaders,
  generateComplianceFooter,
} from '@/lib/email/unsubscribe';

const secret = 'super-secret-unsubscribe-key-at-least-32-chars-long';

describe('Unsubscribe Cryptographic Tokens & Compliance', () => {
  it('generates and verifies valid HMAC-SHA256 signed tokens', () => {
    const payload = {
      workspaceId: 'ws-123',
      leadId: 'lead-456',
      email: 'alex@acmecorp.com',
      isTest: false,
    };

    const token = generateUnsubscribeToken(payload, secret);
    expect(token).toBeTruthy();
    expect(token).toContain('.');

    // Does NOT contain raw unencoded email in plaintext
    expect(token).not.toContain('alex@acmecorp.com');

    const decoded = verifyUnsubscribeToken(token, secret);
    expect(decoded).not.toBeNull();
    expect(decoded?.workspaceId).toBe('ws-123');
    expect(decoded?.leadId).toBe('lead-456');
    expect(decoded?.email).toBe('alex@acmecorp.com');
    expect(decoded?.isTest).toBe(false);
  });

  it('rejects tampered tokens or tokens signed with a different secret', () => {
    const token = generateUnsubscribeToken(
      {
        workspaceId: 'ws-123',
        leadId: 'lead-456',
        email: 'alex@acmecorp.com',
        isTest: false,
      },
      secret
    );

    // Tamper signature
    const [payload, signature] = token.split('.');
    const tamperedToken = `${payload}.${signature.slice(0, -3)}xyz`;
    expect(verifyUnsubscribeToken(tamperedToken, secret)).toBeNull();

    // Verifying with wrong secret
    const wrongSecret = 'another-completely-different-signing-key-value';
    expect(verifyUnsubscribeToken(token, wrongSecret)).toBeNull();
  });

  it('preserves test-mode flag so test unsubscribe does not suppress real leads', () => {
    const testToken = generateUnsubscribeToken(
      {
        workspaceId: 'ws-1',
        leadId: 'lead-real',
        email: 'real@company.com',
        isTest: true,
      },
      secret
    );

    const verified = verifyUnsubscribeToken(testToken, secret);
    expect(verified?.isTest).toBe(true);
  });

  it('generates standard RFC 8058 one-click headers and compliance footer with real details', () => {
    const token = 'sample_token_xyz';
    const appUrl = 'https://outreach.elvaveo.com';
    const address = '500 Enterprise Way, Suite 100, City, State 12345';

    const headers = generateUnsubscribeHeaders(appUrl, token);
    expect(headers['List-Unsubscribe']).toContain('https://outreach.elvaveo.com/api/unsubscribe?token=sample_token_xyz');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    // Live mode footer with address
    const footer = generateComplianceFooter(appUrl, token, address, false, 'ELVAVEO');
    expect(footer.footerText).toContain(address);
    expect(footer.footerText).toContain('https://outreach.elvaveo.com/unsubscribe?token=sample_token_xyz');
    expect(footer.footerHtml).toContain(address);
    expect(footer.footerHtml).not.toContain('simulated');
    expect(footer.footerText).not.toContain('simulated');

    // Test mode footer: contains exact test notice and no invented address when empty
    const testFooter = generateComplianceFooter(appUrl, token, '', true, 'ELVAVEO');
    expect(testFooter.footerText).toContain('Test email — delivered to the configured test recipient.');
    expect(testFooter.footerHtml).toContain('Test email — delivered to the configured test recipient.');
    expect(testFooter.footerText).not.toContain('simulated');
    expect(testFooter.footerHtml).not.toContain('simulated');
    expect(testFooter.footerText).not.toContain('Innovation Way');
    expect(testFooter.footerHtml).not.toContain('Innovation Way');
  });
});

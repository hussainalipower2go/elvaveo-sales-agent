// ==============================================================================
// ELVAVEO Sales Agent - Email Identity & Security Guardrails
// ==============================================================================

/**
 * Official ELVAVEO Sender & Reply-To Identities.
 * Strictly enforced: No Gmail, no personal mail, exclusively Resend through outreach.elvaveo.com.
 */
export const ELVAVEO_EMAIL_IDENTITY = {
  SENDER: 'ELVAVEO <hello@outreach.elvaveo.com>',
  REPLY_TO: 'hello@elvaveo.com',
  SENDER_EMAIL_ONLY: 'hello@outreach.elvaveo.com',
  DOMAIN: 'outreach.elvaveo.com',
} as const;

/**
 * Validates that any sender or reply-to address matches the official ELVAVEO policy.
 * Blocks any attempt to inject unauthorized domains, personal accounts, or Gmail.
 */
export function validateEmailIdentity(sender: string, replyTo: string): {
  valid: boolean;
  error?: string;
} {
  const normalizedSender = sender.toLowerCase();
  const normalizedReplyTo = replyTo.toLowerCase();

  // Strict prohibition: Never allow Gmail or Power2Go integration
  if (
    normalizedSender.includes('gmail.com') ||
    normalizedSender.includes('power2go') ||
    normalizedReplyTo.includes('gmail.com') ||
    normalizedReplyTo.includes('power2go')
  ) {
    return {
      valid: false,
      error: 'Prohibited identity: Gmail / Power2Go integration is strictly prohibited by security policy.',
    };
  }

  if (!normalizedSender.includes('outreach.elvaveo.com')) {
    return {
      valid: false,
      error: `Invalid sender identity "${sender}". Sender must be an authorized address at outreach.elvaveo.com.`,
    };
  }

  if (!normalizedReplyTo.includes('elvaveo.com')) {
    return {
      valid: false,
      error: `Invalid reply-to identity "${replyTo}". Reply-to must be an authorized address at elvaveo.com.`,
    };
  }

  return { valid: true };
}

// ==============================================================================
// ELVAVEO Sales Agent - Environment & Security Configuration
// ==============================================================================

import 'server-only';

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  resendApiKey: string;
  resendWebhookSecret: string;
  unsubscribeSecret: string;
  appUrl: string;
  sendMode: 'test' | 'live';
  testRecipients: string[];
  businessAddress: string;
  businessLegalName: string;
  dailySendLimitWorkspace: number;
  hourlySendLimitWorkspace: number;
  minIntervalDaysRecipient: number;
}

export interface ConfigStatusItem {
  key: string;
  label: string;
  configured: boolean;
  isSecret: boolean;
  requiredForTest: boolean;
  requiredForLive: boolean;
  description: string;
}

function parseTestRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes('@'));
}

export function getAppConfig(): AppConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const resendApiKey = process.env.RESEND_API_KEY || '';
  const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET || '';
  const unsubscribeSecret = process.env.UNSUBSCRIBE_SECRET || '';
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const sendModeRaw = (process.env.SEND_MODE || 'test').toLowerCase();
  const sendMode: 'test' | 'live' = sendModeRaw === 'live' ? 'live' : 'test';
  const testRecipients = parseTestRecipients(process.env.TEST_RECIPIENTS);
  const businessAddress = (
    process.env.BUSINESS_PHYSICAL_ADDRESS ||
    process.env.BUSINESS_ADDRESS ||
    ''
  ).trim();
  const businessLegalName = (
    process.env.BUSINESS_LEGAL_NAME ||
    process.env.COMPANY_NAME ||
    'ELVAVEO'
  ).trim();

  const dailySendLimitWorkspace = parseInt(
    process.env.DAILY_SEND_LIMIT_WORKSPACE || '50',
    10
  );
  const hourlySendLimitWorkspace = parseInt(
    process.env.HOURLY_SEND_LIMIT_WORKSPACE || '10',
    10
  );
  const minIntervalDaysRecipient = parseInt(
    process.env.MIN_INTERVAL_DAYS_RECIPIENT || '7',
    10
  );

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    resendApiKey,
    resendWebhookSecret,
    unsubscribeSecret,
    appUrl,
    sendMode,
    testRecipients,
    businessAddress,
    businessLegalName,
    dailySendLimitWorkspace: isNaN(dailySendLimitWorkspace) ? 50 : dailySendLimitWorkspace,
    hourlySendLimitWorkspace: isNaN(hourlySendLimitWorkspace) ? 10 : hourlySendLimitWorkspace,
    minIntervalDaysRecipient: isNaN(minIntervalDaysRecipient) ? 7 : minIntervalDaysRecipient,
  };
}

/**
 * Validates configuration and fails closed if essential requirements are missing.
 * For test sends: requires testRecipients and resendApiKey.
 * For live sends: requires live mode confirmation, business physical address, and unsubscribe secret.
 */
import { validatePhysicalPostalAddress } from './email/address-validator';

export function validateSendingConfig(isLive: boolean): {
  valid: boolean;
  errors: string[];
} {
  const config = getAppConfig();
  const errors: string[] = [];

  if (!config.supabaseUrl) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL is not configured.');
  }

  if (!config.resendApiKey) {
    errors.push('RESEND_API_KEY is missing. Email dispatch is disabled.');
  }

  if (!config.unsubscribeSecret || config.unsubscribeSecret.length < 16) {
    errors.push('UNSUBSCRIBE_SECRET is missing or too short (minimum 16 characters required).');
  }

  if (isLive) {
    if (config.sendMode !== 'live') {
      errors.push('SEND_MODE must be set to "live" to allow production outreach.');
    }
    const addressCheck = validatePhysicalPostalAddress(config.businessAddress);
    if (!addressCheck.valid) {
      errors.push(...addressCheck.errors.map((e) => `[Postal Compliance] ${e}`));
    }
  } else {
    if (config.testRecipients.length === 0) {
      errors.push(
        'TEST_RECIPIENTS is empty. Test mode requires at least one server-configured test email.'
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Safe status reporting for UI status page.
 * NEVER exposes secret values, only whether they are populated.
 */
export function getSafeConfigStatus(): {
  sendMode: 'test' | 'live';
  testRecipientsCount: number;
  appUrl: string;
  hasBusinessAddress: boolean;
  items: ConfigStatusItem[];
} {
  const config = getAppConfig();

  const items: ConfigStatusItem[] = [
    {
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      label: 'Supabase URL',
      configured: Boolean(config.supabaseUrl && config.supabaseUrl.startsWith('https://')),
      isSecret: false,
      requiredForTest: true,
      requiredForLive: true,
      description: 'Connected Supabase project endpoint.',
    },
    {
      key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      label: 'Supabase Anon Key',
      configured: Boolean(config.supabaseAnonKey && config.supabaseAnonKey.length > 20),
      isSecret: false,
      requiredForTest: true,
      requiredForLive: true,
      description: 'Client-side public publishable key for Supabase Auth.',
    },
    {
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      label: 'Supabase Service Role Key',
      configured: Boolean(
        config.supabaseServiceRoleKey && config.supabaseServiceRoleKey.length > 20
      ),
      isSecret: true,
      requiredForTest: true,
      requiredForLive: true,
      description: 'Server-side privileged secret for system tasks and webhooks.',
    },
    {
      key: 'RESEND_API_KEY',
      label: 'Resend API Key',
      configured: Boolean(config.resendApiKey && config.resendApiKey.startsWith('re_')),
      isSecret: true,
      requiredForTest: true,
      requiredForLive: true,
      description: 'Used exclusively to transmit outreach emails through Resend API.',
    },
    {
      key: 'RESEND_WEBHOOK_SECRET',
      label: 'Resend Webhook Secret',
      configured: Boolean(
        config.resendWebhookSecret && config.resendWebhookSecret.startsWith('whsec_')
      ),
      isSecret: true,
      requiredForTest: false,
      requiredForLive: true,
      description: 'Svix signature secret to verify delivery and bounce webhooks.',
    },
    {
      key: 'UNSUBSCRIBE_SECRET',
      label: 'Unsubscribe Secret',
      configured: Boolean(config.unsubscribeSecret && config.unsubscribeSecret.length >= 16),
      isSecret: true,
      requiredForTest: true,
      requiredForLive: true,
      description: 'Cryptographic secret for signing tamper-proof unsubscribe tokens.',
    },
    {
      key: 'SEND_MODE',
      label: 'Sending Mode',
      configured: true,
      isSecret: false,
      requiredForTest: true,
      requiredForLive: true,
      description: `Current mode: ${config.sendMode.toUpperCase()} (${
        config.sendMode === 'test'
          ? 'Safe test sends only to TEST_RECIPIENTS'
          : 'Live outreach allowed'
      })`,
    },
    {
      key: 'TEST_RECIPIENTS',
      label: 'Authorized Test Recipients',
      configured: config.testRecipients.length > 0,
      isSecret: false,
      requiredForTest: true,
      requiredForLive: false,
      description: `${config.testRecipients.length} authorized test address(es) configured.`,
    },
    {
      key: 'BUSINESS_ADDRESS',
      label: 'Business Physical Postal Address',
      configured: validatePhysicalPostalAddress(config.businessAddress).valid,
      isSecret: false,
      requiredForTest: false,
      requiredForLive: true,
      description: 'Physical postal address with street, city, state/province, postal code, and country for CAN-SPAM compliance.',
    },
  ];

  return {
    sendMode: config.sendMode,
    testRecipientsCount: config.testRecipients.length,
    appUrl: config.appUrl,
    hasBusinessAddress: validatePhysicalPostalAddress(config.businessAddress).valid,
    items,
  };
}

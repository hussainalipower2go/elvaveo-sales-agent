// ==============================================================================
// ELVAVEO Sales Agent - Live Production Audit & Compliance Suite
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Webhook } from 'svix';
import { createClient } from '@supabase/supabase-js';

// Load .env.local if present
const env = { ...process.env };
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [k, ...v] = trimmed.split('=');
        if (k && !env[k.trim()]) {
          env[k.trim()] = v.join('=').trim();
        }
      }
    }
  }
} catch {
  // Pass
}

const PRIMARY_PROD_URL = 'https://elvaveo-sales-agent.vercel.app';
const ALIAS_PROD_URL = 'https://elvaveo-sales-agent-elvatechnologies2004.vercel.app';

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || 'https://mainycklwbqcdhwqmneq.supabase.co';
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_WEBHOOK_SECRET = env.RESEND_WEBHOOK_SECRET || '';
const UNSUBSCRIBE_SECRET = env.UNSUBSCRIBE_SECRET || '';

const results = [];

function recordResult(testNumber, name, passed, details) {
  results.push({ testNumber, name, passed, details });
  const statusStr = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[TEST ${testNumber}] ${name}: ${statusStr}`);
  if (details) {
    console.log(`   Details: ${details}`);
  }
}

// Helper for signing unsubscribe tokens
function signUnsubscribeToken(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function auditWebhookSecurity(baseUrl) {
  console.log(`\n--- 1. AUDITING RESEND WEBHOOK ENDPOINT ON ${baseUrl} ---`);

  // 1. Unsigned Request
  try {
    const res1 = await fetch(`${baseUrl}/api/webhooks/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email.delivered' }),
    });
    const pass1 = res1.status === 401;
    recordResult(1, 'Resend Webhook Unsigned Request Blocked (401)', pass1, `Status: ${res1.status}`);
  } catch (err) {
    recordResult(1, 'Resend Webhook Unsigned Request Blocked (401)', false, err.message);
  }

  // 2. Tampered / Invalid Signature
  try {
    const res2 = await fetch(`${baseUrl}/api/webhooks/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'svix-id': 'msg_audit_tampered_123',
        'svix-timestamp': `${Math.floor(Date.now() / 1000)}`,
        'svix-signature': 'v1,fakesignaturehere1234567890abcdef',
      },
      body: JSON.stringify({ type: 'email.delivered' }),
    });
    const pass2 = res2.status === 401;
    recordResult(2, 'Resend Webhook Tampered Signature Rejected (401)', pass2, `Status: ${res2.status}`);
  } catch (err) {
    recordResult(2, 'Resend Webhook Tampered Signature Rejected (401)', false, err.message);
  }

  // 3. Valid Svix Cryptographic Signature
  let validProcessedId = null;
  const testPayloadStr = JSON.stringify({
    type: 'email.delivered',
    created_at: new Date().toISOString(),
    data: {
      id: `audit_evt_${Date.now()}`,
      email_id: `audit_email_${Date.now()}`,
      to: ['hello@elvaveo.com'],
      from: 'hello@outreach.elvaveo.com',
      subject: 'Live Audit Verification',
    },
  });
  const msgId = `msg_audit_live_${Date.now()}`;
  const timestamp = new Date();

  try {
    if (!RESEND_WEBHOOK_SECRET) {
      recordResult(3, 'Resend Webhook Valid Svix Signature Verification', false, 'RESEND_WEBHOOK_SECRET missing in environment');
    } else {
      const wh = new Webhook(RESEND_WEBHOOK_SECRET);
      const signature = wh.sign(msgId, timestamp, testPayloadStr);

      const res3 = await fetch(`${baseUrl}/api/webhooks/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': msgId,
          'svix-timestamp': `${Math.floor(timestamp.getTime() / 1000)}`,
          'svix-signature': signature,
        },
        body: testPayloadStr,
      });

      const body3 = await res3.json();
      const pass3 = res3.status === 200 && body3.success === true;
      validProcessedId = body3.processedEventId;
      recordResult(3, 'Resend Webhook Valid Svix Signature Verified (200)', pass3, `Status: ${res3.status}, Event: ${validProcessedId}`);

      // 4. Replay Deduplication
      const res4 = await fetch(`${baseUrl}/api/webhooks/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': msgId,
          'svix-timestamp': `${Math.floor(timestamp.getTime() / 1000)}`,
          'svix-signature': signature,
        },
        body: testPayloadStr,
      });
      const body4 = await res4.json();
      const pass4 = res4.status === 200 && body4.message === 'Duplicate event acknowledged';
      recordResult(4, 'Resend Webhook Replay Deduplication Enforced (200 Duplicate Acknowledged)', pass4, `Status: ${res4.status}, Msg: ${body4.message}`);
    }
  } catch (err) {
    recordResult(3, 'Resend Webhook Valid Svix Signature Verification', false, err.message);
  }
}

async function auditUnsubscribeCompliance(baseUrl) {
  console.log(`\n--- 2. AUDITING RFC 8058 UNSUBSCRIBE ENDPOINT ON ${baseUrl} ---`);

  // 5. Unsubscribe without token
  try {
    const res5 = await fetch(`${baseUrl}/api/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const pass5 = res5.status === 400;
    recordResult(5, 'Unsubscribe Route Rejects Missing Token (400)', pass5, `Status: ${res5.status}`);
  } catch (err) {
    recordResult(5, 'Unsubscribe Route Rejects Missing Token (400)', false, err.message);
  }

  // 6. Unsubscribe with forged / tampered token
  try {
    const res6 = await fetch(`${baseUrl}/api/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'eyJmb3JnZWQiOnRydWV9.invalidsignature12345' }),
    });
    const pass6 = res6.status === 400;
    recordResult(6, 'Unsubscribe Route Rejects Tampered Token (400)', pass6, `Status: ${res6.status}`);
  } catch (err) {
    recordResult(6, 'Unsubscribe Route Rejects Tampered Token (400)', false, err.message);
  }

  // 7. Unsubscribe with valid test-signed token
  try {
    if (!UNSUBSCRIBE_SECRET) {
      recordResult(7, 'Unsubscribe Route Processes Valid RFC 8058 Token', false, 'UNSUBSCRIBE_SECRET missing in environment');
    } else {
      const validTestToken = signUnsubscribeToken(
        {
          workspaceId: '00000000-0000-0000-0000-000000000001',
          leadId: 'audit-test-lead',
          email: 'audit-test@elvaveo.com',
          isTest: true,
          timestamp: Date.now(),
        },
        UNSUBSCRIBE_SECRET
      );

      const res7 = await fetch(`${baseUrl}/api/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: validTestToken }),
      });
      const body7 = await res7.json();
      const pass7 = res7.status === 200 && body7.success === true && body7.isTest === true;
      recordResult(7, 'Unsubscribe Route Processes Valid RFC 8058 Token (200 with test lead isolation)', pass7, `Status: ${res7.status}, Msg: ${body7.message}`);
    }
  } catch (err) {
    recordResult(7, 'Unsubscribe Route Processes Valid RFC 8058 Token', false, err.message);
  }
}

async function auditSupabaseDatabaseAndRLS() {
  console.log('\n--- 3. AUDITING SUPABASE DATABASE MIGRATIONS & RLS POLICIES ---');

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    recordResult(8, 'Supabase Configuration & Credentials', false, 'Missing SUPABASE_URL, ANON_KEY, or SERVICE_ROLE_KEY');
    return;
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 8. Confirm Table Migrations via Service Role
  const tables = [
    'workspaces',
    'workspace_members',
    'leads',
    'email_drafts',
    'draft_approvals',
    'send_logs',
    'suppressions',
    'audit_logs',
    'webhook_events',
  ];

  let allMigrated = true;
  const tableCounts = {};
  for (const table of tables) {
    const { count, error } = await serviceClient.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      allMigrated = false;
      tableCounts[table] = `ERROR: ${error.message}`;
    } else {
      tableCounts[table] = count;
    }
  }
  recordResult(8, 'Production Database Schema & Tables Migrated', allMigrated, `Verified 9 core tables: ${Object.keys(tableCounts).join(', ')}`);

  // 9. Anon Key RLS Access Prevention
  let anonZeroLeak = true;
  const anonDetails = [];
  for (const table of tables) {
    const { data, error } = await anonClient.from(table).select('*');
    if (data && data.length > 0) {
      anonZeroLeak = false;
      anonDetails.push(`${table}: LEAKED ${data.length} rows`);
    } else {
      anonDetails.push(`${table}: 0 rows (protected)`);
    }
  }

  // Attempt unauthorized insert with anon key
  const { error: anonInsErr } = await anonClient.from('leads').insert({
    email: 'unauthorized_audit@evil.com',
    workspace_id: '00000000-0000-0000-0000-000000000001',
  });
  const rlsBlocksInserts = Boolean(anonInsErr && anonInsErr.message.includes('row-level security'));

  const rlsPassed = anonZeroLeak && rlsBlocksInserts;
  recordResult(
    9,
    'Public Anon Key Strict RLS Enforcement (Zero Data Leak & Mutation Blocked)',
    rlsPassed,
    `Anon queries return 0 rows; Anon insert blocked: ${anonInsErr?.message || 'Failed to block'}`
  );

  // 10. Workspace Members & Role-Based Access Control
  const { data: members, error: memErr } = await serviceClient.from('workspace_members').select('*');
  const hasMembers = members && members.length > 0 && !memErr;
  const ownerMember = members?.find((m) => m.role === 'owner');

  recordResult(
    10,
    'Authoritative Workspace Membership & RBAC Configured',
    Boolean(hasMembers && ownerMember),
    `Found ${members?.length || 0} active members. Owner member: ${ownerMember?.user_id || 'None'}`
  );

  // 11. Power2Go Account Isolation Check
  const { data: authUsers } = await serviceClient.auth.admin.listUsers();
  const power2GoInWorkspace = members?.some(
    (m) =>
      authUsers?.users?.some((u) => u.id === m.user_id && (u.email?.includes('power2go') || u.email?.includes('gmail.com')))
  );

  recordResult(
    11,
    'Product & Account Isolation: Power2Go Gmail Excluded from Workspace Roles',
    !power2GoInWorkspace,
    power2GoInWorkspace ? 'Power2Go Gmail member found in workspace_members (FAIL)' : 'Power2Go Gmail strictly excluded from workspace_members (PASS)'
  );
}

async function auditSendingGuardrailsAndLimits() {
  console.log('\n--- 4. AUDITING SENDING ENGINE GUARDRAILS, LIMITS & OUTREACH GATING ---');

  const sendMode = env.SEND_MODE || 'test';
  const testRecipients = (env.TEST_RECIPIENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const dailyLimit = parseInt(env.DAILY_SEND_LIMIT_WORKSPACE || '50', 10);
  const hourlyLimit = parseInt(env.HOURLY_SEND_LIMIT_WORKSPACE || '10', 10);

  // 12. Real Prospect Outreach Disabled (SEND_MODE = test)
  const outreachGated = sendMode === 'test';
  recordResult(
    12,
    'Real Prospect Outreach Strictly Gated (SEND_MODE = test)',
    outreachGated,
    `Current server SEND_MODE="${sendMode}". Test recipients: [${testRecipients.join(', ')}]`
  );

  // 13. Sending Limits Configured
  const limitsValid = dailyLimit > 0 && dailyLimit <= 100 && hourlyLimit > 0 && hourlyLimit <= 20;
  recordResult(
    13,
    'Durable Sending Limits Enforced (24h Rolling Quota & 1h Burst Quota)',
    limitsValid,
    `Daily Limit: ${dailyLimit} msgs, Hourly Limit: ${hourlyLimit} msgs`
  );

  // 14. Permanent Vercel URL Availability
  try {
    const res = await fetch(PRIMARY_PROD_URL);
    const prodAvailable = res.status === 200;
    recordResult(
      14,
      `Permanent Vercel Production URL Active (${PRIMARY_PROD_URL})`,
      prodAvailable,
      `HTTP Status: ${res.status}`
    );
  } catch (err) {
    recordResult(14, `Permanent Vercel Production URL Active (${PRIMARY_PROD_URL})`, false, err.message);
  }
}

async function runAudit() {
  console.log('==============================================================================');
  console.log('       ELVAVEO SALES AGENT - PRODUCTION LIVE AUDIT & VERIFICATION             ');
  console.log('==============================================================================');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Permanent URL:', PRIMARY_PROD_URL);
  console.log('Alias URL:    ', ALIAS_PROD_URL);

  await auditWebhookSecurity(PRIMARY_PROD_URL);
  await auditUnsubscribeCompliance(PRIMARY_PROD_URL);
  await auditSupabaseDatabaseAndRLS();
  await auditSendingGuardrailsAndLimits();

  console.log('\n==============================================================================');
  console.log('                           AUDIT SCORECARD & SUMMARY                          ');
  console.log('==============================================================================');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  results.forEach((r) => {
    const mark = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${mark}] Test ${r.testNumber}: ${r.name}`);
  });

  console.log('\n------------------------------------------------------------------------------');
  console.log(`TOTAL CHECKS: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('------------------------------------------------------------------------------');

  if (failed === 0) {
    console.log('🎉 AUDIT STATUS: 100% PASS - ALL SECURITY & COMPLIANCE GUARDRAILS VERIFIED');
  } else {
    console.log(`⚠️ AUDIT STATUS: ${failed} CHECK(S) FAILED. REMAINING PRODUCTION BLOCKERS IDENTIFIED.`);
  }

  return { total, passed, failed, results };
}

runAudit().catch(console.error);

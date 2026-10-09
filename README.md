# ELVAVEO Sales Agent

An enterprise-grade, privacy-first outbound sales agent and workflow review engine built with **Next.js App Router**, **TypeScript**, **Supabase**, and **Resend**.

Designed specifically for **ELVAVEO**, this system enforces deterministic lead personalization, strict two-person approval gates, cryptographically bound email drafts, durable rate limiting, out-of-order delivery webhook handling, and affirmative consent compliance.

---

## Architecture & Security Highlights

- **Resend Exclusively**: Sends strictly via `ELVAVEO <hello@outreach.elvaveo.com>` with reply-to `hello@elvaveo.com`.
- **Zero Gmail / Power2Go Access**: Strictly isolates and blocks any connection, reading, or sending via personal Gmail or Power2Go Google accounts.
- **Fail-Closed Safety Default**: Initial default is `SEND_MODE=test`. Test sends route exclusively to server-configured `TEST_RECIPIENTS` with a `[TEST]` subject prefix and never contact actual prospects.
- **Content-Bound Approval Gate**: Draft approvals are cryptographically bound via SHA-256 hashes of the exact recipient, subject, body text, body HTML, sender, reply-to, and compliance footer. Any change automatically invalidates approval.
- **Durable Rate Limiting**: Database-backed rolling quotas (50/day workspace, 10/hour burst, 7-day recipient cooldown).
- **RFC 8058 One-Click Unsubscribe**: Cryptographically signed HMAC-SHA256 tokens protect prospect privacy. Email scanners and bots visiting links via GET are shown a confirmation gate to prevent false-positive opt-outs.
- **Append-Only Audit Trail**: Full immutability for lead modifications, consent changes, draft versions, review approvals, send dispatches, and webhook events.

---

## Step-by-Step Operator & Setup Guide

### 1. Local Installation & Starting the Application

Clone or open the project directory:
```bash
cd outputs/elvaveo-sales-agent
npm install
npm run dev
```
The application will start locally at `http://localhost:3000`.

### 2. Secure Environment Configuration

1. Copy the environment configuration template:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` in your editor and supply your credentials:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL (`https://xyzcompany.supabase.co`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public anon publishable key
   - `SUPABASE_SERVICE_ROLE_KEY`: Server-only secret key (never expose to browser)
   - `RESEND_API_KEY`: Resend API key (`re_...`)
   - `RESEND_WEBHOOK_SECRET`: Signing secret from Resend webhook dashboard (`whsec_...`)
   - `UNSUBSCRIBE_SECRET`: Random string of 32+ characters for signing HMAC tokens
   - `APP_URL`: Public application URL (e.g. `http://localhost:3000` or `https://sales.elvaveo.com`)
   - `SEND_MODE`: Keep as `test` during development and verification
   - `TEST_RECIPIENTS`: Comma-separated list of test email addresses you own and control (e.g. `your-name@elvaveo.com`)
   - `BUSINESS_ADDRESS`: Physical mailing address for CAN-SPAM legal footer

> **Important**: Never commit `.env.local` to git or paste secrets into chat or logs. `.env.local` is excluded in `.gitignore`.

### 3. Applying Migrations to the Dedicated Supabase Project

1. Navigate to your Supabase Project Dashboard -> **SQL Editor**.
2. Open the migration file:
   `supabase/migrations/20261008000001_elvaveo_sales_agent_schema.sql`
3. Execute the SQL script. This sets up:
   - Workspaces, Members, Leads, Suppressions, Email Drafts, Approvals, Send Logs, Webhook Events, and Audit Logs.
   - Row Level Security (RLS) policies on every table.
   - Workspace isolation functions (`is_workspace_member`, `is_workspace_admin_or_owner`, `is_workspace_reviewer_or_above`).
   - Trigger `trg_draft_update` for automatic approval invalidation upon edits.

### 4. Creating the First Owner and Inviting Users

1. In Supabase Dashboard -> **Authentication** -> **Users**, invite or register your primary user email.
2. In Supabase **SQL Editor**, assign the `owner` role to the initial workspace:
   ```sql
   INSERT INTO public.workspaces (id, name, slug) 
   VALUES ('ws-default-id', 'ELVAVEO Primary', 'elvaveo-primary')
   ON CONFLICT DO NOTHING;

   INSERT INTO public.workspace_members (workspace_id, user_id, role)
   VALUES ('ws-default-id', '<your-auth-user-id>', 'owner');
   ```
3. Role permissions:
   - **Owner / Admin**: Full workspace administration, lead management, drafting, review, approval, and sending.
   - **Reviewer**: Lead management, drafting, review, approval, and sending.
   - **Operator**: Lead management and drafting only. Approval and sending actions are strictly blocked.

### 5. Confirming Resend Domain Verification & DNS Configuration

1. Log into [Resend Dashboard](https://resend.com) -> **Domains** -> **Add Domain**.
2. Add `outreach.elvaveo.com`.
3. Add the provided DNS records to your domain DNS host:
   - **SPF TXT Record**: `v=spf1 include:amazonses.com ~all`
   - **DKIM CNAME Records**: Domain verification keys
   - **DMARC TXT Record**: `v=DMARC1; p=reject; rua=mailto:dmarc@elvaveo.com`
   - **MX Record**: Feedback loop routing
4. Verify that Resend displays `Status: Verified` before attempting live sends.

### 6. Configuring and Testing Signed Webhooks

1. In Resend Dashboard -> **Webhooks** -> **Add Webhook**.
2. Set Endpoint URL to:
   `https://sales.elvaveo.com/api/webhooks/resend` (or use an ngrok tunnel during local testing).
3. Select events:
   - `email.sent`
   - `email.delivered`
   - `email.delivery_delayed`
   - `email.bounced`
   - `email.complained`
4. Copy the **Signing Secret** (`whsec_...`) into `.env.local` as `RESEND_WEBHOOK_SECRET`.
5. The endpoint verifies every request body with `svix`, deduplicates events by `provider_event_id`, prevents out-of-order state regression (e.g. delivered will not regress to sent), and automatically adds bounced/complained addresses to the suppression list.

### 7. Setting an Owned Test-Recipient Address

1. In `.env.local`:
   ```bash
   TEST_RECIPIENTS=operator-test@elvaveo.com,dev@yourdomain.com
   ```
2. Ensure you have active inbox access to this address to verify rendering, headers, and links.

### 8. Manually Initiating a Test Email

1. Open the Dashboard -> Navigate to **Sending Station**.
2. Locate an approved draft.
3. Click **🧪 Send Test Email**.
4. The system validates server test mode, replaces the destination address with your configured `TEST_RECIPIENTS`, prefixes the subject with `[TEST]`, dispatches via Resend, and records a test log.
5. Inspect the incoming test message in your inbox to verify styling, compliance footer, and layout.

### 9. Reviewing and Approving a Draft

1. In the **Personalization Studio**, create or edit a draft using variables like `{{first_name}}`, `{{company}}`, `{{role}}`.
2. Missing lead fields are flagged automatically.
3. Click **Submit for Review**.
4. In the **Review Queue**, a user with the **Reviewer** or **Admin** role inspects the exact rendered preview and content hash.
5. Click **Approve Draft**. (If the draft text or recipient is modified after approval, approval is invalidated and resets to `draft`).

### 10. Deliberately Enabling Live Mode

1. Confirm that domain DNS is fully verified in Resend.
2. Ensure `BUSINESS_ADDRESS` is populated in `.env.local`.
3. Change `SEND_MODE=live` in `.env.local`.
4. Restart the server.
5. In the Dashboard Sending Station, the **Send Live Outreach** control will become available for approved drafts where the lead has recorded affirmative consent (`opted_in`) and is not suppressed.

### 11. Deployment, Troubleshooting & Uncertain-Send Reconciliation

- **Deployment**: Deploy to Vercel, Supabase Functions, or your Docker cluster. Set the exact same environment variables in your deployment settings.
- **Ambiguous Timeouts**: If a network timeout or provider connection reset occurs during a send attempt, the engine marks the status as `unknown` rather than blindly retrying, preventing accidental duplicate sends.
- **Reconciliation**: In the **Delivery Activity** tab, click **Reconcile** on any `unknown` record to compare against Resend delivery logs using the idempotency key.

---

## Operator Testing Checklist

- [x] Access Control: Operators cannot approve or send drafts (HTTP 403 / UI disabled).
- [x] Content Immutability: Editing an approved draft resets status to `draft` and increments version.
- [x] Consent Gating: Leads with `unknown` or `opted_out` consent cannot be sent live emails.
- [x] Suppression Protection: CSV imports flag suppressed leads and never clear suppression records.
- [x] Test Mode Gating: In `SEND_MODE=test`, emails route only to `TEST_RECIPIENTS` with `[TEST]` prefix.
- [x] Idempotency: Unique keys prevent duplicate dispatches upon double-click.
- [x] Out-of-Order Webhooks: Late arriving `sent` event does not overwrite `delivered`.
- [x] Unsubscribe Security: GET displays confirmation page; RFC 8058 POST executes one-click opt-out.
- [x] Test Opt-out Isolation: Test email unsubscribe links do not suppress real leads.

---

## Automated Test Verification

Run all unit and integration tests:
```bash
npm test
```
Result: **29/29 tests passed** across all security and workflow domains.

Run TypeScript type check:
```bash
npm run typecheck
```
Result: **Clean exit with 0 errors**.

Run production build:
```bash
npm run build
```
Result: **Successful production build (Next.js 16 App Router + Turbopack)**.

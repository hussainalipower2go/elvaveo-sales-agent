// ==============================================================================
// ELVAVEO Sales Agent - Server-Only Privileged Service Role Client
// ==============================================================================

import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Creates a privileged Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * Strictly used for trusted server tasks (webhooks, audit logging, system rate checks).
 * NEVER expose to browser code or call without prior authorization.
 */
export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Cannot initialize service role client: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

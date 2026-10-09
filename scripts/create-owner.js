// ==============================================================================
// ELVAVEO Sales Agent - Create First Owner Account Script
// ==============================================================================

const fs = require('fs');
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');

const envLines = fs.readFileSync('.env.local', 'utf8').split('\n');
const env = {};
envLines.forEach((l) => {
  const t = l.trim();
  if (t && !t.startsWith('#')) {
    const [k, ...v] = t.split('=');
    env[k] = v.join('=').trim();
  }
});

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Supabase credentials not found in .env.local');
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  console.log('\n--- ELVAVEO Sales Agent: Owner Account Setup ---');

  // Check existing users
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  if (existingUsers && existingUsers.users.length > 0) {
    console.log(`Found ${existingUsers.users.length} existing user(s) in Supabase Auth:`);
    existingUsers.users.forEach((u) => console.log(` - ${u.email} (ID: ${u.id})`));
  }

  rl.question('\nEnter owner email address: ', async (email) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      console.error('Invalid email address.');
      rl.close();
      return;
    }

    rl.question('Enter temporary password (min 8 chars): ', async (password) => {
      if (!password || password.length < 8) {
        console.error('Password must be at least 8 characters.');
        rl.close();
        return;
      }

      try {
        console.log(`\nCreating user ${cleanEmail}...`);
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: cleanEmail,
          password: password,
          email_confirm: true,
        });

        let userId = authData?.user?.id;

        if (authError) {
          if (authError.message.includes('already exists')) {
            console.log('User already exists in Supabase Auth. Fetching existing user ID...');
            const match = existingUsers.users.find((u) => u.email === cleanEmail);
            if (match) userId = match.id;
          } else {
            console.error('Auth error:', authError.message);
            rl.close();
            return;
          }
        }

        if (!userId) {
          console.error('Could not determine user ID.');
          rl.close();
          return;
        }

        console.log(`Assigning "owner" role in ELVAVEO workspace for user ${userId}...`);
        const { error: memberError } = await supabase.from('workspace_members').upsert(
          {
            workspace_id: '00000000-0000-0000-0000-000000000001',
            user_id: userId,
            role: 'owner',
          },
          { onConflict: 'workspace_id,user_id' }
        );

        if (memberError) {
          console.error('Failed to assign workspace role:', memberError.message);
        } else {
          console.log('\nSUCCESS! Owner account successfully configured.');
          console.log(`Email: ${cleanEmail}`);
          console.log(`Role: owner in workspace ELVAVEO Primary (00000000-0000-0000-0000-000000000001)`);
        }
      } catch (err) {
        console.error('Error:', err.message);
      } finally {
        rl.close();
      }
    });
  });
}

main();

const fs = require('fs');
const { execSync } = require('child_process');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const [k, ...v] = l.split('=');
      return [k.trim(), v.join('=').trim()];
    })
);

const val = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
try {
  console.log('Configuring NEXT_PUBLIC_SUPABASE_ANON_KEY as config on Vercel...');
  execSync(
    `npx --yes vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --project elvaveo-sales-agent --force --no-sensitive --yes`,
    { input: val, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  console.log('✓ Successfully configured NEXT_PUBLIC_SUPABASE_ANON_KEY');
} catch (err) {
  console.error('Failed:', err.message);
}

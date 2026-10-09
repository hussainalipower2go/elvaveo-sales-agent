const crypto = require('crypto');
const fs = require('fs');
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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const recipient = 'sarah.connor@cyberdyne-sys.com';
  const sender = 'ELVAVEO <hello@outreach.elvaveo.com>';
  const replyTo = 'hello@elvaveo.com';
  const subject = 'Accelerating Infrastructure Automation for Cyberdyne Systems';
  const bodyText =
    'Hi Sarah,\n\nI noticed your work as Head of Infrastructure at Cyberdyne Systems. ELVAVEO helps technology leaders streamline high-throughput infrastructure pipelines.\n\nWould you have 10 minutes next week to explore?';
  const bodyHtml =
    '<div style="font-family:sans-serif;font-size:15px;color:#111827;line-height:1.6;"><p>Hi Sarah,</p><p>I noticed your work as Head of Infrastructure at Cyberdyne Systems. ELVAVEO helps technology leaders streamline high-throughput infrastructure pipelines.</p><p>Would you have 10 minutes next week to explore?</p></div>';
  const footerText =
    '---\nELVAVEO Technologies Inc., 100 Innovation Way, Suite 400, Austin, TX 78701\nTo unsubscribe: http://localhost:3000/unsubscribe';
  const footerHtml =
    '<div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:12px;color:#6b7280;"><p>ELVAVEO Technologies Inc., 100 Innovation Way, Suite 400, Austin, TX 78701</p></div>';

  const hash = crypto
    .createHash('sha256')
    .update([recipient.toLowerCase(), sender, replyTo.toLowerCase(), subject, bodyText, bodyHtml, footerText, footerHtml].join('||'))
    .digest('hex');

  const draft = {
    id: '00000000-0000-0000-0000-000000000010',
    workspace_id: '00000000-0000-0000-0000-000000000001',
    lead_id: '0bcc0485-52d9-4823-a733-f1360a9b884a',
    version: 1,
    recipient_email: recipient,
    sender_email: sender,
    reply_to_email: replyTo,
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    footer_text: footerText,
    footer_html: footerHtml,
    content_hash: hash,
    status: 'pending_review',
    missing_fields: [],
  };

  const { data, error } = await supabase.from('email_drafts').upsert(draft).select();
  if (error) {
    console.error('Error inserting draft:', error);
  } else {
    console.log('Successfully seeded pending review draft in Supabase:', data[0].id);
  }
}

main();

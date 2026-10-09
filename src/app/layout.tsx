import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ELVAVEO Sales Agent | Autonomous Outreach & Review Engine',
  description:
    'Secure, compliant outbound sales pipeline management with deterministic personalization, explicit two-person approval gates, Resend integration, and durable rate limits.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}

'use client';

// ==============================================================================
// ELVAVEO Sales Agent - Web Unsubscribe Confirmation Page
// ==============================================================================

import { useState, useTransition, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No unsubscribe token was provided. Please use the link directly from your email.');
    }
  }, [token]);

  const handleConfirmUnsubscribe = () => {
    if (!token) return;

    startTransition(async () => {
      setStatus('loading');
      try {
        const res = await fetch('/api/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();

        if (res.ok) {
          setStatus('success');
          setMessage(
            data.message || 'You have been successfully removed from our outreach list.'
          );
        } else {
          setStatus('error');
          setMessage(data.error || 'Failed to verify unsubscribe request.');
        }
      } catch {
        setStatus('error');
        setMessage('Network error while processing your request. Please try again.');
      }
    });
  };

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: '32px 24px', background: '#ffffff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontFamily: 'system-ui, sans-serif', color: '#1e293b' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0', color: '#0f172a' }}>
          ELVAVEO
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
          Email Communication Preferences
        </p>
      </div>

      {status === 'idle' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 24, color: '#334155' }}>
            We respect your inbox. To prevent automated email scanners from inadvertently opting you out, please confirm that you want to unsubscribe from future outreach.
          </p>
          <button
            onClick={handleConfirmUnsubscribe}
            disabled={isPending}
            style={{
              padding: '12px 24px',
              fontSize: 15,
              fontWeight: 600,
              color: '#ffffff',
              backgroundColor: '#dc2626',
              border: 'none',
              borderRadius: 8,
              cursor: isPending ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.7 : 1,
              transition: 'background 0.2s',
            }}
          >
            {isPending ? 'Processing...' : 'Confirm Unsubscribe'}
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <p style={{ fontSize: 15, color: '#64748b' }}>Processing your request...</p>
        </div>
      )}

      {status === 'success' && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 16px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a', fontSize: 24, fontWeight: 'bold' }}>
            ✓
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
            Unsubscribed Successfully
          </h2>
          <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
            {message}
          </p>
        </div>
      )}

      {status === 'error' && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 16px', borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: 24, fontWeight: 'bold' }}>
            ✕
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#991b1b', marginBottom: 8 }}>
            Unable to Process Request
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
            {message}
          </p>
        </div>
      )}

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #f1f5f9', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
        ELVAVEO Outreach Compliance Engine
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', padding: 16 }}>
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>}>
        <UnsubscribeContent />
      </Suspense>
    </main>
  );
}

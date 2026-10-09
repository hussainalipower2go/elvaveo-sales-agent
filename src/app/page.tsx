// ==============================================================================
// ELVAVEO Sales Agent - Dashboard (Server Component Entry Point)
// ==============================================================================

import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchBackendData } from '@/lib/services/data-service';
import DashboardClient from './components/DashboardClient';

async function DashboardLoader() {
  await connection();
  const initialData = await fetchBackendData();
  return <DashboardClient initialData={initialData} />;
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#07090e',
            color: '#60a5fa',
            fontFamily: 'sans-serif',
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          Initializing ELVAVEO Sales Agent Mission Control...
        </div>
      }
    >
      <DashboardLoader />
    </Suspense>
  );
}

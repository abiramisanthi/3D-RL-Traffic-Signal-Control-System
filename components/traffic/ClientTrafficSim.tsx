'use client';

import dynamic from 'next/dynamic';

const TrafficSimApp = dynamic(() => import('./traffic-sim-app'), {
  ssr: false,  // Safe here in Client Component
});

export default function ClientTrafficSim() {
  return <TrafficSimApp />;
}
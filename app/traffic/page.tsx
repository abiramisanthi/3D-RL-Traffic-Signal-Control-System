import ClientTrafficSim from '@/components/traffic/ClientTrafficSim';  // This imports the wrapper

export default function TrafficPage() {
  return (
    <div>
      {/* Static content (server-rendered) */}
      <h1>3D RL-based traffic signal simulation prioritizing ambulances</h1>
      
      {/* Client-side sim via wrapper */}
      <ClientTrafficSim />
    </div>
  );
}

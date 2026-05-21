'use client';

import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type LogEntry = {
  t: number;
  reward: number;
  collisions: number;
  waits: number;
  throughput: number;
  ambWait: number;
};

export default function Dashboard() {
  const [logData, setLogData] = useState<LogEntry[]>([]);
  const [lastEntry, setLastEntry] = useState<LogEntry | null>(null);

  // Fetch data every 2s + on mount
  useEffect(() => {
    const fetchData = () => {
      try {
        const data = JSON.parse(localStorage.getItem('traffic-rl-log') || '[]');
        console.log('Dashboard loaded raw data:', data.slice(-3)); // Debug: Last 3 entries
        setLogData(data);
        setLastEntry(data[data.length - 1] || null);
      } catch (e) {
        console.error('Fetch error:', e);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 2000); // Poll for live updates
    return () => clearInterval(interval);
  }, []);

  // Derived: Avg reward over session
  const avgReward =
    logData.length > 0
      ? (logData.reduce((sum, d) => sum + d.reward, 0) / logData.length).toFixed(2)
      : '0.00';

  if (logData.length === 0) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">RL Traffic Dashboard</h1>
        <p className="text-gray-600 mb-4">No data yet—run the simulation (spawn cars/ambulances for 20s+).</p>
        <button
          onClick={() => (window.location.href = '/traffic')}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Go to Sim
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">RL Traffic Dashboard</h1>
        <div className="space-x-2">
          <button
            onClick={() => {
              localStorage.removeItem('traffic-rl-log');
              setLogData([]);
            }}
            className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
          >
            Clear Logs
          </button>
          <span className="text-sm text-gray-500">({logData.length} entries)</span>
        </div>
      </div>

      {/* Environment Spec - Static */}
      <section className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
        <h2 className="text-xl font-semibold mb-2">Environment Spec</h2>
        <ul className="space-y-1 text-sm">
          <li>• State: waiting counts per axis (NS/EW), ambulance presence.</li>
          <li>• Action: 0=NS Green (min green enforced), 1=EW Green.</li>
          <li>• Reward (per step): +10 per car cleared, +50 per ambulance cleared, -0.01×total waiting time, -10 if ambulance waiting, -50 per collision (overlap), -0.1 near-miss/switch.</li>
          <li>• Dynamics: two lanes per approach, safe headway, lane-change to pass, ambulance priority.</li>
        </ul>
      </section>

      {/* Live Metrics (last entry) */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Live Metrics (last session)</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
            <h3 className="font-medium text-blue-800 dark:text-blue-200">Avg Reward</h3>
            <p className="text-2xl font-bold">{avgReward}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded">
            <h3 className="font-medium text-green-800 dark:text-green-200">Throughput</h3>
            <p className="text-2xl font-bold">{lastEntry?.throughput || 0}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded">
            <h3 className="font-medium text-red-800 dark:text-red-200">Collisions</h3>
            <p className="text-2xl font-bold">{lastEntry?.collisions || 0}</p>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded">
            <h3 className="font-medium text-yellow-800 dark:text-yellow-200">Total Wait</h3>
            <p className="text-2xl font-bold">{lastEntry?.waits?.toFixed(1) || 0}s</p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded">
            <h3 className="font-medium text-orange-800 dark:text-orange-200">Amb Wait</h3>
            <p className="text-2xl font-bold">{lastEntry?.ambWait || 0}</p>
          </div>
        </div>
      </section>

      {/* Reward Over Time */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Reward Over Time</h2>
        {logData.length < 2 ? (
          <p className="text-gray-500">Not enough data (need 2+ points). Run sim longer!</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={logData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" label={{ value: 'Time (s)', position: 'insideBottom', offset: -10 }} />
              <YAxis label={{ value: 'Reward', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Line type="monotone" dataKey="reward" stroke="#8884d8" name="Reward" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* More Metrics */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold">More Metrics</h2>
        {logData.length < 2 ? (
          <p className="text-gray-500 col-span-full">Run sim to generate data for charts.</p>
        ) : (
          <>
            {/* Collisions Over Time */}
            <div>
              <h3 className="font-medium mb-2">Collisions Over Time</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={logData}>
                  <XAxis dataKey="t" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="collisions" stroke="#ef4444" name="Collisions" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Total Wait Over Time */}
            <div>
              <h3 className="font-medium mb-2">Total Wait Over Time</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={logData}>
                  <XAxis dataKey="t" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="waits" stroke="#f59e0b" name="Waiting Time" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Throughput Over Time */}
            <div>
              <h3 className="font-medium mb-2">Throughput Over Time</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={logData}>
                  <XAxis dataKey="t" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="throughput" stroke="#10b981" name="Cleared Vehicles" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      {/* Notes */}
      <section className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
        <h2 className="font-medium mb-2">Notes</h2>
        <p className="text-sm">
          • Keep safe gaps and change lanes left/right to overtake, which addresses your request that a straight-moving car should move left/right when needed. Any overlap is detected and penalized heavily and we immediately separate vehicles to prevent persistent overlap. The dashboard summarizes state, action, and reward and charts recent rewards logged by the sim.
        </p>
      </section>
    </div>
  );
}
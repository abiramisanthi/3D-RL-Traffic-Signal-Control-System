"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ThreeScene } from "./three-scene"
import { useTrafficSim } from "./use-traffic-sim"
import Link from "next/link"

type Dir = "N" | "S" | "E" | "W"

export default function TrafficSimApp() {
  const sim = useTrafficSim()
  const [ambDir, setAmbDir] = useState<Dir>("N")

  const anyAmbulanceWaiting = useMemo(
    () =>
      sim.state.queues.N.some((v) => v.type === "ambulance" && v.waiting) ||
      sim.state.queues.S.some((v) => v.type === "ambulance" && v.waiting) ||
      sim.state.queues.E.some((v) => v.type === "ambulance" && v.waiting) ||
      sim.state.queues.W.some((v) => v.type === "ambulance" && v.waiting),
    [sim.state.queues],
  )

  return (
    <div className="relative w-full h-full">
      {/* 3D Scene */}
      <div className="w-full h-full">
        <ThreeScene state={sim.state} />
      </div>

      {/* Overlay HUD */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
        <div className="flex items-center justify-between">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-card/80 px-3 py-2 shadow backdrop-blur">
            <div className="text-sm font-medium">Phase:</div>
            <div
              className={cn(
                "rounded px-2 py-1 text-sm",
                sim.state.phase === 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
              )}
              title="0 = NS green, 1 = EW green"
            >
              {sim.state.phase === 0 ? "NS GREEN" : "EW GREEN"}
            </div>
            <div className="text-sm">t={sim.state.phaseTime.toFixed(1)}s</div>
            <div className="text-sm">eps={sim.state.epsilon.toFixed(2)}</div>
          </div>

          {anyAmbulanceWaiting && (
            <div className="rounded-md bg-destructive text-destructive-foreground px-4 py-2 text-lg font-semibold shadow animate-pulse">
              Leave way for Ambulance
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-md bg-card/80 p-3 shadow backdrop-blur">
          <Button variant={sim.state.running ? "secondary" : "default"} onClick={sim.toggleRun}>
            {sim.state.running ? "Pause" : "Start"}
          </Button>
          <Button variant="outline" onClick={sim.stepOnce}>
            Step
          </Button>
          <Button variant="destructive" onClick={sim.reset}>
            Reset
          </Button>

          <div className="mx-2 h-6 w-px bg-border" />

          <Button variant="outline" onClick={() => sim.spawnRandomCar()}>
            Spawn Car (Random)
          </Button>

          <label className="text-sm opacity-80">Ambulance Dir</label>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={ambDir}
            onChange={(e) => setAmbDir(e.target.value as Dir)}
          >
            <option value="N">North</option>
            <option value="S">South</option>
            <option value="E">East</option>
            <option value="W">West</option>
          </select>
          <Button variant="default" onClick={() => sim.spawnAmbulance(ambDir)}>
            Spawn Ambulance
          </Button>

          <div className="mx-2 h-6 w-px bg-border" />

          <div className="flex items-center gap-3">
            <div className="text-sm">
              Reward: <span className="font-semibold">{sim.state.cumulativeReward.toFixed(2)}</span>
            </div>
            <div className="text-sm">
              Cleared: <span className="font-semibold">{sim.state.clearedCount}</span>
            </div>
            <div className="text-sm">
              Waiting: <span className="font-semibold">{sim.state.totalWaiting}</span>
            </div>
            <div className="text-sm">
              Collisions: <span className="font-semibold">{sim.state.collisions}</span>
            </div>
          </div>
          <div className="ml-auto">
            <Link
              href="/traffic/dashboard"
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

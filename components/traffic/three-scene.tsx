"use client"

import { useMemo } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, Environment } from "@react-three/drei"

type Dir = "N" | "S" | "E" | "W"
type Vehicle = {
  id: string
  dir: Dir
  type: "car" | "ambulance"
  pos: number // distance to stop line (>0 before stop line)
  progress: number // crossing progress [0..1] while in intersection
  waiting: boolean
  lane?: 0 | 1
  laneChange?: { target: 0 | 1; t: number } // 0..1
}
type SimState = {
  phase: 0 | 1 // 0=NS green, 1=EW green
  phaseTime: number
  queues: Record<Dir, Vehicle[]>
}

export function ThreeScene({ state }: { state: SimState }) {
  const lightsColor = useMemo(
    () => ({
      NS: state.phase === 0 ? "yellow" : "red",
      EW: state.phase === 1 ? "yellow" : "red",
    }),
    [state.phase],
  )

  return (
    <Canvas camera={{ position: [10, 14, 14], fov: 50 }}>
      {/* Scene Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1} castShadow />

      {/* Ground */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color={"#7aa57a"} />
      </mesh>

      {/* Roads */}
      <Road />

      {/* Traffic Lights (corners) */}
      <TrafficLights nsColor={lightsColor.NS} ewColor={lightsColor.EW} />

      {/* Vehicles */}
      <Vehicles queues={state.queues} phase={state.phase} />

      {/* Camera Controls for inspection */}
      <OrbitControls enablePan enableRotate enableZoom />
      <Environment preset="city" />
    </Canvas>
  )
}

function Road() {
  // Simple plus intersection: EW road along X, NS along Z
  return (
    <group>
      {/* East-West */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[60, 10]} />
        <meshStandardMaterial color={"#4b4b4b"} />
      </mesh>
      {/* North-South */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[10, 60]} />
        <meshStandardMaterial color={"#4b4b4b"} />
      </mesh>

      {/* Stop lines */}
      <StopLine position={[0, 0.03, 5]} rotation={0} />
      <StopLine position={[0, 0.03, -5]} rotation={0} />
      <StopLine position={[5, 0.03, 0]} rotation={Math.PI / 2} />
      <StopLine position={[-5, 0.03, 0]} rotation={Math.PI / 2} />
    </group>
  )
}

function StopLine({
  position,
  rotation,
}: {
  position: [number, number, number]
  rotation: number
}) {
  return (
    <mesh position={position} rotation-y={rotation} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[10, 0.3]} />
      <meshStandardMaterial color={"white"} />
    </mesh>
  )
}

function TrafficLights({ nsColor, ewColor }: { nsColor: string; ewColor: string }) {
  const poles: [number, number, number][] = [
    [6.5, 1.8, 6.5],
    [-6.5, 1.8, 6.5],
    [6.5, 1.8, -6.5],
    [-6.5, 1.8, -6.5],
  ]
  return (
    <group>
      {poles.map((p, i) => (
        <group key={i} position={p}>
          {/* Pole */}
          <mesh castShadow>
            <cylinderGeometry args={[0.1, 0.1, 3]} />
            <meshStandardMaterial color={"#333"} />
          </mesh>
          {/* Traffic light box */}
          <mesh position={[0, 1.8, 0]} castShadow>
            <boxGeometry args={[0.35, 1.0, 0.15]} />
            <meshStandardMaterial color={"#1a1a1a"} />
          </mesh>
          {/* NS signal (left side) - stacked red/yellow/green */}
          <group position={[-0.15, 1.8, 0.1]}>
            {/* Red */}
            <mesh position={[0, 0.3, 0]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial
                color={nsColor === "red" ? "#ff0000" : "#330000"}
                emissive={nsColor === "red" ? "#ff0000" : "#000000"}
                emissiveIntensity={nsColor === "red" ? 0.8 : 0.1}
              />
            </mesh>
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial
                color={nsColor === "yellow" ? "#ffff00" : "#333300"}
                emissive={nsColor === "yellow" ? "#ffff00" : "#000000"}
                emissiveIntensity={nsColor === "yellow" ? 0.8 : 0.1}
              />
            </mesh>
            {/* Green */}
            <mesh position={[0, -0.3, 0]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color={"#003300"} emissive={"#000000"} emissiveIntensity={0.1} />
            </mesh>
          </group>
          {/* EW signal (right side) - stacked red/yellow/green */}
          <group position={[0.15, 1.8, 0.1]}>
            {/* Red */}
            <mesh position={[0, 0.3, 0]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial
                color={ewColor === "red" ? "#ff0000" : "#330000"}
                emissive={ewColor === "red" ? "#ff0000" : "#000000"}
                emissiveIntensity={ewColor === "red" ? 0.8 : 0.1}
              />
            </mesh>
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial
                color={ewColor === "yellow" ? "#ffff00" : "#333300"}
                emissive={ewColor === "yellow" ? "#ffff00" : "#000000"}
                emissiveIntensity={ewColor === "yellow" ? 0.8 : 0.1}
              />
            </mesh>
            {/* Green */}
            <mesh position={[0, -0.3, 0]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color={"#003300"} emissive={"#000000"} emissiveIntensity={0.1} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}

function Vehicles({ queues, phase }: { queues: Record<Dir, Vehicle[]>; phase: 0 | 1 }) {
  // Convert abstract lane positions to world coordinates
  // Stop lines at z=+/-5 for NS and x=+/-5 for EW
  // Vehicles in queue sit behind stop line; when crossing, move across intersection toward the opposite side.
  return (
    <group>
      {(["N", "S", "E", "W"] as Dir[]).map((dir) =>
        queues[dir].map((v, idx) => {
          const { x, z, rot } = vehiclePosition(dir, v)
          const color = v.type === "ambulance" ? "#d63b3b" : "#3b82f6"
          const emissive = v.type === "ambulance" ? "#ff4d4d" : "#111111"
          const blink = v.type === "ambulance" && Math.floor((v.progress * 60 + idx) % 2) === 0
          return (
            <group key={v.id} position={[x, 0.4, z]} rotation-y={rot}>
              {/* Body */}
              <mesh castShadow receiveShadow>
                <boxGeometry args={[1.1, 0.7, 2]} />
                <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={blink ? 1.0 : 0.2} />
              </mesh>
              {/* Top light bar for ambulance */}
              {v.type === "ambulance" && (
                <mesh position={[0, 0.6, 0]}>
                  <boxGeometry args={[0.6, 0.2, 0.4]} />
                  <meshStandardMaterial
                    color={blink ? "#ffffff" : "#ff9c9c"}
                    emissive={"#ff9c9c"}
                    emissiveIntensity={blink ? 1.3 : 0.4}
                  />
                </mesh>
              )}
              {/* Simple wheels */}
              <Wheels />
            </group>
          )
        }),
      )}
    </group>
  )
}

function Wheels() {
  return (
    <group>
      <mesh position={[0.45, -0.05, 0.8]}>
        <cylinderGeometry args={[0.18, 0.18, 0.3, 16]} />
        <meshStandardMaterial color={"#222"} />
        <mesh rotation-z={Math.PI / 2} />
      </mesh>
      <mesh position={[-0.45, -0.05, 0.8]}>
        <cylinderGeometry args={[0.18, 0.18, 0.3, 16]} />
        <meshStandardMaterial color={"#222"} />
        <mesh rotation-z={Math.PI / 2} />
      </mesh>
      <mesh position={[0.45, -0.05, -0.8]}>
        <cylinderGeometry args={[0.18, 0.18, 0.3, 16]} />
        <meshStandardMaterial color={"#222"} />
        <mesh rotation-z={Math.PI / 2} />
      </mesh>
      <mesh position={[-0.45, -0.05, -0.8]}>
        <cylinderGeometry args={[0.18, 0.18, 0.3, 16]} />
        <meshStandardMaterial color={"#222"} />
        <mesh rotation-z={Math.PI / 2} />
      </mesh>
    </group>
  )
}

function vehiclePosition(dir: Dir, v: Vehicle) {
  const L = 5
  let x = 0
  let z = 0
  let rot = 0

  const offs = laneOffsetsFor(dir)
  const lane = v.lane ?? 0
  const lcT = v.laneChange?.t ?? 0
  const lcTarget = v.laneChange?.target ?? lane
  const fromOffset = offs[lane]
  const toOffset = offs[lcTarget]
  const lateral = v.laneChange ? fromOffset * (1 - lcT) + toOffset * lcT : fromOffset

  if (v.progress > 0) {
    const span = 14
    if (dir === "N") {
      x = lateral
      z = L - span * v.progress
      rot = Math.PI
    } else if (dir === "S") {
      x = lateral
      z = -L + span * v.progress
      rot = 0
    } else if (dir === "E") {
      x = L - span * v.progress
      z = lateral
      rot = -Math.PI / 2
    } else {
      x = -L + span * v.progress
      z = lateral
      rot = Math.PI / 2
    }
    return { x, z, rot }
  }

  const d = v.pos
  if (dir === "N") {
    x = lateral
    z = L + d
    rot = Math.PI
  } else if (dir === "S") {
    x = lateral
    z = -L - d
    rot = 0
  } else if (dir === "E") {
    x = L + d
    z = lateral
    rot = -Math.PI / 2
  } else {
    x = -L - d
    z = lateral
    rot = Math.PI / 2
  }
  return { x, z, rot }
}

function laneOffsetsFor(dir: Dir): readonly [number, number] {
  if (dir === "N") return [-1.6, -0.4] as const
  if (dir === "S") return [0.4, 1.6] as const
  if (dir === "E") return [-1.6, -0.4] as const
  return [0.4, 1.6] as const // "W"
}

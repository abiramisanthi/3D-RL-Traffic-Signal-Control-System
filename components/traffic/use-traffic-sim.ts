"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type Dir = "N" | "S" | "E" | "W"
type Phase = 0 | 1 // 0=NS green, 1=EW green
type Vehicle = {
  id: string
  dir: Dir
  type: "car" | "ambulance"
  pos: number // distance to stop line (>0 before stop line)
  progress: number // [0..1] crossing
  waiting: boolean
  waitTime: number
  lane: 0 | 1
  laneChange?: { target: 0 | 1; t: number }
}

type Queues = Record<Dir, Vehicle[]>

type SimState = {
  phase: Phase
  phaseTime: number
  queues: Queues
  running: boolean
  epsilon: number
  cumulativeReward: number
  clearedCount: number
  totalWaiting: number
  collisions: number
}

type RLMemory = {
  lastStateKey?: string
  lastAction?: 0 | 1
  q: Map<string, [number, number]> // state key -> [Q(phase=NS), Q(phase=EW)]
}

const TICK = 1 / 30 // seconds per frame
const MIN_PHASE_TIME = 3.5 // increased from 1.2 to keep light on longer
const DECISION_INTERVAL = 1.2 // increased from 0.4 to make decisions less frequently
const MAX_QUEUE_GAP = 4.5 // increased from 3.5 for safer spacing
const CAR_SPEED = 0.9 // reduced from 1.3 to make cars move slower
const AMB_SPEED = 5.5
const CROSS_SPEED = 3.8 // speed while crossing (normalized into progress)
const SWITCH_PENALTY = -0.1
const AMBULANCE_WAIT_PENALTY = -20
const WAIT_PENALTY_FACTOR = -0.01
const CLEAR_REWARD = 10.0 // higher positive reward per car cleared
const CLEAR_REWARD_AMB = 50.0 // priority for ambulance cleared
const COLLISION_PENALTY = -50 // strong negative for overlap
const NEAR_MISS_PENALTY = -5 // small negative for too-close gaps
const EPSILON_DECAY = 0.9995
const EPSILON_MIN = 0.05
const GAMMA = 0.92
const ALPHA = 0.25

const COLLISION_DIST = 0.8
const NEAR_MISS_DIST = 2.8
const SAFE_MOVE_REWARD = 0.02
const AMBULANCE_DETECTION_RANGE = 8.0

function makeVehicle(dir: Dir, type: "car" | "ambulance"): Vehicle {
  return {
    id: `${type}-${dir}-${Math.random().toString(36).slice(2, 9)}`,
    dir,
    type,
    pos: 2 + Math.random() * 4,
    progress: 0,
    waiting: true,
    waitTime: 0,
    lane: Math.random() < 0.5 ? 0 : 1,
  }
}

function initialQueues(): Queues {
  return { N: [], S: [], E: [], W: [] }
}

function cloneQueues(q: Queues): Queues {
  return {
    N: q.N.map((v) => ({ ...v })),
    S: q.S.map((v) => ({ ...v })),
    E: q.E.map((v) => ({ ...v })),
    W: q.W.map((v) => ({ ...v })),
  }
}

function dirAxis(d: Dir): "NS" | "EW" {
  return d === "N" || d === "S" ? "NS" : "EW"
}

function stateKey(queues: Queues): string {
  const nsLen = Math.min(queues.N.length + queues.S.length, 6)
  const ewLen = Math.min(queues.E.length + queues.W.length, 6)
  const ambNS = Number(queues.N.some((v) => v.type === "ambulance") || queues.S.some((v) => v.type === "ambulance"))
  const ambEW = Number(queues.E.some((v) => v.type === "ambulance") || queues.W.some((v) => v.type === "ambulance"))
  return `NS${nsLen}-EW${ewLen}-A${ambNS}${ambEW}`
}

// World position helper for collisions
function worldPos(dir: Dir, v: Vehicle) {
  const L = 5
  const offs = laneOffsetsFor(dir)
  const lane = v.lane
  const lcT = v.laneChange?.t ?? 0
  const lcTarget = v.laneChange?.target ?? lane
  const fromOffset = offs[lane]
  const toOffset = offs[lcTarget]
  const lateral = v.laneChange ? fromOffset * (1 - lcT) + toOffset * lcT : fromOffset

  if (v.progress > 0) {
    const span = 14
    if (dir === "N") return { x: lateral, z: L - span * v.progress }
    if (dir === "S") return { x: lateral, z: -L + span * v.progress }
    if (dir === "E") return { x: L - span * v.progress, z: lateral }
    return { x: -L + span * v.progress, z: lateral }
  }
  const d = v.pos
  if (dir === "N") return { x: lateral, z: L + d }
  if (dir === "S") return { x: lateral, z: -L - d }
  if (dir === "E") return { x: L + d, z: lateral }
  return { x: -L - d, z: lateral }
}

// Lane utilities
function byLane(arr: Vehicle[]) {
  const lane0 = arr.filter((v) => v.lane === 0).sort((a, b) => a.pos - b.pos)
  const lane1 = arr.filter((v) => v.lane === 1).sort((a, b) => a.pos - b.pos)
  return [lane0, lane1] as const
}

function axisOf(dir: Dir): "NS" | "EW" {
  return dir === "N" || dir === "S" ? "NS" : "EW"
}
function anyCrossing(queues: Queues, axis: "NS" | "EW") {
  const dirs = axis === "NS" ? (["N", "S"] as const) : (["E", "W"] as const)
  return dirs.some((d) => queues[d].some((v) => v.progress > 0))
}
function intersectionClearFor(dir: Dir, queues: Queues) {
  const ax = axisOf(dir)
  return ax === "NS" ? !anyCrossing(queues, "EW") : !anyCrossing(queues, "NS")
}

function laneOffsetsFor(dir: Dir): readonly [number, number] {
  // Two lanes per approach on each carriageway (mirrored for opposite directions)
  // NS axis uses X offsets, EW axis uses Z offsets.
  // N (southbound) uses west carriageway (negative X), S (northbound) uses east carriageway (positive X)
  // E (westbound) uses south carriageway (negative Z), W (eastbound) uses north carriageway (positive Z)
  if (dir === "N") return [-1.6, -0.4] as const
  if (dir === "S") return [0.4, 1.6] as const
  if (dir === "E") return [-1.6, -0.4] as const
  return [0.4, 1.6] as const // "W"
}

export function useTrafficSim() {
  const [state, setState] = useState<SimState>({
    phase: 0,
    phaseTime: 0,
    queues: initialQueues(),
    running: true,
    epsilon: 0.35,
    cumulativeReward: 0,
    clearedCount: 0,
    totalWaiting: 0,
    collisions: 0,
  })
  const rl = useRef<RLMemory>({ q: new Map() })
  const switchedThisStep = useRef(false)
  const tRef = useRef(0)
  const lastSpawnTime = useRef(0)

  const logBuf = useRef<
    { t: number; reward: number; collisions: number; waits: number; throughput: number; ambWait: number }[]
  >([])

  const persistLog = useCallback(() => {
    try {
      const prev = JSON.parse(localStorage.getItem("traffic-rl-log") || "[]")
      const merged = [...prev, ...logBuf.current].slice(-1000)
      localStorage.setItem("traffic-rl-log", JSON.stringify(merged))
      logBuf.current = []
    } catch {}
  }, [])

  const setQueues = (fn: (q: Queues) => Queues) =>
    setState((s) => {
      const newQueues = fn(cloneQueues(s.queues))
      return { ...s, queues: newQueues }
    })

  const spawnRandomCar = useCallback(() => {
    const dirs: Dir[] = ["N", "S", "E", "W"]
    const d = dirs[Math.floor(Math.random() * dirs.length)]
    setQueues((q) => enqueue(q, makeVehicle(d, "car")))
  }, [])

  const spawnAmbulance = useCallback((dir: Dir) => {
    setQueues((q) => enqueue(q, makeVehicle(dir, "ambulance")))
  }, [])

  const reset = useCallback(() => {
    rl.current = { q: new Map() }
    setState({
      phase: 0,
      phaseTime: 0,
      queues: initialQueues(),
      running: false,
      epsilon: 0.35,
      cumulativeReward: 0,
      clearedCount: 0,
      totalWaiting: 0,
      collisions: 0,
    })
  }, [])

  const toggleRun = useCallback(() => {
    setState((s) => ({ ...s, running: !s.running }))
  }, [])

  const stepLogic = useCallback(
    (dt: number) => {
      setState((sPrev) => {
        const s = { ...sPrev, phaseTime: sPrev.phaseTime + dt }
        switchedThisStep.current = false
        tRef.current += dt

        let reward = 0
        let clearedThisTick = 0
        let totalWaiting = 0
        let collisionsThisTick = 0
        let ambWaitingCount = 0

        const queues = cloneQueues(s.queues)
        const phaseAxis = s.phase === 0 ? "NS" : "EW"

        // For each direction, process lanes
        ;(["N", "S", "E", "W"] as Dir[]).forEach((dir) => {
          const arr = queues[dir]
          const [lane0, lane1] = byLane(arr)
          for (const laneArr of [lane0, lane1]) {
            for (let i = 0; i < laneArr.length; i++) {
              const v = laneArr[i]

              // track waiting metrics
              if (v.type === "ambulance" && v.progress === 0 && v.pos > 0) ambWaitingCount += 1

              // lane-change animation advance
              if (v.laneChange) {
                v.laneChange.t = Math.min(1, v.laneChange.t + dt * 1.5)
                if (v.laneChange.t >= 1) {
                  v.lane = v.laneChange.target
                  delete v.laneChange
                }
              }

              // crossing
              if (v.progress > 0) {
                const prevProg = v.progress
                v.waiting = false
                v.progress = Math.min(1, v.progress + (CROSS_SPEED * dt) / 12)
                if (v.progress >= 1) {
                  clearedThisTick += 1
                  reward += v.type === "ambulance" ? CLEAR_REWARD_AMB : CLEAR_REWARD
                  const idx = arr.findIndex((x) => x.id === v.id)
                  if (idx >= 0) arr.splice(idx, 1)
                } else {
                  const dProg = Math.max(0, v.progress - prevProg)
                  reward += SAFE_MOVE_REWARD * dProg * 20
                }
                continue
              }

              // queue dynamics
              const speed = v.type === "ambulance" ? AMB_SPEED : CAR_SPEED
              const isPhaseGreen = (dirAxis(dir) === "NS" && s.phase === 0) || (dirAxis(dir) === "EW" && s.phase === 1)

              const ahead = i === 0 ? null : laneArr[i - 1]
              const ambulanceAhead = ahead && ahead.type === "ambulance"
              const targetGap = ambulanceAhead && v.type === "car" ? MAX_QUEUE_GAP * 0.6 : MAX_QUEUE_GAP
              const targetPos = i === 0 ? 0 : Math.max(0, (ahead?.pos ?? 0) + targetGap)

              // waiting time accumulation
              if (v.pos > 0 && v.progress === 0) {
                v.waitTime += dt
                totalWaiting += v.waitTime
              }

              // consider lane change if blocked by ahead and space exists on adjacent lane
              const tryLaneChange = ahead && v.pos - ahead.pos < targetGap + 0.2 && v.pos > 0.2
              if (tryLaneChange && !v.laneChange) {
                const otherLane: 0 | 1 = v.lane === 0 ? 1 : 0
                const others = otherLane === 0 ? lane0 : lane1
                const front = others.filter((o) => o.pos <= v.pos).sort((a, b) => b.pos - a.pos)[0]
                const back = others.filter((o) => o.pos > v.pos).sort((a, b) => a.pos - b.pos)[0]
                const laneChangeGap = v.type === "ambulance" ? MAX_QUEUE_GAP * 0.5 : MAX_QUEUE_GAP + 0.5
                const okFront = !front || v.pos - front.pos >= laneChangeGap
                const okBack = !back || back.pos - v.pos >= laneChangeGap
                if (okFront && okBack) {
                  v.laneChange = { target: otherLane, t: 0 }
                }
              }

              const prevPos = v.pos
              // move toward targetPos
              if (v.pos > targetPos) {
                v.pos = Math.max(targetPos, v.pos - speed * dt)
              }

              // start crossing (only if green AND opposing axis intersection is clear)
              const atLine = v.pos <= 0.2
              if (isPhaseGreen && atLine && intersectionClearFor(dir, queues)) {
                v.progress = 0.001
                v.waiting = false
              } else {
                v.waiting = true
              }
              if (v.pos < prevPos && isPhaseGreen && intersectionClearFor(dir, queues)) {
                const dPos = Math.max(0, prevPos - v.pos)
                reward += SAFE_MOVE_REWARD * dPos
              }
            }
          }
        })

        // COLLISION CHECKS (world-space, circle approx)
        const allVehicles: Vehicle[] = ([] as Vehicle[]).concat(queues.N, queues.S, queues.E, queues.W)
        for (let i = 0; i < allVehicles.length; i++) {
          const a = allVehicles[i]
          const pa = worldPos(a.dir, a)
          for (let j = i + 1; j < allVehicles.length; j++) {
            const b = allVehicles[j]
            const pb = worldPos(b.dir, b)
            const dx = pa.x - pb.x
            const dz = pa.z - pb.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            if (dist < COLLISION_DIST) {
              reward += COLLISION_PENALTY * 1.5
              collisionsThisTick += 1
              if (a.progress > b.progress) {
                if (a.progress > 0) a.progress = Math.max(0, a.progress - 0.12)
                else a.pos += 1.5
              } else {
                if (b.progress > 0) b.progress = Math.max(0, b.progress - 0.12)
                else b.pos += 1.5
              }
            } else if (dist < NEAR_MISS_DIST) {
              reward += NEAR_MISS_PENALTY * 0.3
            }
          }
        }

        // waiting penalties and ambulance wait penalty
        if (ambWaitingCount > 0) reward += AMBULANCE_WAIT_PENALTY
        reward += WAIT_PENALTY_FACTOR * totalWaiting

        // Decision and Q-learning
        const decideNow = s.phaseTime >= DECISION_INTERVAL
        if (decideNow) {
          const key = stateKey(queues)
          const qRow = rl.current.q.get(key) ?? [0, 0]
          rl.current.q.set(key, qRow)

          let action: 0 | 1 = qRow[0] >= qRow[1] ? 0 : 1
          if (Math.random() < s.epsilon) action = Math.random() < 0.5 ? 0 : 1

          const ambNS =
            queues.N.some((v) => v.type === "ambulance" && v.waiting) ||
            queues.S.some((v) => v.type === "ambulance" && v.waiting)
          const ambEW =
            queues.E.some((v) => v.type === "ambulance" && v.waiting) ||
            queues.W.some((v) => v.type === "ambulance" && v.waiting)
          if (ambNS !== ambEW) action = ambNS ? 0 : 1

          if (action !== s.phase && s.phaseTime >= MIN_PHASE_TIME) {
            s.phase = action
            s.phaseTime = 0
            switchedThisStep.current = true
          }

          if (rl.current.lastStateKey != null && rl.current.lastAction != null) {
            const lastQ = rl.current.q.get(rl.current.lastStateKey) ?? [0, 0]
            const maxNext = Math.max(qRow[0], qRow[1])
            const a = rl.current.lastAction
            lastQ[a] = lastQ[a] + ALPHA * (reward + GAMMA * maxNext - lastQ[a])
            rl.current.q.set(rl.current.lastStateKey, lastQ)
          }
          rl.current.lastStateKey = key
          rl.current.lastAction = s.phase
        }

        if (switchedThisStep.current) reward += SWITCH_PENALTY

        // accumulate
        s.cumulativeReward += reward
        s.epsilon = Math.max(EPSILON_MIN, s.epsilon * EPSILON_DECAY)
        s.clearedCount += clearedThisTick
        s.totalWaiting = totalWaiting
        s.collisions += collisionsThisTick
        s.queues = queues

        if (tRef.current % 0.2 < dt) {
          logBuf.current.push({
            t: tRef.current,
            reward,
            collisions: s.collisions,
            waits: totalWaiting,
            throughput: s.clearedCount,
            ambWait: ambWaitingCount,
          })
          if (logBuf.current.length > 10) persistLog()
        }

        return s
      })
    },
    [persistLog],
  )

  // Ticker
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // run a fixed number of physics substeps if running
      if (typeof window === "undefined") return

      setState((s) => {
        if (!s.running) return s
        stepLogic(TICK)
        return s
      })
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [stepLogic])

  const stepOnce = useCallback(() => {
    setState((s) => ({ ...s, running: false }))
    stepLogic(TICK * 8) // advance a few ticks for a visible change
  }, [stepLogic])

  const enqueue = (q: Queues, v: Vehicle) => {
    // Place behind last vehicle, respecting gap
    const arr = q[v.dir]
    const last = arr[arr.length - 1]
    const base = last ? last.pos + MAX_QUEUE_GAP : 3 + Math.random() * 2
    v.pos = base
    arr.push(v)
    return q
  }

  const api = useMemo(
    () => ({
      state,
      toggleRun,
      stepOnce,
      reset,
      spawnRandomCar,
      spawnAmbulance,
    }),
    [reset, spawnAmbulance, spawnRandomCar, state, stepOnce, toggleRun],
  )

  return api
}

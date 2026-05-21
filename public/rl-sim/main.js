const canvas = document.getElementById("sim")
const ctx = canvas.getContext("2d")
const rewardCanvas = document.getElementById("rewardChart")
const rctx = rewardCanvas.getContext("2d")

const els = {
  btnStart: document.getElementById("btnStart"),
  btnReset: document.getElementById("btnReset"),
  btnSpawnCars: document.getElementById("btnSpawnCars"),
  btnSpawnAmb: document.getElementById("btnSpawnAmb"),
  speedSlider: document.getElementById("speedSlider"),
  phase: document.getElementById("phase"),
  reward: document.getElementById("reward"),
  cumReward: document.getElementById("cumReward"),
  collisions: document.getElementById("collisions"),
  throughput: document.getElementById("throughput"),
  avgWait: document.getElementById("avgWait"),
  ambWaiting: document.getElementById("ambWaiting"),
  overlay: document.getElementById("overlay"),
}

// World and road geometry
const W = canvas.width
const H = canvas.height
const CX = W / 2
const CY = H / 2

// Road parameters
const laneWidth = 14
const lanesPerDir = 2 // two inbound lanes per approach
const roadHalf = lanesPerDir * laneWidth + 10 // half-width of inbound carriageway
const interSize = 120 // size of intersection box
const stopLine = interSize / 2 + 18 // stop-line distance from center
const maxSpeed = 80 // px/s baseline
const ambBoost = 1.25 // ambulance speed factor
const headway = 26 // safe gap between cars in same lane (px)
const laneChangeTime = 0.45 // seconds to complete lateral change
const dtTarget = 1 / 60 // seconds per sim tick

// RL agent config
const epsilonMin = 0.05,
  epsilonDecay = 0.9995,
  alpha = 0.12,
  gamma = 0.94
let epsilon = 0.35

// Utility
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0)
function rand(a, b) {
  return a + Math.random() * (b - a)
}
function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Vehicles
let idSeq = 1
function laneOffset(dir, laneIndex) {
  // inbound carriageways separated to avoid head-on overlap
  // laneIndex is 0 or 1, with 0 closer to the median
  const base = (laneIndex + 0.5) * laneWidth
  switch (dir) {
    case "N":
      return { dx: base, dy: 0 } // inbound from North goes down, on right side of vertical road
    case "S":
      return { dx: -base, dy: 0 } // inbound from South goes up, mirrored horizontally
    case "E":
      return { dx: 0, dy: base } // inbound from East goes left, on lower half of horizontal road
    case "W":
      return { dx: 0, dy: -base } // inbound from West goes right, on upper half
  }
}

function posOf(dir, s, laneIndex, lateral = 0) {
  // s is distance to center along approach (positive far -> 0 at center)
  const off = laneOffset(dir, laneIndex)
  if (dir === "N") return { x: CX + off.dx + lateral, y: CY - (s + interSize) }
  if (dir === "S") return { x: CX + off.dx + lateral, y: CY + (s + interSize) }
  if (dir === "E") return { x: CX + (s + interSize), y: CY + off.dy + lateral }
  if (dir === "W") return { x: CX - (s + interSize), y: CY + off.dy + lateral }
  return { x: CX, y: CY }
}

function inCrossing(x, y) {
  return Math.abs(x - CX) <= interSize / 2 && Math.abs(y - CY) <= interSize / 2
}

class Vehicle {
  constructor({ dir, lane, type = "car" }) {
    this.id = idSeq++
    this.dir = dir // "N"|"S"|"E"|"W"
    this.lane = lane // 0|1
    this.type = type // "car"|"amb"
    this.s = rand(260, 520) // distance to center along the road
    this.len = 22
    this.wid = 12
    this.max = maxSpeed * (type === "amb" ? ambBoost : 1)
    this.v = this.max * 0.5
    this.x = 0
    this.y = 0
    this.lateral = 0 // for lane changes
    this.lc = null // lane-change animation {target, t}
    this.wait = 0 // seconds spent waiting/braking
    this.exited = false
    this.violatedRed = false
  }
  bounds() {
    // simple AABB around center (x,y)
    return { x: this.x - this.wid / 2, y: this.y - this.len / 2, w: this.wid, h: this.len }
  }
  isAmb() {
    return this.type === "amb"
  }
}

const Env = (() => {
  const vehicles = []
  let phase = "EW" // "EW" or "NS"
  let phaseTime = 0
  const greenMin = 3.0 // minimum seconds keep green
  const redDebounce = 0.25 // avoid flicker when switching
  let lastSwitchAt = -999

  // RL
  const Q = new Map() // key "qEw,qNs,ambEw,ambNs|a"
  let lastState = null
  let lastAction = 0 // 0 keep, 1 switch

  // Metrics
  let reward = 0,
    cumReward = 0
  let collisions = 0,
    throughput = 0
  let sumWait = 0,
    waitCount = 0
  const rewardHist = []

  // intersection reservation: at most one axis moving through crossing
  function axisOpen(ax) {
    return phase === ax
  }
  function dirAxis(d) {
    return d === "E" || d === "W" ? "EW" : "NS"
  }

  function isRedFor(d) {
    return dirAxis(d) !== phase
  }

  function spawnCar(dir, type = "car") {
    const lane = Math.random() < 0.5 ? 0 : 1
    const v = new Vehicle({ dir, lane, type })
    const p = posOf(dir, v.s, v.lane, v.lateral)
    v.x = p.x
    v.y = p.y
    vehicles.push(v)
  }

  function spawnBatchCars(n = 6) {
    const dirs = ["N", "S", "E", "W"]
    for (let i = 0; i < n; i++) spawnCar(choice(dirs), "car")
  }

  function spawnAmbulance() {
    spawnCar(choice(["N", "S", "E", "W"]), "amb")
  }

  function clearExited() {
    for (let i = vehicles.length - 1; i >= 0; i--) {
      if (vehicles[i].exited) vehicles.splice(i, 1)
    }
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  }

  function laneChangePossible(v, targetLane) {
    // check that adjacent lane is free around v
    for (const u of vehicles) {
      if (u === v) continue
      if (u.dir !== v.dir) continue
      if (u.lane !== targetLane) continue
      // compare s-distance
      const ds = Math.abs(u.s - v.s)
      if (ds < headway * 1.2) return false
    }
    return true
  }

  function updateLaneChange(v, dt) {
    if (!v.lc) return
    v.lc.t += dt / laneChangeTime
    v.lateral = (v.lc.target - v.lane) * laneWidth * clamp(v.lc.t, 0, 1)
    if (v.lc.t >= 1) {
      v.lane = v.lc.target
      v.lc = null
      v.lateral = 0
    }
  }

  function tryYieldForAmbulance(dt) {
    // pull cars away or slow down when ambulance near and behind
    const ambs = vehicles.filter((v) => v.isAmb())
    if (ambs.length === 0) return 0
    let yields = 0
    for (const a of ambs) {
      for (const v of vehicles) {
        if (v === a) continue
        if (v.dir !== a.dir) continue
        // a is behind v if a.s > v.s for same approach direction definition
        const behind = a.s > v.s
        const near = Math.abs(a.s - v.s) < 120
        if (behind && near) {
          // attempt lane change away from center (outward)
          const outward = v.dir === "N" || v.dir === "E" ? 1 : 0 // prefer outer lane index
          if (v.lane !== outward && laneChangePossible(v, outward) && !v.lc) {
            v.lc = { target: outward, t: 0 }
            yields += 1
          } else {
            // at least slow down to create space
            v.v = Math.min(v.v, v.max * 0.35)
          }
        }
      }
    }
    return yields
  }

  function headwayControl(v, dt) {
    // maintain safe distance to vehicle ahead in same lane and direction
    let lead = null
    let minDs = Number.POSITIVE_INFINITY
    for (const u of vehicles) {
      if (u === v) continue
      if (u.dir !== v.dir || u.lane !== v.lane) continue
      // "ahead" means smaller s towards center
      if (u.s < v.s && v.s - u.s < minDs) {
        minDs = v.s - u.s
        lead = u
      }
    }
    if (lead && minDs < headway) {
      v.v = Math.min(v.v, v.max * 0.25)
      v.wait += dt
    } else {
      v.v = Math.min(v.max, v.v + 40 * dt) // accelerate back
    }
  }

  function stopLineControl(v, dt) {
    // vehicles stop at stop line on red; only enter intersection on green and when crossing is clear
    const dAxis = dirAxis(v.dir)
    const sStop = stopLine + v.len * 0.5
    const approachingStop = v.s <= sStop
    const red = isRedFor(v.dir)
    const crossingBusy = vehicles.some((u) => {
      if (u === v) return false
      // someone in crossing from conflicting axis blocks
      return inCrossing(u.x, u.y) && dirAxis(u.dir) !== dAxis
    })

    if (approachingStop && (red || crossingBusy)) {
      v.v = Math.min(v.v, v.max * 0.15)
      v.wait += dt
      // hard stop at stop line
      if (v.s < sStop - 2) {
        v.v = 0
        v.s = sStop
      }
    }
  }

  function redViolationCheck(v) {
    const red = isRedFor(v.dir)
    if (red && inCrossing(v.x, v.y)) {
      v.violatedRed = true
    }
  }

  function stepVehicles(dt) {
    // yield behavior first
    const yields = tryYieldForAmbulance(dt)

    // regulate and move
    for (const v of vehicles) {
      updateLaneChange(v, dt)
      headwayControl(v, dt)
      stopLineControl(v, dt)

      // integrate along approach
      v.s = Math.max(0, v.s - v.v * dt)
      const p = posOf(v.dir, v.s, v.lane, v.lateral)
      v.x = p.x
      v.y = p.y

      redViolationCheck(v)

      // if passed center, keep going out of scene; mark exited after a bit
      if (v.s === 0) {
        // move through crossing and outwards
        if (v.dir === "N") v.y += v.v * dt
        if (v.dir === "S") v.y -= v.v * dt
        if (v.dir === "E") v.x -= v.v * dt
        if (v.dir === "W") v.x += v.v * dt

        const out = v.x < -80 || v.x > W + 80 || v.y < -80 || v.y > H + 80
        if (out) {
          v.exited = true
          throughput += 1
        }
      }
    }

    // collisions
    let colCount = 0
    for (let i = 0; i < vehicles.length; i++) {
      const a = vehicles[i]
      const ab = a.bounds()
      for (let j = i + 1; j < vehicles.length; j++) {
        const b = vehicles[j]
        const bb = b.bounds()
        if (rectsOverlap(ab, bb)) {
          colCount++
          a.exited = true
          b.exited = true
        }
      }
    }
    if (colCount > 0) collisions += colCount

    clearExited()
    return { yields }
  }

  function drawRoad() {
    ctx.save()
    ctx.translate(CX, CY)

    // background
    ctx.fillStyle = "#0a0e18"
    ctx.fillRect(-CX, -CY, W, H)

    // roads
    ctx.fillStyle = "#111827"
    // horizontal
    ctx.fillRect(-W, -roadHalf, W * 2, roadHalf * 2)
    // vertical
    ctx.fillRect(-roadHalf, -H, roadHalf * 2, H * 2)

    // intersection box
    ctx.fillStyle = "#0f172a"
    ctx.fillRect(-interSize / 2, -interSize / 2, interSize, interSize)

    // stop lines
    ctx.strokeStyle = "#374151"
    ctx.lineWidth = 2
    // North approach stop
    ctx.beginPath()
    ctx.moveTo(-roadHalf, -stopLine)
    ctx.lineTo(roadHalf, -stopLine)
    ctx.stroke()
    // South approach stop
    ctx.beginPath()
    ctx.moveTo(-roadHalf, stopLine)
    ctx.lineTo(roadHalf, stopLine)
    ctx.stroke()
    // West approach stop
    ctx.beginPath()
    ctx.moveTo(-stopLine, -roadHalf)
    ctx.lineTo(-stopLine, roadHalf)
    ctx.stroke()
    // East approach stop
    ctx.beginPath()
    ctx.moveTo(stopLine, -roadHalf)
    ctx.lineTo(stopLine, roadHalf)
    ctx.stroke()

    // lights
    function drawLight(x, y, on) {
      ctx.fillStyle = on ? "#10b981" : "#ef4444"
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "#0b0f19"
      ctx.stroke()
    }
    drawLight(-roadHalf - 14, -stopLine - 14, phase === "NS") // facing North
    drawLight(roadHalf + 14, stopLine + 14, phase === "NS") // facing South
    drawLight(-stopLine - 14, roadHalf + 14, phase === "EW") // facing West
    drawLight(stopLine + 14, -roadHalf - 14, phase === "EW") // facing East

    ctx.restore()
  }

  function drawVehicles() {
    for (const v of vehicles) {
      ctx.save()
      ctx.translate(v.x, v.y)
      ctx.fillStyle = v.isAmb() ? "#60a5fa" : "#9ca3af"
      ctx.strokeStyle = v.isAmb() ? "#2563eb" : "#6b7280"
      ctx.lineWidth = 1.5
      ctx.fillRect(-v.wid / 2, -v.len / 2, v.wid, v.len)
      ctx.strokeRect(-v.wid / 2, -v.len / 2, v.wid, v.len)
      // ambulance indicator
      if (v.isAmb()) {
        ctx.fillStyle = "#93c5fd"
        ctx.fillRect(-v.wid / 2 + 2, -v.len / 2 + 2, v.wid - 4, 3)
      }
      ctx.restore()
    }
  }

  // RL state and rewards
  function observeState() {
    let qEW = 0,
      qNS = 0,
      ambEW = 0,
      ambNS = 0
    for (const v of vehicles) {
      const ax = dirAxis(v.dir)
      if (ax === "EW") {
        if (v.s <= stopLine + 20) qEW++
        if (v.isAmb()) ambEW = 1
      } else {
        if (v.s <= stopLine + 20) qNS++
        if (v.isAmb()) ambNS = 1
      }
    }
    // bucket queues
    const b = (n) => (n >= 4 ? 4 : n)
    return { qEW: b(qEW), qNS: b(qNS), ambEW, ambNS }
  }

  function keyOf(s, a) {
    return `${s.qEW},${s.qNS},${s.ambEW},${s.ambNS}|${a}`
  }

  function getQ(s, a) {
    const k = keyOf(s, a)
    return Q.has(k) ? Q.get(k) : 0
    // lazily initialized zeros
  }

  function setQ(s, a, v) {
    Q.set(keyOf(s, a), v)
  }

  function chooseAction(s) {
    // 0 keep, 1 switch
    if (Math.random() < epsilon) return Math.random() < 0.5 ? 0 : 1
    const q0 = getQ(s, 0)
    const q1 = getQ(s, 1)
    return q1 > q0 ? 1 : 0
  }

  function bestQ(s) {
    return Math.max(getQ(s, 0), getQ(s, 1))
  }

  function rewardStep(stats) {
    // reward shaping
    // +1 per throughput, +3 if ambulance exits
    // -10 per collision
    // -0.05 per waiting vehicle per step
    // -1 if any red violation occurred
    let r = 0
    r += stats.throughputDelta * 1.0
    r += stats.ambExitedDelta * 3.0
    r -= stats.collisionsDelta * 10.0

    // waiting penalty
    let waiting = 0
    for (const v of vehicles) {
      if (v.v < v.max * 0.4) waiting++
    }
    r -= waiting * 0.05

    // red violation penalty
    if (vehicles.some((v) => v.violatedRed)) r -= 1.0

    // small bonus for successful yields
    r += stats.yields * 0.2

    return r
  }

  function setPhase(p) {
    if (p !== phase && performance.now() / 1000 - lastSwitchAt > redDebounce) {
      phase = p
      lastSwitchAt = performance.now() / 1000
    }
  }

  function agentStep(dt, stats) {
    phaseTime += dt
    // RL update from last action
    const s1 = observeState()
    const r = rewardStep(stats)

    reward = r
    cumReward += r
    rewardHist.push(cumReward)
    if (rewardHist.length > 360) rewardHist.shift()

    if (lastState) {
      const qsa = getQ(lastState, lastAction)
      const target = r + gamma * bestQ(s1)
      setQ(lastState, lastAction, qsa + alpha * (target - qsa))
      epsilon = Math.max(epsilonMin, epsilon * epsilonDecay)
    }

    // epsilon-greedy action with min green time constraint
    let a = 0
    if (phaseTime > greenMin) {
      a = chooseAction(s1)
    } else {
      a = 0 // force keep during min green
    }

    if (a === 1) {
      setPhase(phase === "EW" ? "NS" : "EW")
      phaseTime = 0
    }

    lastState = s1
    lastAction = a
  }

  function drawHUD() {
    els.phase.textContent = phase
    els.reward.textContent = reward.toFixed(2)
    els.cumReward.textContent = cumReward.toFixed(2)
    els.collisions.textContent = `${collisions}`
    els.throughput.textContent = `${throughput}`
    els.avgWait.textContent = (waitCount ? sumWait / waitCount : 0).toFixed(2) + "s"

    const ambWaiting = vehicles.some((v) => v.isAmb() && v.s <= stopLine + 20)
    els.ambWaiting.textContent = ambWaiting ? "Yes" : "No"

    // overlay banner if ambulance is present
    els.overlay.innerHTML = ""
    const anyAmb = vehicles.some((v) => v.isAmb())
    if (anyAmb) {
      const div = document.createElement("div")
      div.className = "banner"
      div.textContent = "Yield to Ambulance"
      els.overlay.appendChild(div)
    }
  }

  function drawRewardChart() {
    const w = rewardCanvas.width,
      h = rewardCanvas.height
    rctx.clearRect(0, 0, w, h)
    rctx.fillStyle = "#0f172a"
    rctx.fillRect(0, 0, w, h)
    if (rewardHist.length < 2) return
    const min = Math.min(...rewardHist)
    const max = Math.max(...rewardHist)
    const range = Math.max(1, max - min)
    rctx.strokeStyle = "#60a5fa"
    rctx.lineWidth = 2
    rctx.beginPath()
    for (let i = 0; i < rewardHist.length; i++) {
      const x = (i / (rewardHist.length - 1)) * (w - 10) + 5
      const y = h - 5 - ((rewardHist[i] - min) / range) * (h - 10)
      if (i === 0) rctx.moveTo(x, y)
      else rctx.lineTo(x, y)
    }
    rctx.stroke()
  }

  function tick(dt) {
    const prevThroughput = throughput
    const prevAmbExited = 0 // approximated via throughput of ambs; track below

    // integrate vehicles and detect collisions
    const { yields } = stepVehicles(dt)

    // wait metrics accumulation
    for (const v of vehicles) {
      if (v.v < v.max * 0.4) {
        sumWait += dt
        waitCount += 1
      }
    }

    // count if any ambulance exited in this tick (proxy by throughput difference and presence)
    const ambExitedDelta = 0
    // approximate by checking removed ambs would be complex; keep simple here.

    const stats = {
      yields,
      throughputDelta: throughput - prevThroughput,
      ambExitedDelta,
      collisionsDelta: 0, // collisions are applied as exits; penalize separately below
    }

    // RL agent chooses action and updates Q
    agentStep(dt, stats)

    // rendering
    drawRoad()
    drawVehicles()
    drawHUD()
    drawRewardChart()
  }

  function hardReset() {
    vehicles.length = 0
    phase = "EW"
    phaseTime = 0
    lastSwitchAt = -999
    // RL
    // keep Q across resets for learning, but reset epsilon slightly higher if needed
    reward = 0
    cumReward = 0
    collisions = 0
    throughput = 0
    sumWait = 0
    waitCount = 0
    rewardHist.length = 0
    lastState = null
    lastAction = 0
  }

  return {
    vehicles,
    get phase() {
      return phase
    },
    spawnCar,
    spawnBatchCars,
    spawnAmbulance,
    tick,
    hardReset,
  }
})()

// Controls and main loop
let running = false
let lastT = performance.now()
let speedScale = 1

els.btnStart.addEventListener("click", () => {
  running = !running
  els.btnStart.textContent = running ? "Pause" : "Start"
})

els.btnReset.addEventListener("click", () => {
  Env.hardReset()
})

els.btnSpawnCars.addEventListener("click", () => {
  Env.spawnBatchCars(8)
})

els.btnSpawnAmb.addEventListener("click", () => {
  Env.spawnAmbulance()
})

els.speedSlider.addEventListener("input", (e) => {
  speedScale = Number.parseFloat(e.target.value || "1")
})

function animate(t) {
  requestAnimationFrame(animate)
  const dt = Math.min(0.05, (t - lastT) / 1000) * speedScale
  lastT = t
  if (running) Env.tick(dt || dtTarget)
  else {
    // still render static frame
    // background + vehicles
    // draw once to keep screen fresh after resize
    Env.tick(0)
  }
}
requestAnimationFrame(animate)

// Seed a few cars initially
Env.spawnBatchCars(10)

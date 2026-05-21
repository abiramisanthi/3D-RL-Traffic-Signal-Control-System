# Note: This is a lightweight, dependency-minimal environment that approximates
# the same state, action, and reward logic used in the browser simulation.
# You can run this file directly to see a tiny Q-learning agent learn.

import math
import random
from collections import defaultdict

# Optional: uncomment if numpy is available for faster Q ops
# import numpy as np

DIRECTIONS = ["N", "S", "E", "W"]

class Vehicle:
    def __init__(self, dir, kind="car"):
        self.dir = dir
        self.kind = kind  # "car" | "amb"
        self.s = random.uniform(260, 520)  # distance to center
        self.v = 40.0 if kind == "car" else 50.0
        self.max = self.v
        self.wait = 0.0
        self.lane = random.choice([0,1])
        self.exited = False
        self.red_violation = False

class RLEnv:
    def __init__(self):
        self.vehicles = []
        self.phase = "EW"  # "EW" or "NS"
        self.phase_time = 0.0
        self.green_min = 3.0

        self.throughput = 0
        self.collisions = 0
        self.t = 0.0

    def reset(self):
        self.vehicles = [Vehicle(random.choice(DIRECTIONS), "car") for _ in range(8)]
        self.phase = "EW"
        self.phase_time = 0.0
        self.throughput = 0
        self.collisions = 0
        self.t = 0.0
        return self.observe()

    def observe(self):
        # state: queue sizes near stop line per axis and ambulance flags
        qEW = 0; qNS = 0; ambEW = 0; ambNS = 0
        for v in self.vehicles:
            ax = "EW" if v.dir in ["E","W"] else "NS"
            if v.s <= 80:  # near stop line
                if ax == "EW": qEW += 1
                else: qNS += 1
            if v.kind == "amb":
                if ax == "EW": ambEW = 1
                else: ambNS = 1
        qEW = min(qEW, 4); qNS = min(qNS, 4)
        return (qEW, qNS, ambEW, ambNS)

    def is_red_for(self, d):
        return (("EW" if d in ["E", "W"] else "NS") != self.phase)

    def step(self, action, dt=0.1):
        # action: 0 keep, 1 switch (enforce min green)
        self.phase_time += dt
        if action == 1 and self.phase_time > self.green_min:
            self.phase = "NS" if self.phase == "EW" else "EW"
            self.phase_time = 0.0

        # integrate vehicles with simple stop-line logic and headway
        prev_throughput = self.throughput
        for v in self.vehicles:
            # stop at stop line if red
            red = self.is_red_for(v.dir)
            s_stop = 80
            if v.s <= s_stop and red:
                v.v = min(v.v, v.max * 0.15)
                if v.s < s_stop - 2:  # hard stop
                    v.v = 0
                    v.s = s_stop
                v.wait += dt
            else:
                # accelerate towards max
                v.v = min(v.max, v.v + 20 * dt)

            v.s = max(0, v.s - v.v * dt)
            # simple exit
            if v.s == 0 and random.random() < 0.6:
                v.exited = True
                self.throughput += 1

        # collisions: very simplified proxy (rare with these rules)
        # if both axes inside crossing, count as conflicts
        ew_in = any(v.s == 0 and v.dir in ["E","W"] for v in self.vehicles)
        ns_in = any(v.s == 0 and v.dir in ["N","S"] for v in self.vehicles)
        if ew_in and ns_in:
            self.collisions += 1
            for v in self.vehicles:
                if v.s == 0:
                    v.exited = True  # remove conflicted

        # cleanup
        self.vehicles = [v for v in self.vehicles if not v.exited]

        # reward
        throughput_delta = self.throughput - prev_throughput
        waiting = sum(1 for v in self.vehicles if v.v < v.max * 0.4)
        r = 0.0
        r += throughput_delta * 1.0
        r -= self.collisions * 10.0
        r -= waiting * 0.05
        # ambulance bonus if exiting
        # (approximate: bonus when any ambulance present and throughput increased)
        if any(v.kind == "amb" for v in self.vehicles) and throughput_delta > 0:
            r += 3.0

        self.t += dt
        return self.observe(), r, False, {
            "phase": self.phase,
            "throughput": self.throughput,
            "collisions": self.collisions,
        }

# Tiny Q-learning
def q_learning(episodes=50, steps=400):
    env = RLEnv()
    Q = defaultdict(float)
    alpha, gamma = 0.12, 0.94
    epsilon, epsilon_min, epsilon_decay = 0.35, 0.05, 0.9995

    def bestQ(s):
        return max(Q[(s,0)], Q[(s,1)])

    for ep in range(episodes):
        s = env.reset()
        total = 0.0
        for k in range(steps):
            a = 0 if (random.random() > epsilon and Q[(s,0)] >= Q[(s,1)]) else random.choice([0,1])
            s1, r, done, info = env.step(a, dt=0.1)
            total += r
            target = r + gamma * bestQ(s1)
            Q[(s,a)] += alpha * (target - Q[(s,a)])
            s = s1
            epsilon = max(epsilon_min, epsilon * epsilon_decay)
        print(f"Episode {ep+1:02d} | reward={total:.2f} throughput={env.throughput} collisions={env.collisions}")
    return Q

if __name__ == "__main__":
    q_learning()

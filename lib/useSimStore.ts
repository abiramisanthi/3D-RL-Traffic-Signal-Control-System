import { create } from 'zustand';

type SimState = {
  cumulativeReward: number;
  clearedCount: number;
  totalWaiting: number;
  collisions: number;
  rewardHistory: number[];
  waitingHistory: number[];
  addData: (reward: number, waiting: number) => void;
  reset: () => void;
};

export const useSimStore = create<SimState>((set, get) => ({
  cumulativeReward: 0,
  clearedCount: 0,
  totalWaiting: 0,
  collisions: 0,
  rewardHistory: [],
  waitingHistory: [],
  addData: (reward, waiting) =>
    set((state) => ({
      rewardHistory: [...state.rewardHistory.slice(-99), reward],
      waitingHistory: [...state.waitingHistory.slice(-99), waiting],
    })),
  reset: () =>
    set({
      cumulativeReward: 0,
      clearedCount: 0,
      totalWaiting: 0,
      collisions: 0,
      rewardHistory: [],
      waitingHistory: [],
    }),
}));
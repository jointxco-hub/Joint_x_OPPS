import { differenceInDays, addWeeks, startOfDay } from 'date-fns';

export const CYCLE_LENGTH_DAYS = 84;

export function getWeekNumber(cycleStart, today = new Date()) {
  const start = startOfDay(new Date(cycleStart));
  const now = startOfDay(today);
  const diff = differenceInDays(now, start);
  if (diff < 0) return 0;
  return Math.min(Math.floor(diff / 7) + 1, 12);
}

export const getCycleEnd = (start) => addWeeks(new Date(start), 12);

export const getDaysRemaining = (start, today = new Date()) => {
  const end = getCycleEnd(start);
  const diff = differenceInDays(startOfDay(end), startOfDay(today));
  return Math.max(0, diff);
};

export function calculateExecutionScore(tasks) {
  if (!tasks || tasks.length === 0) return 0;
  const done = tasks.filter(t => t.status === 'complete').length;
  return Math.round((done / tasks.length) * 100);
}

export const scoreColor = (s) =>
  s >= 85 ? 'green' : s >= 70 ? 'amber' : 'red';

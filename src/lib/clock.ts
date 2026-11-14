export const MAIN_MS = 10 * 60 * 1000;
export const PERIOD_MS = 30 * 1000;
export const PERIODS = 3;

export interface ClockSide {
  mainMs: number;
  periods: number;
}

export interface Charge extends ClockSide {
  timedOut: boolean;
  periodLeftMs: number | null;
}

export function charge(side: ClockSide, elapsedMs: number): Charge {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < side.mainMs) {
    return {
      mainMs: side.mainMs - elapsed,
      periods: side.periods,
      timedOut: false,
      periodLeftMs: null,
    };
  }
  let overtime = elapsed - side.mainMs;
  let periods = side.periods;
  while (periods > 0 && overtime >= PERIOD_MS) {
    overtime -= PERIOD_MS;
    periods -= 1;
  }
  if (periods === 0) {
    return { mainMs: 0, periods: 0, timedOut: true, periodLeftMs: 0 };
  }
  return { mainMs: 0, periods, timedOut: false, periodLeftMs: PERIOD_MS - overtime };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

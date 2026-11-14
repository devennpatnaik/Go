import { describe, expect, it } from "vitest";
import { MAIN_MS, PERIOD_MS, PERIODS, charge, formatClock } from "./clock";

describe("clock", () => {
  const fresh = { mainMs: MAIN_MS, periods: PERIODS };

  it("spends main time first", () => {
    const charged = charge(fresh, 90_000);
    expect(charged.timedOut).toBe(false);
    expect(charged.mainMs).toBe(MAIN_MS - 90_000);
    expect(charged.periods).toBe(3);
    expect(charged.periodLeftMs).toBeNull();
  });

  it("enters a byo-yomi period without consuming it", () => {
    const charged = charge(fresh, MAIN_MS + 12_000);
    expect(charged.timedOut).toBe(false);
    expect(charged.mainMs).toBe(0);
    expect(charged.periods).toBe(3);
    expect(charged.periodLeftMs).toBe(PERIOD_MS - 12_000);
  });

  it("consumes a period only when it expires", () => {
    const charged = charge(fresh, MAIN_MS + PERIOD_MS + 1_000);
    expect(charged.periods).toBe(2);
    expect(charged.periodLeftMs).toBe(PERIOD_MS - 1_000);
  });

  it("times out after the last period", () => {
    const charged = charge(fresh, MAIN_MS + PERIOD_MS * 3);
    expect(charged.timedOut).toBe(true);
    expect(charged.periods).toBe(0);
  });

  it("formats a minute", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(0)).toBe("0:00");
  });
});

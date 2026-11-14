import { describe, expect, it } from "vitest";
import { BEGINNER_GOR, GNU_GO_LEVEL_10_GOR, bonus, con, expected, updateRating } from "./rating";

describe("EGF GoR", () => {
  it("starts a new player at the 30 kyu floor", () => {
    expect(BEGINNER_GOR).toBe(-900);
    expect(GNU_GO_LEVEL_10_GOR).toBe(1300);
  });

  it("uses the published 2021 update", () => {
    const rating = BEGINNER_GOR;
    const opponent = GNU_GO_LEVEL_10_GOR;
    const next = updateRating(rating, opponent, 0);
    const byHand = rating + con(rating) * (0 - expected(rating, opponent)) + bonus(rating);
    expect(next).toBeCloseTo(byHand, 8);
    expect(next).toBeGreaterThan(rating);
    expect(updateRating(rating, opponent, 1)).toBeGreaterThan(next + 50);
  });

  it("does not drop below the floor", () => {
    expect(updateRating(-900, 2900, 0)).toBeGreaterThanOrEqual(-900);
  });
});

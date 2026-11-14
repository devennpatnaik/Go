import { describe, expect, it } from "vitest";
import { fromGtp, gnugoFinalScore, gnugoMove, gnugoReport, toGtp, winnerFromScore } from "./engine";
import { place, createGame } from "./rules";

describe("gtp coordinates", () => {
  it("maps the top-left of a 9×9 board to A9", () => {
    expect(toGtp(0, 0, 9)).toBe("A9");
    expect(fromGtp("A9", 9)).toEqual({ kind: "play", x: 0, y: 0 });
  });

  it("skips the letter I", () => {
    expect(toGtp(8, 4, 9)).toBe("J5");
    expect(fromGtp("I5", 9)).toBeNull();
  });

  it("reads pass and resign", () => {
    expect(fromGtp("pass", 9)).toEqual({ kind: "pass" });
    expect(fromGtp("resign", 9)).toEqual({ kind: "resign" });
  });
});

describe("GNU Go", () => {
  it("proposes a legal reply on 9×9", async () => {
    const reply = await gnugoMove({
      size: 9,
      color: "white",
      moves: [{ color: "black", kind: "play", x: 2, y: 2 }],
    });
    expect(["play", "pass", "resign"]).toContain(reply.kind);
    if (reply.kind !== "play") return;
    let state = createGame(9);
    const black = place(state, 2, 2);
    if (!black.ok) throw new Error(black.reason);
    state = black.state;
    const white = place(state, reply.x, reply.y);
    expect(white.ok).toBe(true);
  });

  it("returns a real final score and a suggestion", async () => {
    const score = await gnugoFinalScore({
      size: 9,
      moves: [
        { color: "black", kind: "pass", x: null, y: null },
        { color: "white", kind: "pass", x: null, y: null },
      ],
    });
    expect(winnerFromScore(score)).not.toBeNull();
    const report = await gnugoReport({
      size: 9,
      color: "black",
      moves: [{ color: "black", kind: "play", x: 2, y: 2 }],
    });
    expect(report.score.length).toBeGreaterThan(0);
    expect(["play", "pass", "resign"]).toContain(report.suggestion.kind);
  });
});
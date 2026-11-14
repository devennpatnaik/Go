import { describe, expect, it } from "vitest";
import { fromGtp } from "./gtp";
import {
  choicesDiffer,
  describeMove,
  openingPly,
  pushReview,
  reviewCommands,
  reviewStart,
  type ReviewMove,
  type ReviewPoint,
} from "./review";

const moves: ReviewMove[] = [
  { color: "black", kind: "play", x: 0, y: 8 },
  { color: "white", kind: "pass", x: null, y: null },
  { color: "black", kind: "resign", x: null, y: null },
];

describe("review script", () => {
  it("asks for the best move before each play and does not play a resignation", () => {
    expect(reviewCommands(9, moves, "white")).toEqual([
      "boardsize 9",
      "clear_board",
      "komi 7.5",
      "reg_genmove black",
      "play black A1",
      "reg_genmove white",
      "play white pass",
      "reg_genmove black",
      "estimate_score",
      "reg_genmove white",
      "quit",
    ]);
  });

  it("pairs each reply with the position before that move", () => {
    const replies = ["", "", "", "E5", "", "pass", "", "C3", "W+12.5 (upper bound: 12.5, lower: 12.5)", "C3"];
    let cursor = reviewStart();
    const points = [];
    let score = "";
    let suggestion = null;
    for (const reply of replies) {
      const step = pushReview(cursor, reply, moves, 9);
      cursor = step.cursor;
      if (step.best) points.push(step.best);
      if (step.score) score = step.score;
      if (step.suggestion) suggestion = step.suggestion;
    }
    expect(cursor.phase).toBe("end");
    expect(points[0]).toEqual(fromGtp("E5", 9));
    expect(points[1]).toEqual({ kind: "pass" });
    expect(points[2]).toEqual(fromGtp("C3", 9));
    expect(score.startsWith("W+")).toBe(true);
    expect(suggestion).toEqual(fromGtp("C3", 9));
  });
});

describe("played beside best", () => {
  const play = describeMove({ color: "black", kind: "play", x: 0, y: 8 }, 9);
  const other = describeMove({ color: "black", kind: "play", x: 4, y: 4 }, 9);
  const pass = describeMove({ color: "white", kind: "pass", x: null, y: null }, 9);

  it("treats the same point as the move that was played", () => {
    expect(choicesDiffer(play, play)).toBe(false);
    expect(choicesDiffer(pass, pass)).toBe(false);
    expect(choicesDiffer(play, other)).toBe(true);
    expect(choicesDiffer(play, pass)).toBe(true);
  });

  it("opens on the latest stone that differs from GNU Go", () => {
    const same: ReviewPoint = { played: play, best: play };
    const differ: ReviewPoint = { played: play, best: other };
    const resigned: ReviewPoint = {
      played: describeMove({ color: "black", kind: "resign", x: null, y: null }, 9),
      best: other,
    };
    expect(openingPly([differ, same, differ, resigned])).toBe(3);
    expect(openingPly([same, resigned])).toBe(2);
  });
});

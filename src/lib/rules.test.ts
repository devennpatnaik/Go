import { describe, expect, it } from "vitest";
import { openingFrames } from "./opening";
import { createGame, pass, place, replay, resign } from "./rules";

describe("rules", () => {
  it("captures a stone in the corner", () => {
    let state = createGame(9);
    state = must(place(state, 0, 1));
    state = must(place(state, 0, 0));
    state = must(place(state, 1, 0));
    expect(state.board[0][0]).toBeNull();
    expect(state.prisoners.black).toBe(1);
  });

  it("refuses suicide that captures nothing", () => {
    let state = createGame(9);
    state = must(place(state, 8, 8));
    state = must(place(state, 1, 0));
    state = must(place(state, 8, 7));
    state = must(place(state, 0, 1));
    const blocked = place(state, 0, 0);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("suicide");
  });

  it("forbids immediate ko and allows it after a move elsewhere", () => {
    let state = createGame(9);
    for (const [x, y] of [
      [8, 8],
      [1, 1],
      [0, 1],
      [2, 0],
      [1, 0],
      [2, 2],
      [1, 2],
      [3, 1],
      [2, 1],
    ] as const) {
      state = must(place(state, x, y));
    }
    const ko = place(state, 1, 1);
    expect(ko.ok).toBe(false);
    if (!ko.ok) expect(ko.reason).toBe("ko");
    state = must(place(state, 8, 7));
    state = must(place(state, 8, 6));
    state = must(place(state, 1, 1));
    expect(state.board[1][2]).toBeNull();
    expect(state.board[1][1]).toBe("white");
    expect(state.prisoners.white).toBe(1);
  });

  it("keeps the game in play after two passes", () => {
    let state = createGame(9);
    state = must(pass(state));
    state = must(pass(state));
    expect(state.phase).toBe("play");
    expect(state.consecutivePasses).toBe(2);
    expect(state.toPlay).toBe("black");
  });

  it("resigns the side to play", () => {
    const state = resign(createGame(9));
    expect(state.phase).toBe("resigned");
    expect(state.resigned).toBe("black");
  });

  it("replays the stored list, including a capture", () => {
    const state = replay(9, [
      { color: "black", kind: "play", x: 0, y: 1 },
      { color: "white", kind: "play", x: 0, y: 0 },
      { color: "black", kind: "play", x: 1, y: 0 },
    ]);
    expect(state.board[0][0]).toBeNull();
    expect(state.prisoners.black).toBe(1);
    expect(state.toPlay).toBe("white");
  });

  it("opens with Shusaku's first stone at q16", () => {
    const frames = openingFrames();
    expect(frames).toHaveLength(19);
    expect(frames[1].board[3][16]).toBe("black");
    expect(frames[2].board[2][3]).toBe("white");
  });
});

function must(result: ReturnType<typeof place>) {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

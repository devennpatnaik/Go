import { beforeAll, describe, expect, it } from "vitest";
import { MAIN_MS, PERIOD_MS } from "./clock";
import { sql } from "./db";
import { answerEngine, createGame, playMove, readGame, takeSeat } from "./play";
import { replay } from "./rules";

const black = "user:1";
const white = "user:2";
const stage = "production";

beforeAll(async () => {
  await sql("delete from rating_events");
  await sql("delete from moves");
  await sql("delete from games");
});

async function started(size = 9) {
  const created = await createGame({ sub: black, stage, size, color: "black" });
  if (!created.ok) throw new Error(created.error);
  const sat = await takeSeat({ sub: white, stage, id: created.game.id, now: new Date("2026-01-01T00:00:00Z") });
  if (!sat.ok) throw new Error(sat.error);
  return sat.game;
}

describe("games", () => {
  it("keeps the second seat empty until a different person sits", async () => {
    const created = await createGame({ sub: black, stage, size: 13, color: "white" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.game.you).toBe("white");
    expect(created.game.phase).toBe("waiting");
    expect(created.game.clock.running).toBe(false);
    const same = await takeSeat({ sub: black, stage, id: created.game.id });
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.game.phase).toBe("waiting");
    expect(same.game.blackSeated).toBe(false);
    const other = await takeSeat({
      sub: white,
      stage,
      id: created.game.id,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.game.phase).toBe("play");
    expect(other.game.toPlay).toBe("black");
    expect(other.game.clock.running).toBe(true);
    expect(other.game.you).toBe("black");
  });

  it("hides a game from the other stage", async () => {
    const created = await createGame({ sub: black, stage, size: 9, color: "black" });
    if (!created.ok) throw new Error(created.error);
    const hidden = await readGame({ sub: white, stage: "preview", id: created.game.id });
    expect(hidden.ok).toBe(false);
  });

  it("rejects a move before the second seat and from the other color", async () => {
    const created = await createGame({ sub: black, stage, size: 9, color: "black" });
    if (!created.ok) throw new Error(created.error);
    const early = await playMove({
      sub: black,
      stage,
      id: created.game.id,
      intent: { kind: "play", x: 2, y: 2 },
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error).toBe("waiting");
    const game = await started();
    const stranger = await playMove({
      sub: "user:9",
      stage,
      id: game.id,
      intent: { kind: "play", x: 2, y: 2 },
      now: new Date("2026-01-01T00:00:10Z"),
    });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error).toBe("not_a_player");
    const whiteFirst = await playMove({
      sub: white,
      stage,
      id: game.id,
      intent: { kind: "play", x: 2, y: 2 },
      now: new Date("2026-01-01T00:00:10Z"),
    });
    expect(whiteFirst.ok).toBe(false);
    if (!whiteFirst.ok) expect(whiteFirst.error).toBe("not_your_turn");
  });

  it("captures, then forbids the immediate ko recapture", async () => {
    const game = await started();
    const t = (seconds: number) => new Date(Date.parse("2026-01-01T00:00:00Z") + seconds * 1000);
    const steps: { sub: string; x: number; y: number; at: number }[] = [
      { sub: black, x: 8, y: 8, at: 1 },
      { sub: white, x: 1, y: 1, at: 2 },
      { sub: black, x: 0, y: 1, at: 3 },
      { sub: white, x: 2, y: 0, at: 4 },
      { sub: black, x: 1, y: 0, at: 5 },
      { sub: white, x: 2, y: 2, at: 6 },
      { sub: black, x: 1, y: 2, at: 7 },
      { sub: white, x: 3, y: 1, at: 8 },
      { sub: black, x: 2, y: 1, at: 9 },
    ];
    let current = game;
    for (const step of steps) {
      const played = await playMove({
        sub: step.sub,
        stage,
        id: game.id,
        intent: { kind: "play", x: step.x, y: step.y },
        now: t(step.at),
      });
      expect(played.ok).toBe(true);
      if (played.ok) current = played.game;
    }
    const ko = await playMove({
      sub: white,
      stage,
      id: game.id,
      intent: { kind: "play", x: 1, y: 1 },
      now: t(10),
    });
    expect(ko.ok).toBe(false);
    if (!ko.ok) expect(ko.error).toBe("ko");
    const board = replay(current.size, current.moves);
    expect(board.board[1][1]).toBeNull();
    expect(board.prisoners.black).toBe(1);
    const read = await readGame({ sub: black, stage, id: game.id, now: t(11) });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.game.moves).toHaveLength(9);
  });

  it("records pass and resign", async () => {
    const game = await started();
    const passed = await playMove({
      sub: black,
      stage,
      id: game.id,
      intent: { kind: "pass" },
      now: new Date("2026-01-01T00:01:00Z"),
    });
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.game.toPlay).toBe("white");
    expect(passed.game.phase).toBe("play");
    const resigned = await playMove({
      sub: white,
      stage,
      id: game.id,
      intent: { kind: "resign" },
      now: new Date("2026-01-01T00:02:00Z"),
    });
    expect(resigned.ok).toBe(true);
    if (!resigned.ok) return;
    expect(resigned.game.phase).toBe("done");
    expect(resigned.game.winner).toBe("black");
    expect(resigned.game.resultReason).toBe("resign");
  });

  it("loses on time when the game is read after the periods expire", async () => {
    const game = await started();
    const late = new Date(Date.parse("2026-01-01T00:00:00Z") + MAIN_MS + PERIOD_MS * 3);
    const read = await readGame({ sub: white, stage, id: game.id, now: late });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.game.phase).toBe("done");
    expect(read.game.winner).toBe("white");
    expect(read.game.resultReason).toBe("timeout");
    const lateMove = await playMove({
      sub: black,
      stage,
      id: game.id,
      intent: { kind: "play", x: 4, y: 4 },
      now: new Date(late.getTime() + 1000),
    });
    expect(lateMove.ok).toBe(false);
    if (!lateMove.ok) expect(lateMove.error).toBe("timeout");
  });

  it("starts an empty game against GNU Go and refuses the other human seat", async () => {
    const t0 = new Date("2026-03-01T00:00:00Z");
    const created = await createGame({
      sub: black,
      stage,
      size: 9,
      color: "black",
      opponent: "gnugo",
      now: t0,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.game.moves).toHaveLength(0);
    expect(created.game.phase).toBe("play");
    expect(created.game.engine).toBe("GNU Go");
    expect(created.game.engineColor).toBe("white");
    expect(created.game.toPlay).toBe("black");
    expect(created.game.clock.running).toBe(true);
    const intruder = await takeSeat({ sub: white, stage, id: created.game.id, now: t0 });
    expect(intruder.ok).toBe(false);
    if (!intruder.ok) expect(intruder.error).toBe("seat_taken");
  });

  it("plays a legal engine move and drops an illegal one", async () => {
    const t0 = new Date("2026-03-02T00:00:00Z");
    const created = await createGame({
      sub: black,
      stage,
      size: 9,
      color: "black",
      opponent: "gnugo",
      now: t0,
    });
    if (!created.ok) throw new Error(created.error);
    const played = await playMove({
      sub: black,
      stage,
      id: created.game.id,
      intent: { kind: "play", x: 2, y: 2 },
      now: new Date(t0.getTime() + 1000),
    });
    expect(played.ok).toBe(true);
    const illegal = await answerEngine({
      sub: black,
      stage,
      id: created.game.id,
      now: new Date(t0.getTime() + 2000),
      proposer: async () => ({ kind: "play", x: 2, y: 2 }),
    });
    expect(illegal.ok).toBe(true);
    if (!illegal.ok) return;
    expect(illegal.game.moves).toHaveLength(1);
    expect(illegal.game.toPlay).toBe("white");
    const legal = await answerEngine({
      sub: black,
      stage,
      id: created.game.id,
      now: new Date(t0.getTime() + 3000),
      proposer: async () => ({ kind: "play", x: 3, y: 3 }),
    });
    expect(legal.ok).toBe(true);
    if (!legal.ok) return;
    expect(legal.game.moves).toHaveLength(2);
    expect(legal.game.moves[1]).toMatchObject({ color: "white", kind: "play", x: 3, y: 3 });
    expect(legal.game.toPlay).toBe("black");
    const board = replay(9, legal.game.moves);
    expect(board.board[2][2]).toBe("black");
    expect(board.board[3][3]).toBe("white");
  });

  it("ends a GNU Go game on two passes and rates the player once", async () => {
    const sub = "user:rate-pass";
    const t0 = new Date("2026-03-03T00:00:00Z");
    const created = await createGame({
      sub,
      stage,
      size: 9,
      color: "black",
      opponent: "gnugo",
      now: t0,
    });
    if (!created.ok) throw new Error(created.error);
    await playMove({
      sub,
      stage,
      id: created.game.id,
      intent: { kind: "pass" },
      now: new Date(t0.getTime() + 1000),
    });
    const passed = await answerEngine({
      sub,
      stage,
      id: created.game.id,
      now: new Date(t0.getTime() + 2000),
      proposer: async () => ({ kind: "pass" }),
      scorer: async () => "W+4.5",
    });
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.game.phase).toBe("done");
    expect(passed.game.resultReason).toBe("score");
    expect(passed.game.winner).toBe("white");
    expect(passed.game.scoreText).toBe("W+4.5");
    expect(passed.game.ratingBefore).toBe(-900);
    expect(passed.game.ratingAfter).toBeGreaterThan(-900);
    const again = await readGame({ sub, stage, id: created.game.id });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.game.ratingAfter).toBe(passed.game.ratingAfter);
  });

  it("rates a resignation once from the beginner rating", async () => {
    const sub = "user:rate-resign";
    const t0 = new Date("2026-03-04T00:00:00Z");
    const created = await createGame({
      sub,
      stage,
      size: 9,
      color: "black",
      opponent: "gnugo",
      now: t0,
    });
    if (!created.ok) throw new Error(created.error);
    const resigned = await playMove({
      sub,
      stage,
      id: created.game.id,
      intent: { kind: "resign" },
      now: new Date(t0.getTime() + 1000),
    });
    expect(resigned.ok).toBe(true);
    if (!resigned.ok) return;
    expect(resigned.game.phase).toBe("done");
    expect(resigned.game.winner).toBe("white");
    expect(resigned.game.resultReason).toBe("resign");
    expect(resigned.game.ratingBefore).toBe(-900);
    expect(resigned.game.ratingAfter).toBeGreaterThan(-900);
    const again = await readGame({ sub, stage, id: created.game.id });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.game.ratingAfter).toBe(resigned.game.ratingAfter);
  });

  it("stores a real GNU Go reply only when the rules allow it", async () => {
    const created = await createGame({
      sub: black,
      stage,
      size: 9,
      color: "black",
      opponent: "gnugo",
    });
    if (!created.ok) throw new Error(created.error);
    expect(created.game.moves).toHaveLength(0);
    const played = await playMove({
      sub: black,
      stage,
      id: created.game.id,
      intent: { kind: "play", x: 2, y: 2 },
    });
    if (!played.ok) throw new Error(played.error);
    const answered = await answerEngine({ sub: black, stage, id: created.game.id });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.game.moves).toHaveLength(2);
    expect(answered.game.moves[1].color).toBe("white");
    expect(answered.game.engine).toBe("GNU Go");
    const reply = answered.game.moves[1];
    if (reply.kind === "play") {
      const board = replay(9, answered.game.moves);
      expect(board.board[reply.y ?? -1][reply.x ?? -1]).toBe("white");
    }
  });

  it("rejects a move that arrives after the clock has expired", async () => {
    const game = await started();
    const late = new Date(Date.parse("2026-01-01T00:00:00Z") + MAIN_MS + PERIOD_MS * 3);
    const played = await playMove({
      sub: black,
      stage,
      id: game.id,
      intent: { kind: "pass" },
      now: late,
    });
    expect(played.ok).toBe(false);
    if (!played.ok) {
      expect(played.error).toBe("timeout");
      expect(played.game?.winner).toBe("white");
      expect(played.game?.moves).toHaveLength(0);
    }
  });
});

import { randomBytes } from "node:crypto";
import { charge, MAIN_MS, PERIODS, type ClockSide } from "./clock";
import { transaction } from "./db";
import { GNU_GO_NAME, gnugoFinalScore, gnugoMove, winnerFromScore, type EngineIntent } from "./engine";
import { BEGINNER_GOR, GNU_GO_LEVEL_10_GOR, updateRating } from "./rating";
import { opposite, pass, place, replay, resign, type Color, type StoredMove } from "./rules";

const sizes = new Set([9, 13, 19]);

type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

type GameRow = {
  id: string;
  size: number;
  phase: string;
  to_play: string | null;
  black_sub: string | null;
  white_sub: string | null;
  black_main_ms: number;
  white_main_ms: number;
  black_periods: number;
  white_periods: number;
  turn_started_at: string | Date | null;
  winner: string | null;
  result_reason: string | null;
  stage: string;
  engine: string | null;
  score_text: string | null;
  rating_before: number | null;
  rating_after: number | null;
};

export type Intent =
  | { kind: "play"; x: number; y: number }
  | { kind: "pass" }
  | { kind: "resign" };

export type PublicMove = {
  n: number;
  color: Color;
  kind: "play" | "pass" | "resign";
  x: number | null;
  y: number | null;
};

export type PublicGame = {
  id: string;
  size: number;
  phase: "waiting" | "play" | "done";
  toPlay: Color | null;
  you: Color | null;
  blackSeated: boolean;
  whiteSeated: boolean;
  clock: {
    running: boolean;
    serverNow: number;
    turnStartedAt: number | null;
    blackMainMs: number;
    whiteMainMs: number;
    blackPeriods: number;
    whitePeriods: number;
  };
  moves: PublicMove[];
  winner: Color | null;
  resultReason: string | null;
  engine: string | null;
  engineColor: Color | null;
  scoreText: string | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
};

export type GameResult =
  | { ok: true; game: PublicGame }
  | { ok: false; error: string; game?: PublicGame };

function stamp(value: unknown): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isNaN(time) ? null : time;
}

function seat(sub: string, row: Pick<GameRow, "black_sub" | "white_sub">): Color | null {
  if (row.black_sub === sub) return "black";
  if (row.white_sub === sub) return "white";
  return null;
}

function side(row: GameRow, color: Color): ClockSide {
  return color === "black"
    ? { mainMs: Number(row.black_main_ms), periods: Number(row.black_periods) }
    : { mainMs: Number(row.white_main_ms), periods: Number(row.white_periods) };
}

function engineColor(row: GameRow): Color | null {
  if (row.engine !== "gnugo") return null;
  if (row.black_sub == null && row.white_sub != null) return "black";
  if (row.white_sub == null && row.black_sub != null) return "white";
  return null;
}

function present(row: GameRow, moves: PublicMove[], sub: string, now: Date): PublicGame {
  const toPlay = row.to_play === "black" || row.to_play === "white" ? row.to_play : null;
  const winner = row.winner === "black" || row.winner === "white" ? row.winner : null;
  const phase = row.phase === "play" || row.phase === "done" || row.phase === "waiting" ? row.phase : "done";
  const engineSide = engineColor(row);
  return {
    id: row.id,
    size: Number(row.size),
    phase,
    toPlay,
    you: seat(sub, row),
    blackSeated: row.black_sub != null || engineSide === "black",
    whiteSeated: row.white_sub != null || engineSide === "white",
    clock: {
      running: phase === "play" && stamp(row.turn_started_at) != null,
      serverNow: now.getTime(),
      turnStartedAt: stamp(row.turn_started_at),
      blackMainMs: Number(row.black_main_ms),
      whiteMainMs: Number(row.white_main_ms),
      blackPeriods: Number(row.black_periods),
      whitePeriods: Number(row.white_periods),
    },
    moves,
    winner,
    resultReason: row.result_reason,
    engine: row.engine === "gnugo" ? GNU_GO_NAME : null,
    engineColor: engineSide,
    scoreText: row.score_text ?? null,
    ratingBefore: row.rating_before == null ? null : Number(row.rating_before),
    ratingAfter: row.rating_after == null ? null : Number(row.rating_after),
  };
}

async function loadMoves(query: Query, id: string): Promise<PublicMove[]> {
  const rows = await query<{
    move_number: number;
    color: Color;
    kind: "play" | "pass" | "resign";
    x: number | null;
    y: number | null;
  }>("select move_number, color, kind, x, y from moves where game_id = $1 order by move_number asc", [id]);
  return rows.map((row) => ({
    n: Number(row.move_number),
    color: row.color,
    kind: row.kind,
    x: row.x == null ? null : Number(row.x),
    y: row.y == null ? null : Number(row.y),
  }));
}

async function lock(query: Query, id: string, stage: string): Promise<GameRow | null> {
  const rows = await query<GameRow>("select * from games where id = $1 and stage = $2 for update", [id, stage]);
  return rows[0] ?? null;
}

async function rememberRating(query: Query, row: GameRow): Promise<GameRow> {
  if (row.engine !== "gnugo" || row.phase !== "done") return row;
  if (row.result_reason === "score" && !row.score_text) return row;
  const human = row.black_sub ?? row.white_sub;
  if (!human) return row;
  const existing = await query<{ rating_before: number; rating_after: number }>(
    "select rating_before, rating_after from rating_events where sub = $1 and game_id = $2",
    [human, row.id],
  );
  if (existing[0]) {
    return {
      ...row,
      rating_before: Number(existing[0].rating_before),
      rating_after: Number(existing[0].rating_after),
    };
  }
  const latest = await query<{ rating_after: number }>(
    "select rating_after from rating_events where sub = $1 order by created_at desc, game_id desc limit 1",
    [human],
  );
  const before = latest[0] ? Number(latest[0].rating_after) : BEGINNER_GOR;
  const humanColor: Color = row.black_sub === human ? "black" : "white";
  const score: 0 | 0.5 | 1 = row.winner == null ? 0.5 : row.winner === humanColor ? 1 : 0;
  const after = updateRating(before, GNU_GO_LEVEL_10_GOR, score);
  const result = score === 1 ? "win" : score === 0 ? "loss" : "jigo";
  await query(
    `insert into rating_events (sub, game_id, rating_before, rating_after, result)
     values ($1, $2, $3, $4, $5)`,
    [human, row.id, before, after, result],
  );
  await query("update games set rating_before = $1, rating_after = $2 where id = $3", [before, after, row.id]);
  return { ...row, rating_before: before, rating_after: after };
}

async function settle(query: Query, row: GameRow, now: Date): Promise<{ row: GameRow; timedOut: boolean }> {
  if (row.phase !== "play" || (row.to_play !== "black" && row.to_play !== "white")) {
    return { row, timedOut: false };
  }
  const started = stamp(row.turn_started_at);
  if (started == null) return { row, timedOut: false };
  const color = row.to_play;
  const charged = charge(side(row, color), now.getTime() - started);
  if (!charged.timedOut) return { row, timedOut: false };
  const winner = opposite(color);
  await query(
    `update games
       set phase = 'done', to_play = null, winner = $1, result_reason = 'timeout', turn_started_at = null
     where id = $2 and stage = $3`,
    [winner, row.id, row.stage],
  );
  const closed = await rememberRating(query, {
    ...row,
    phase: "done",
    to_play: null,
    winner,
    result_reason: "timeout",
    turn_started_at: null,
  });
  return { timedOut: true, row: closed };
}

export function newGameId(): string {
  return randomBytes(16).toString("base64url");
}

export const gameIdPattern = /^[A-Za-z0-9_-]{22}$/;

export async function createGame(input: {
  sub: string;
  stage: string;
  size: number;
  color: Color;
  opponent?: "person" | "gnugo";
  now?: Date;
}): Promise<GameResult> {
  if (!sizes.has(input.size)) return { ok: false, error: "bad_size" };
  if (input.color !== "black" && input.color !== "white") return { ok: false, error: "bad_color" };
  const now = input.now ?? new Date();
  const id = newGameId();
  const engine = input.opponent === "gnugo";
  return transaction(async (query) => {
    await query(
      `insert into games (
         id, size, rules_id, komi, phase, to_play,
         black_sub, white_sub,
         black_main_ms, white_main_ms, black_periods, white_periods,
         stage, engine, turn_started_at
       ) values ($1, $2, 'chinese-area-1', 7.5, $3, $4, $5, $6, $7, $7, $8, $8, $9, $10, $11)`,
      [
        id,
        input.size,
        engine ? "play" : "waiting",
        engine ? "black" : null,
        input.color === "black" ? input.sub : null,
        input.color === "white" ? input.sub : null,
        MAIN_MS,
        PERIODS,
        input.stage,
        engine ? "gnugo" : null,
        engine ? now.toISOString() : null,
      ],
    );
    const row = await lock(query, id, input.stage);
    if (!row) return { ok: false, error: "not_found" };
    return { ok: true, game: present(row, [], input.sub, now) };
  });
}

export async function readGame(input: { sub: string; stage: string; id: string; now?: Date }): Promise<GameResult> {
  const now = input.now ?? new Date();
  return transaction(async (query) => {
    const row = await lock(query, input.id, input.stage);
    if (!row) return { ok: false, error: "not_found" };
    const settled = await settle(query, row, now);
    const moves = await loadMoves(query, row.id);
    return { ok: true, game: present(settled.row, moves, input.sub, now) };
  });
}

export async function takeSeat(input: { sub: string; stage: string; id: string; now?: Date }): Promise<GameResult> {
  const now = input.now ?? new Date();
  return transaction(async (query) => {
    const row = await lock(query, input.id, input.stage);
    if (!row) return { ok: false, error: "not_found" };
    if (row.engine === "gnugo" && !seat(input.sub, row)) return { ok: false, error: "seat_taken" };
    if (seat(input.sub, row)) {
      const settled = await settle(query, row, now);
      const moves = await loadMoves(query, row.id);
      return { ok: true, game: present(settled.row, moves, input.sub, now) };
    }
    if (row.black_sub != null && row.white_sub != null) return { ok: false, error: "seat_taken" };
    if (row.phase !== "waiting") return { ok: false, error: "seat_taken" };
    const color: Color = row.black_sub == null ? "black" : "white";
    const updated: GameRow = {
      ...row,
      black_sub: color === "black" ? input.sub : row.black_sub,
      white_sub: color === "white" ? input.sub : row.white_sub,
      phase: "play",
      to_play: "black",
      turn_started_at: now.toISOString(),
    };
    if (color === "black") {
      await query(
        `update games
           set black_sub = $1, phase = 'play', to_play = 'black', turn_started_at = $2
         where id = $3 and stage = $4`,
        [input.sub, now.toISOString(), row.id, row.stage],
      );
    } else {
      await query(
        `update games
           set white_sub = $1, phase = 'play', to_play = 'black', turn_started_at = $2
         where id = $3 and stage = $4`,
        [input.sub, now.toISOString(), row.id, row.stage],
      );
    }
    const moves = await loadMoves(query, row.id);
    return { ok: true, game: present(updated, moves, input.sub, now) };
  });
}

export type Scorer = (input: { size: number; moves: PublicMove[] }) => Promise<string>;

async function sealedScore(game: PublicGame, intent: Intent, scorer?: Scorer): Promise<string | null> {
  if (intent.kind !== "pass" || !game.engine || game.phase !== "play" || game.toPlay == null) return null;
  if (game.moves.at(-1)?.kind !== "pass") return null;
  const moves = [
    ...game.moves,
    { n: game.moves.length + 1, color: game.toPlay, kind: "pass" as const, x: null, y: null },
  ];
  try {
    return await (scorer ?? ((args) => gnugoFinalScore(args)))({ size: game.size, moves });
  } catch {
    return null;
  }
}

export async function playMove(input: {
  sub: string;
  stage: string;
  id: string;
  intent: Intent;
  now?: Date;
  scorer?: Scorer;
}): Promise<GameResult> {
  const now = input.now ?? new Date();
  const peeked = await readGame({ sub: input.sub, stage: input.stage, id: input.id, now });
  const scoreText = peeked.ok ? await sealedScore(peeked.game, input.intent, input.scorer) : null;
  return transaction(async (query) => {
    const row = await lock(query, input.id, input.stage);
    if (!row) return { ok: false, error: "not_found" };
    const settled = await settle(query, row, now);
    const moves = await loadMoves(query, row.id);
    if (settled.timedOut || settled.row.phase === "done") {
      return {
        ok: false,
        error: settled.row.result_reason === "timeout" ? "timeout" : "finished",
        game: present(settled.row, moves, input.sub, now),
      };
    }
    if (settled.row.phase !== "play" || (settled.row.to_play !== "black" && settled.row.to_play !== "white")) {
      return { ok: false, error: "waiting" };
    }
    const you = seat(input.sub, settled.row);
    if (!you) return { ok: false, error: "not_a_player" };
    if (you !== settled.row.to_play) return { ok: false, error: "not_your_turn" };
    if (engineColor(settled.row) === you) return { ok: false, error: "not_your_turn" };
    return record(query, settled.row, you, input.intent, moves, input.sub, now, scoreText);
  });
}

async function record(
  query: Query,
  row: GameRow,
  color: Color,
  intent: Intent,
  moves: PublicMove[],
  sub: string,
  now: Date,
  scoreText: string | null = null,
): Promise<GameResult> {
  const stored: StoredMove[] = moves.map((move) => ({
    color: move.color,
    kind: move.kind,
    x: move.x,
    y: move.y,
  }));
  const state = replay(Number(row.size), stored);
  if (intent.kind === "play") {
    const placed = place(state, intent.x, intent.y);
    if (!placed.ok) return { ok: false, error: placed.reason };
  } else if (intent.kind === "pass") {
    const passed = pass(state);
    if (!passed.ok) return { ok: false, error: passed.reason };
  } else {
    resign(state);
  }

  const started = stamp(row.turn_started_at) ?? now.getTime();
  const charged = charge(side(row, color), now.getTime() - started);
  const black = color === "black" ? charged : side(row, "black");
  const white = color === "white" ? charged : side(row, "white");
  const x = intent.kind === "play" ? intent.x : null;
  const y = intent.kind === "play" ? intent.y : null;
  await query(
    "insert into moves (game_id, move_number, color, kind, x, y) values ($1, $2, $3, $4, $5, $6)",
    [row.id, moves.length + 1, color, intent.kind, x, y],
  );
  const nextMoves: PublicMove[] = [...moves, { n: moves.length + 1, color, kind: intent.kind, x, y }];
  const twoPasses = row.engine === "gnugo" && intent.kind === "pass" && moves[moves.length - 1]?.kind === "pass";
  if (intent.kind === "resign" || twoPasses) {
    const winner = intent.kind === "resign" ? opposite(color) : winnerFromScore(scoreText);
    const reason = intent.kind === "resign" ? "resign" : "score";
    const closed = await rememberRating(query, {
      ...row,
      phase: "done",
      to_play: null,
      winner,
      result_reason: reason,
      score_text: twoPasses ? scoreText : row.score_text,
      turn_started_at: null,
      black_main_ms: black.mainMs,
      white_main_ms: white.mainMs,
      black_periods: black.periods,
      white_periods: white.periods,
    });
    await query(
      `update games
         set phase = 'done', to_play = null, winner = $1, result_reason = $2, score_text = $3, turn_started_at = null,
             black_main_ms = $4, white_main_ms = $5, black_periods = $6, white_periods = $7,
             rating_before = $8, rating_after = $9
       where id = $10 and stage = $11`,
      [
        winner,
        reason,
        twoPasses ? scoreText : null,
        black.mainMs,
        white.mainMs,
        black.periods,
        white.periods,
        closed.rating_before,
        closed.rating_after,
        row.id,
        row.stage,
      ],
    );
    return { ok: true, game: present(closed, nextMoves, sub, now) };
  }
  const next: GameRow = {
    ...row,
    to_play: opposite(color),
    turn_started_at: now.toISOString(),
    black_main_ms: black.mainMs,
    white_main_ms: white.mainMs,
    black_periods: black.periods,
    white_periods: white.periods,
  };
  await query(
    `update games
       set to_play = $1, turn_started_at = $2,
           black_main_ms = $3, white_main_ms = $4, black_periods = $5, white_periods = $6
     where id = $7 and stage = $8`,
    [opposite(color), now.toISOString(), black.mainMs, white.mainMs, black.periods, white.periods, row.id, row.stage],
  );
  return { ok: true, game: present(next, nextMoves, sub, now) };
}

export type Proposer = (input: { size: number; moves: PublicMove[]; color: Color }) => Promise<EngineIntent>;

const inflight = new Map<string, Promise<GameResult>>();

export async function answerEngine(input: {
  sub: string;
  stage: string;
  id: string;
  now?: Date;
  proposer?: Proposer;
  scorer?: Scorer;
}): Promise<GameResult> {
  const key = `${input.stage}:${input.id}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  let run!: Promise<GameResult>;
  run = answerOnce(input).finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}

async function answerOnce(input: {
  sub: string;
  stage: string;
  id: string;
  now?: Date;
  proposer?: Proposer;
  scorer?: Scorer;
}): Promise<GameResult> {
  const preview = await readGame(input);
  if (!preview.ok) return preview;
  const color = preview.game.engineColor;
  if (!color || preview.game.phase !== "play" || preview.game.toPlay !== color) return preview;
  const proposer = input.proposer ?? ((args) => gnugoMove(args));
  let intent: EngineIntent;
  try {
    intent = await proposer({ size: preview.game.size, moves: preview.game.moves, color });
  } catch {
    return preview;
  }
  const now = input.now ?? new Date();
  const scoreText = await sealedScore(
    { ...preview.game, moves: preview.game.moves, toPlay: color, phase: "play" },
    intent,
    input.scorer,
  );
  return transaction(async (query) => {
    const row = await lock(query, input.id, input.stage);
    if (!row) return { ok: false, error: "not_found" };
    const settled = await settle(query, row, now);
    const moves = await loadMoves(query, row.id);
    if (settled.timedOut || settled.row.phase !== "play" || settled.row.to_play !== color || engineColor(settled.row) !== color) {
      return { ok: true, game: present(settled.row, moves, input.sub, now) };
    }
    if (moves.length !== preview.game.moves.length) {
      return { ok: true, game: present(settled.row, moves, input.sub, now) };
    }
    const written = await record(query, settled.row, color, intent, moves, input.sub, now, scoreText);
    if (!written.ok) return { ok: true, game: present(settled.row, moves, input.sub, now) };
    return written;
  });
}

export type Color = "black" | "white";
export type Phase = "play" | "passed" | "resigned";

export interface Point {
  x: number;
  y: number;
}

export interface GameState {
  size: number;
  board: (Color | null)[][];
  previousBoard: (Color | null)[][] | null;
  toPlay: Color;
  prisoners: Record<Color, number>;
  consecutivePasses: number;
  phase: Phase;
  resigned: Color | null;
  lastMove: Point | null;
  plies: number;
}

export type PlaceResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: "occupied" | "suicide" | "ko" | "finished" };

const neighbors = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function opposite(color: Color): Color {
  return color === "black" ? "white" : "black";
}

export function emptyBoard(size: number): (Color | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

export function createGame(size: number): GameState {
  return {
    size,
    board: emptyBoard(size),
    previousBoard: null,
    toPlay: "black",
    prisoners: { black: 0, white: 0 },
    consecutivePasses: 0,
    phase: "play",
    resigned: null,
    lastMove: null,
    plies: 0,
  };
}

function cloneBoard(board: (Color | null)[][]): (Color | null)[][] {
  return board.map((row) => row.slice());
}

function boardsEqual(a: (Color | null)[][], b: (Color | null)[][]): boolean {
  for (let y = 0; y < a.length; y += 1) {
    for (let x = 0; x < a.length; x += 1) {
      if (a[y][x] !== b[y][x]) return false;
    }
  }
  return true;
}

function groupAt(board: (Color | null)[][], x: number, y: number) {
  const color = board[y][x];
  const size = board.length;
  const stones: Point[] = [];
  const seen = new Set<string>();
  const stack = [{ x, y }];
  let liberties = 0;
  const libertyKeys = new Set<string>();
  while (stack.length > 0) {
    const point = stack.pop()!;
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stones.push(point);
    for (const [dx, dy] of neighbors) {
      const nx = point.x + dx;
      const ny = point.y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const occupant = board[ny][nx];
      if (occupant === null) {
        libertyKeys.add(`${nx},${ny}`);
      } else if (occupant === color) {
        stack.push({ x: nx, y: ny });
      }
    }
  }
  liberties = libertyKeys.size;
  return { stones, liberties };
}

export function place(state: GameState, x: number, y: number): PlaceResult {
  if (state.phase !== "play") return { ok: false, reason: "finished" };
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return { ok: false, reason: "occupied" };
  if (state.board[y][x] !== null) return { ok: false, reason: "occupied" };

  const next = cloneBoard(state.board);
  next[y][x] = state.toPlay;
  let captured = 0;
  const seen = new Set<string>();
  for (const [dx, dy] of neighbors) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= state.size || ny >= state.size) continue;
    if (next[ny][nx] !== opposite(state.toPlay)) continue;
    const key = `${nx},${ny}`;
    if (seen.has(key)) continue;
    const group = groupAt(next, nx, ny);
    for (const stone of group.stones) seen.add(`${stone.x},${stone.y}`);
    if (group.liberties === 0) {
      for (const stone of group.stones) next[stone.y][stone.x] = null;
      captured += group.stones.length;
    }
  }

  const own = groupAt(next, x, y);
  if (own.liberties === 0 && captured === 0) return { ok: false, reason: "suicide" };
  if (state.previousBoard && boardsEqual(next, state.previousBoard)) return { ok: false, reason: "ko" };

  return {
    ok: true,
    state: {
      ...state,
      board: next,
      previousBoard: cloneBoard(state.board),
      toPlay: opposite(state.toPlay),
      prisoners: {
        ...state.prisoners,
        [state.toPlay]: state.prisoners[state.toPlay] + captured,
      },
      consecutivePasses: 0,
      lastMove: { x, y },
      plies: state.plies + 1,
    },
  };
}

export function pass(state: GameState): PlaceResult {
  if (state.phase !== "play") return { ok: false, reason: "finished" };
  const consecutivePasses = state.consecutivePasses + 1;
  return {
    ok: true,
    state: {
      ...state,
      previousBoard: cloneBoard(state.board),
      toPlay: opposite(state.toPlay),
      consecutivePasses,
      lastMove: null,
      plies: state.plies + 1,
    },
  };
}

export function resign(state: GameState): GameState {
  if (state.phase !== "play") return state;
  return {
    ...state,
    phase: "resigned",
    resigned: state.toPlay,
    lastMove: null,
    plies: state.plies + 1,
  };
}

export type StoredMove = {
  color: Color;
  kind: "play" | "pass" | "resign";
  x: number | null;
  y: number | null;
};

export function replay(size: number, moves: StoredMove[]): GameState {
  let state = createGame(size);
  for (const move of moves) {
    if (move.kind === "play" && move.x !== null && move.y !== null) {
      const placed = place(state, move.x, move.y);
      if (placed.ok) state = placed.state;
    } else if (move.kind === "pass") {
      const passed = pass(state);
      if (passed.ok) state = passed.state;
    } else if (move.kind === "resign") {
      state = resign(state);
    }
  }
  return state;
}

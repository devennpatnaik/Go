import { fromGtp, toGtp, type GtpIntent } from "./gtp";
import type { Color } from "./rules";

export type ReviewMove = {
  color: Color;
  kind: "play" | "pass" | "resign";
  x: number | null;
  y: number | null;
};

export type Choice = {
  kind: "play" | "pass" | "resign";
  label: string;
  x: number | null;
  y: number | null;
};

export type ReviewPoint = {
  played: Choice;
  best: Choice;
};

export type ReviewEvent =
  | { type: "start"; total: number }
  | { type: "move"; index: number; played: Choice; best: Choice }
  | { type: "done"; score: string; suggestion: Choice; ratingBefore: number | null; ratingAfter: number | null }
  | { type: "error" };

export type ReviewCursor =
  | { phase: "setup"; left: number }
  | { phase: "best"; index: number }
  | { phase: "ack"; index: number }
  | { phase: "score" }
  | { phase: "final" }
  | { phase: "end" };

export function describeMove(move: ReviewMove, size: number): Choice {
  if (move.kind === "play" && move.x != null && move.y != null) {
    return { kind: "play", label: toGtp(move.x, move.y, size), x: move.x, y: move.y };
  }
  if (move.kind === "resign") return { kind: "resign", label: "Resign", x: null, y: null };
  return { kind: "pass", label: "Pass", x: null, y: null };
}

export function describeIntent(intent: GtpIntent, size: number): Choice {
  if (intent.kind === "play") return { kind: "play", label: toGtp(intent.x, intent.y, size), x: intent.x, y: intent.y };
  if (intent.kind === "resign") return { kind: "resign", label: "Resign", x: null, y: null };
  return { kind: "pass", label: "Pass", x: null, y: null };
}

export function choicesDiffer(played: Choice, best: Choice): boolean {
  if (played.kind !== "play" || best.kind !== "play") return played.kind !== best.kind;
  return played.x !== best.x || played.y !== best.y;
}

export function openingPly(points: ReviewPoint[]): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.played.kind === "play" && choicesDiffer(point.played, point.best)) return index + 1;
  }
  return points.length;
}

export function reviewCommands(size: number, moves: ReviewMove[], finalColor: Color): string[] {
  const commands = [`boardsize ${size}`, "clear_board", "komi 7.5"];
  for (const move of moves) {
    commands.push(`reg_genmove ${move.color}`);
    if (move.kind === "play" && move.x != null && move.y != null) {
      commands.push(`play ${move.color} ${toGtp(move.x, move.y, size)}`);
    } else if (move.kind === "pass") {
      commands.push(`play ${move.color} pass`);
    }
  }
  commands.push("estimate_score", `reg_genmove ${finalColor}`, "quit");
  return commands;
}

export function reviewStart(): ReviewCursor {
  return { phase: "setup", left: 3 };
}

export function pushReview(
  cursor: ReviewCursor,
  reply: string,
  moves: ReviewMove[],
  size: number,
): { cursor: ReviewCursor; index?: number; best?: GtpIntent; score?: string; suggestion?: GtpIntent } {
  if (cursor.phase === "setup") {
    const left = cursor.left - 1;
    if (left > 0) return { cursor: { phase: "setup", left } };
    return { cursor: moves.length > 0 ? { phase: "best", index: 0 } : { phase: "score" } };
  }
  if (cursor.phase === "best") {
    const best = fromGtp(reply, size);
    if (!best) throw new Error("gnugo");
    const move = moves[cursor.index];
    const next: ReviewCursor =
      move.kind === "resign"
        ? cursor.index + 1 < moves.length
          ? { phase: "best", index: cursor.index + 1 }
          : { phase: "score" }
        : { phase: "ack", index: cursor.index };
    return { cursor: next, index: cursor.index, best };
  }
  if (cursor.phase === "ack") {
    const nextIndex = cursor.index + 1;
    return { cursor: nextIndex < moves.length ? { phase: "best", index: nextIndex } : { phase: "score" } };
  }
  if (cursor.phase === "score") {
    if (!reply) throw new Error("gnugo");
    return { cursor: { phase: "final" }, score: reply };
  }
  if (cursor.phase === "final") {
    const suggestion = fromGtp(reply, size);
    if (!suggestion) throw new Error("gnugo");
    return { cursor: { phase: "end" }, suggestion };
  }
  throw new Error("gnugo");
}

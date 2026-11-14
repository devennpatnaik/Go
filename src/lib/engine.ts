import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fromGtp, toGtp, type GtpIntent } from "./gtp";
import { pushReview, reviewCommands, reviewStart } from "./review";
import type { Color } from "./rules";

export const GNU_GO_NAME = "GNU Go";
export const GNU_GO_LEVEL = 10;

export type EngineIntent = GtpIntent;
export { fromGtp, toGtp, winnerFromScore } from "./gtp";

export type EngineMove = {
  color: Color;
  kind: "play" | "pass" | "resign";
  x: number | null;
  y: number | null;
};

export function gnugoPath(): string {
  if (existsSync("/usr/games/gnugo")) return "/usr/games/gnugo";
  return "gnugo";
}

function setup(size: number, moves: EngineMove[]): string[] {
  const commands = [`boardsize ${size}`, "clear_board", "komi 7.5"];
  for (const move of moves) {
    if (move.kind === "resign") continue;
    if (move.kind === "play" && move.x != null && move.y != null) {
      commands.push(`play ${move.color} ${toGtp(move.x, move.y, size)}`);
    } else if (move.kind === "pass") {
      commands.push(`play ${move.color} pass`);
    }
  }
  return commands;
}

function replies(stdout: string): string[] {
  return stdout
    .split(/\n\n/)
    .map((part) => part.trim())
    .filter((part) => part.startsWith("=") || part.startsWith("?"))
    .map((part) => {
      if (!part.startsWith("=")) throw new Error("gnugo");
      return part.slice(1).trim();
    });
}

export async function gnugoFinalScore(input: { size: number; moves: EngineMove[] }): Promise<string> {
  const answers = replies(await run([...setup(input.size, input.moves), "final_score", "quit"], GNU_GO_LEVEL));
  const score = answers[answers.length - 2];
  if (!score) throw new Error("gnugo");
  return score;
}

export async function gnugoReport(input: {
  size: number;
  moves: EngineMove[];
  color: Color;
}): Promise<{ score: string; suggestion: EngineIntent }> {
  const answers = replies(
    await run([...setup(input.size, input.moves), "estimate_score", `reg_genmove ${input.color}`, "quit"], GNU_GO_LEVEL),
  );
  const score = answers[answers.length - 3];
  const suggestion = fromGtp(answers[answers.length - 2] ?? "", input.size);
  if (!score || !suggestion) throw new Error("gnugo");
  return { score, suggestion };
}

export async function gnugoMove(input: {
  size: number;
  moves: EngineMove[];
  color: Color;
  level?: number;
}): Promise<EngineIntent> {
  const commands = ["boardsize " + input.size, "clear_board", "komi 7.5"];
  for (const move of input.moves) {
    if (move.kind === "resign") continue;
    if (move.kind === "play" && move.x != null && move.y != null) {
      commands.push(`play ${move.color} ${toGtp(move.x, move.y, input.size)}`);
    } else if (move.kind === "pass") {
      commands.push(`play ${move.color} pass`);
    }
  }
  commands.push(`genmove ${input.color}`);
  commands.push("quit");
  const stdout = await run(commands, input.level ?? GNU_GO_LEVEL);
  const parts = stdout
    .split(/\n\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const reply = parts.length >= 2 ? parts[parts.length - 2] : "";
  if (!reply.startsWith("=")) throw new Error("gnugo");
  const intent = fromGtp(reply.slice(1), input.size);
  if (!intent) throw new Error("gnugo");
  return intent;
}

export async function gnugoReview(input: {
  size: number;
  moves: EngineMove[];
  finalColor: Color;
  signal?: AbortSignal;
  onPoint?: (index: number, best: GtpIntent) => void;
}): Promise<{ score: string; suggestion: GtpIntent }> {
  let cursor = reviewStart();
  let score = "";
  let suggestion: GtpIntent | null = null;
  await runReview(
    reviewCommands(input.size, input.moves, input.finalColor),
    (reply) => {
      if (cursor.phase === "end") return;
      const step = pushReview(cursor, reply, input.moves, input.size);
      cursor = step.cursor;
      if (step.best && step.index != null) input.onPoint?.(step.index, step.best);
      if (step.score) score = step.score;
      if (step.suggestion) suggestion = step.suggestion;
    },
    input.signal,
  );
  if (cursor.phase !== "end" || !score || !suggestion) throw new Error("gnugo");
  return { score, suggestion };
}

function run(commands: string[], level: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(gnugoPath(), ["--mode", "gtp", "--level", String(level), "--quiet"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("gnugo"));
    }, 25000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(stdout);
    });
    child.stdin.write(commands.join("\n") + "\n");
    child.stdin.end();
  });
}

function runReview(commands: string[], onReply: (reply: string) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("gnugo"));
      return;
    }
    const child = spawn(gnugoPath(), ["--mode", "gtp", "--level", String(GNU_GO_LEVEL), "--quiet"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const total = setTimeout(() => fail(new Error("gnugo")), 20 * 60 * 1000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (idle) clearTimeout(idle);
      clearTimeout(total);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
        return;
      }
      resolve();
    };
    function fail(error: Error) {
      finish(error);
    }
    function bump() {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => fail(new Error("gnugo")), 90_000);
    }
    function onAbort() {
      fail(new Error("gnugo"));
    }
    bump();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      bump();
      stdout += chunk.replaceAll("\r\n", "\n");
      try {
        while (true) {
          const split = stdout.indexOf("\n\n");
          if (split < 0) break;
          const part = stdout.slice(0, split).trim();
          stdout = stdout.slice(split + 2);
          if (!part) continue;
          if (!part.startsWith("=")) throw new Error("gnugo");
          onReply(part.slice(1).trim());
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error("gnugo"));
      }
    });
    child.on("error", (error) => fail(error));
    child.on("close", () => finish());
    child.stdin.on("error", () => undefined);
    child.stdin.write(commands.join("\n") + "\n");
    child.stdin.end();
  });
}

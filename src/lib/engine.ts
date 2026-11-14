import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Color } from "./rules";

export const GNU_GO_NAME = "GNU Go";
export const GNU_GO_LEVEL = 10;

const columns = "ABCDEFGHJKLMNOPQRST";

export type EngineMove = {
  color: Color;
  kind: "play" | "pass" | "resign";
  x: number | null;
  y: number | null;
};

export type EngineIntent =
  | { kind: "play"; x: number; y: number }
  | { kind: "pass" }
  | { kind: "resign" };

export function gnugoPath(): string {
  if (existsSync("/usr/games/gnugo")) return "/usr/games/gnugo";
  return "gnugo";
}

export function toGtp(x: number, y: number, size: number): string {
  return `${columns[x]}${size - y}`;
}

export function fromGtp(token: string, size: number): EngineIntent | null {
  const word = token.trim().toUpperCase();
  if (word === "PASS") return { kind: "pass" };
  if (word === "RESIGN") return { kind: "resign" };
  const match = /^([A-HJ-T])(\d{1,2})$/.exec(word);
  if (!match) return null;
  const x = columns.indexOf(match[1]);
  const row = Number(match[2]);
  if (x < 0 || row < 1 || row > size) return null;
  return { kind: "play", x, y: size - row };
}

export function winnerFromScore(text: string | null): "black" | "white" | null {
  if (!text) return null;
  const match = /([BW])\+/.exec(text);
  if (!match) return null;
  return match[1] === "B" ? "black" : "white";
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

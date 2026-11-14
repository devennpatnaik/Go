const columns = "ABCDEFGHJKLMNOPQRST";

export type GtpIntent =
  | { kind: "play"; x: number; y: number }
  | { kind: "pass" }
  | { kind: "resign" };

export function toGtp(x: number, y: number, size: number): string {
  return `${columns[x]}${size - y}`;
}

export function fromGtp(token: string, size: number): GtpIntent | null {
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

import { gnugoReport, toGtp } from "@/lib/engine";
import { saveAnalysis } from "@/lib/history";
import { person, privateCache } from "@/lib/http";
import { gameIdPattern, readGame } from "@/lib/play";
import type { Color } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const who = await person(request);
  if (who instanceof Response) return who;
  const { id } = await context.params;
  if (!gameIdPattern.test(id)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: privateCache });
  }
  const loaded = await readGame({ sub: who.sub, stage: who.stage, id });
  if (!loaded.ok) return Response.json({ error: "not_found" }, { status: 404, headers: privateCache });
  const game = loaded.game;
  if (game.phase !== "done" || !game.engine) {
    return Response.json({ error: "not_finished" }, { status: 409, headers: privateCache });
  }
  const color: Color = game.resultReason === "resign" && game.winner ? (game.winner === "black" ? "white" : "black") : "black";
  const moves = game.moves.filter((move) => move.kind !== "resign");
  let report: Awaited<ReturnType<typeof gnugoReport>>;
  try {
    report = await gnugoReport({ size: game.size, moves, color });
  } catch {
    return Response.json({ error: "gnugo" }, { status: 502, headers: privateCache });
  }
  const label = report.suggestion.kind === "play" ? toGtp(report.suggestion.x, report.suggestion.y, game.size) : report.suggestion.kind;
  await saveAnalysis(who.sub, id, report.score, label);
  const suggestion =
    report.suggestion.kind === "play"
      ? { kind: "play" as const, color, x: report.suggestion.x, y: report.suggestion.y, label }
      : { kind: report.suggestion.kind, color, label };
  return Response.json(
    {
      score: report.score,
      suggestion,
      ratingBefore: game.ratingBefore,
      ratingAfter: game.ratingAfter,
    },
    { headers: privateCache },
  );
}

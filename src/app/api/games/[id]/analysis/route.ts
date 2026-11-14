import { gnugoReview, toGtp } from "@/lib/engine";
import { saveAnalysis } from "@/lib/history";
import { person, privateCache } from "@/lib/http";
import { gameIdPattern, readGame } from "@/lib/play";
import { describeIntent, describeMove, type ReviewEvent } from "@/lib/review";
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
  const moves = game.moves;
  const encoder = new TextEncoder();
  let closed = false;
  const abort = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ReviewEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
          abort.abort();
        }
      };
      const stop = () => {
        if (!closed) abort.abort();
      };
      request.signal.addEventListener("abort", stop, { once: true });
      try {
        send({ type: "start", total: moves.length });
        const report = await gnugoReview({
          size: game.size,
          moves,
          finalColor: color,
          signal: abort.signal,
          onPoint: (index, best) => {
            const played = moves[index];
            if (!played) return;
            send({
              type: "move",
              index,
              played: describeMove(played, game.size),
              best: describeIntent(best, game.size),
            });
          },
        });
        const label = report.suggestion.kind === "play" ? toGtp(report.suggestion.x, report.suggestion.y, game.size) : report.suggestion.kind;
        await saveAnalysis(who.sub, id, report.score, label);
        send({
          type: "done",
          score: report.score,
          suggestion: describeIntent(report.suggestion, game.size),
          ratingBefore: game.ratingBefore,
          ratingAfter: game.ratingAfter,
        });
        if (!closed) controller.close();
      } catch {
        send({ type: "error" });
        if (!closed) {
          try {
            controller.close();
          } catch {
            closed = true;
          }
        }
      } finally {
        request.signal.removeEventListener("abort", stop);
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "private, no-store",
      "x-accel-buffering": "no",
    },
  });
}

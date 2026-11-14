import { person, privateCache } from "@/lib/http";
import { answerEngine, gameIdPattern, playMove, type Intent } from "@/lib/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const who = await person(request);
  if (who instanceof Response) return who;
  const { id } = await context.params;
  if (!gameIdPattern.test(id)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: privateCache });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: privateCache });
  }
  const intent = intentOf(body);
  if (!intent) return Response.json({ error: "bad_request" }, { status: 400, headers: privateCache });
  const result = await playMove({ sub: who.sub, stage: who.stage, id, intent });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "not_a_player" ? 403 : 409;
    return Response.json({ error: result.error, game: result.game ?? null }, { status, headers: privateCache });
  }
  const answered = await answerEngine({ sub: who.sub, stage: who.stage, id });
  return Response.json(answered.ok ? answered.game : result.game, { headers: privateCache });
}

function intentOf(body: unknown): Intent | null {
  if (typeof body !== "object" || body === null || !("kind" in body)) return null;
  const kind = body.kind;
  if (kind === "pass" || kind === "resign") return { kind };
  if (kind !== "play" || !("x" in body) || !("y" in body)) return null;
  const { x, y } = body;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { kind: "play", x, y };
}

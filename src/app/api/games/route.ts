import { person, privateCache } from "@/lib/http";
import { createGame } from "@/lib/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const who = await person(request);
  if (who instanceof Response) return who;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: privateCache });
  }
  const size = typeof body === "object" && body && "size" in body ? body.size : null;
  const color = typeof body === "object" && body && "color" in body ? body.color : null;
  if (color !== "black" && color !== "white") {
    return Response.json({ error: "bad_color" }, { status: 400, headers: privateCache });
  }
  if (size !== 9 && size !== 13 && size !== 19) {
    return Response.json({ error: "bad_size" }, { status: 400, headers: privateCache });
  }
  const opponent = typeof body === "object" && body && "opponent" in body ? body.opponent : "person";
  if (opponent !== "person" && opponent !== "gnugo") {
    return Response.json({ error: "bad_request" }, { status: 400, headers: privateCache });
  }
  const result = await createGame({ sub: who.sub, stage: who.stage, size, color, opponent });
  if (!result.ok) return Response.json({ error: result.error }, { status: 400, headers: privateCache });
  return Response.json(result.game, { status: 201, headers: privateCache });
}

import { person, privateCache } from "@/lib/http";
import { gameIdPattern, takeSeat } from "@/lib/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const who = await person(request);
  if (who instanceof Response) return who;
  const { id } = await context.params;
  if (!gameIdPattern.test(id)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: privateCache });
  }
  const result = await takeSeat({ sub: who.sub, stage: who.stage, id });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return Response.json({ error: result.error }, { status, headers: privateCache });
  }
  return Response.json(result.game, { headers: privateCache });
}

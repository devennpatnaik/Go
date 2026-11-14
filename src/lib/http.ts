import { requireIdentity } from "../../cursor/identity.js";

export const privateCache = { "cache-control": "private, no-store" };

type Person = {
  kind: "person";
  sub: string;
  name: string;
  stage: "production" | "preview";
};

export async function person(request: Request): Promise<Person | Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    const headers = new Headers(identity.headers);
    headers.set("cache-control", "private, no-store");
    return new Response(identity.body, { status: identity.status, headers });
  }
  if (identity.kind !== "person") {
    return Response.json({ error: "not_a_person" }, { status: 403, headers: privateCache });
  }
  return {
    kind: "person",
    sub: identity.sub,
    name: identity.name,
    stage: identity.stage === "preview" ? "preview" : "production",
  };
}

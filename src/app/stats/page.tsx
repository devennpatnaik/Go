import { headers } from "next/headers";
import { getIdentity } from "../../../cursor/identity.js";
import { listHistory } from "@/lib/history";
import { BEGINNER_GOR } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const incoming = await headers();
  const list = new Headers();
  incoming.forEach((value, key) => {
    list.set(key, value);
  });
  const identity = await getIdentity(new Request("http://localhost/", { headers: list }));
  const sub = identity.verified && identity.kind === "person" ? identity.sub : "";
  const rows = sub ? await listHistory(sub) : [];
  const current = rows.length > 0 ? Math.round(rows[rows.length - 1].rating_after) : BEGINNER_GOR;

  return (
    <main className="stats">
      <p className="rating">{current}</p>
      <Spark values={rows.map((row) => row.rating_after)} />
      <ol className="history">
        {rows.map((row) => (
          <li key={row.game_id}>
            <span className="history-result">{row.result}</span>
            <span className="history-rating">{Math.round(row.rating_after)}</span>
            <span className="history-score">{row.score_estimate ?? ""}</span>
            <span className="history-move">{row.suggestion ?? ""}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const width = 640;
  const height = 160;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const radius = values.length === 1 ? 22 : 7;
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 48) - 24;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Rating over time">
      <polyline points={points} />
      {values.map((value, index) => {
        const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * (height - 48) - 24;
        return <circle key={index} cx={x} cy={y} r={radius} />;
      })}
    </svg>
  );
}

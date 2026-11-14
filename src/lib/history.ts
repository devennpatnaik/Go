import { sql } from "./db";

export type RatingEvent = {
  game_id: string;
  rating_before: number;
  rating_after: number;
  result: string;
  score_estimate: string | null;
  suggestion: string | null;
  created_at: string | Date;
};

export async function listHistory(sub: string): Promise<RatingEvent[]> {
  const rows = await sql<RatingEvent>(
    `select game_id, rating_before, rating_after, result, score_estimate, suggestion, created_at
       from rating_events
      where sub = $1
      order by created_at asc, game_id asc`,
    [sub],
  );
  return rows.map((row) => ({
    ...row,
    rating_before: Number(row.rating_before),
    rating_after: Number(row.rating_after),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

export async function saveAnalysis(sub: string, gameId: string, score: string, suggestion: string): Promise<void> {
  await sql(
    `update rating_events set score_estimate = $1, suggestion = $2 where sub = $3 and game_id = $4`,
    [score, suggestion, sub, gameId],
  );
}

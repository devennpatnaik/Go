// European Go Database, rating algorithm from 2021:
// https://europeangodatabase.eu/docs/about/egf-rating-system
// 20 kyu is GoR 100 and each grade is 100 points, so 30 kyu, the published
// beginner grade and the floor, is GoR -900.
// GNU Go 3.8 at level 10 is published at about 8 kyu, which is GoR 1300
// (1 kyu = 2000).

export const BEGINNER_GOR = -900;
export const RATING_FLOOR = -900;
export const GNU_GO_LEVEL_10_GOR = 1300;

export function con(rating: number): number {
  return ((3300 - rating) / 200) ** 1.6;
}

export function beta(rating: number): number {
  return -7 * Math.log(3300 - rating);
}

export function expected(player: number, opponent: number): number {
  return 1 / (1 + Math.exp(beta(opponent) - beta(player)));
}

export function bonus(rating: number): number {
  return Math.log(1 + Math.exp((2300 - rating) / 80)) / 5;
}

export function updateRating(rating: number, opponent: number, score: 0 | 0.5 | 1): number {
  const next = rating + con(rating) * (score - expected(rating, opponent)) + bonus(rating);
  return next < RATING_FLOOR ? RATING_FLOOR : next;
}

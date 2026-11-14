import { place, type GameState, createGame } from "./rules";

const sgf = "qd dc pq oc cp cf ep qo pe np po pp op qp oq oo pn qq";

function point(coord: string) {
  return { x: coord.charCodeAt(0) - 97, y: coord.charCodeAt(1) - 97 };
}

export function openingFrames(): GameState[] {
  const frames: GameState[] = [createGame(19)];
  let state = frames[0];
  for (const coord of sgf.split(" ")) {
    const { x, y } = point(coord);
    const placed = place(state, x, y);
    if (!placed.ok) throw new Error(`opening ${coord}`);
    state = placed.state;
    frames.push(state);
  }
  return frames;
}

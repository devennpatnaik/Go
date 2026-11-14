"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Board from "@/components/Board";
import { charge, formatClock, PERIOD_MS } from "@/lib/clock";
import type { PublicGame } from "@/lib/play";
import { choicesDiffer, openingPly, type ReviewEvent, type ReviewPoint } from "@/lib/review";
import { opposite, replay, type Color } from "@/lib/rules";

const notes: Record<string, string> = {
  occupied: "Taken",
  suicide: "No liberty",
  ko: "Ko",
  waiting: "Waiting",
  not_a_player: "Waiting",
  not_your_turn: "Waiting",
  finished: "Over",
  timeout: "Time",
};

type Intent = { kind: "play"; x: number; y: number } | { kind: "pass" } | { kind: "resign" };

type ReviewState = {
  total: number;
  points: ReviewPoint[];
  done: boolean;
  score: string | null;
};

export default function Room({ id }: { id: string }) {
  const router = useRouter();
  const [game, setGame] = useState<PublicGame | null>(null);
  const [note, setNote] = useState("");
  const [receivedAt, setReceivedAt] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const [review, setReview] = useState<ReviewState | null>(null);
  const [ply, setPly] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [sending, setSending] = useState(false);
  const reviewRef = useRef<ReviewState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((next: PublicGame) => {
    setGame(next);
    setReceivedAt(Date.now());
  }, []);

  useEffect(() => {
    let stop = false;
    async function load() {
      const response = await fetch(`/api/games/${id}`, { cache: "no-store" });
      if (!response.ok || stop) return;
      apply((await response.json()) as PublicGame);
    }
    void load();
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      stop = true;
      window.clearInterval(tick);
    };
  }, [apply, id]);

  useEffect(() => {
    if (!game || game.engine) return;
    const poll = window.setInterval(() => {
      void fetch(`/api/games/${id}`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        apply((await response.json()) as PublicGame);
      });
    }, 2000);
    return () => window.clearInterval(poll);
  }, [apply, game?.engine, id]);

  useEffect(() => {
    reviewRef.current = null;
    setReview(null);
    setPly(null);
    return () => abortRef.current?.abort();
  }, [id]);

  const ready = review != null && review.points.length > 0 && !reading && ply != null;
  const state = useMemo(() => {
    if (!game) return null;
    const moves = ready && ply != null ? game.moves.slice(0, ply) : game.moves;
    return replay(game.size, moves);
  }, [game, ply, ready]);

  async function send(body: Intent) {
    if (!game || sending) return;
    const previous = game;
    if (game.engine) apply(painted(game, body));
    setSending(true);
    try {
      const response = await fetch(`/api/games/${id}/moves`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as PublicGame & { error?: string; game?: PublicGame | null };
      if (!response.ok || payload.error) {
        apply(payload.game ?? previous);
        setNote(notes[payload.error ?? ""] ?? "");
        return;
      }
      setNote("");
      apply(payload);
    } catch {
      apply(previous);
    } finally {
      setSending(false);
    }
  }

  async function sit() {
    const response = await fetch(`/api/games/${id}/seat`, { method: "POST" });
    if (!response.ok) return;
    setNote("");
    apply((await response.json()) as PublicGame);
  }

  async function start(color: Color) {
    if (!game) return;
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ size: game.size, color, opponent: "gnugo" }),
    });
    if (!response.ok) return;
    const created = (await response.json()) as { id: string };
    router.push(`/g/${created.id}`);
  }

  function remember(next: ReviewState | null) {
    reviewRef.current = next;
    setReview(next);
  }

  function go(next: number) {
    const max = reviewRef.current?.points.length ?? 0;
    setPly(Math.min(max, Math.max(0, next)));
  }

  function applyReview(event: ReviewEvent) {
    if (event.type === "start") {
      remember({ total: event.total, points: [], done: false, score: null });
      return;
    }
    const current = reviewRef.current;
    if (!current) return;
    if (event.type === "move") {
      const points = current.points.slice();
      points[event.index] = { played: event.played, best: event.best };
      remember({ ...current, points });
      return;
    }
    if (event.type === "done") {
      const next = { ...current, done: true, score: event.score };
      remember(next);
      if (next.points.length > 0) setPly((place) => place ?? openingPly(next.points));
      return;
    }
    setNote("Stopped");
    if (current.points.length > 0) setPly((place) => place ?? openingPly(current.points));
  }

  async function analyze() {
    if (reading || reviewRef.current?.done) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setReading(true);
    setNote("");
    setPly(null);
    remember({ total: 0, points: [], done: false, score: null });
    try {
      const response = await fetch(`/api/games/${id}/analysis`, { method: "POST", signal: controller.signal });
      if (!response.ok || !response.body) {
        setNote("Stopped");
        remember(null);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          applyReview(JSON.parse(line) as ReviewEvent);
        }
      }
      if (buffer.trim()) applyReview(JSON.parse(buffer) as ReviewEvent);
    } catch {
      if (!controller.signal.aborted) setNote("Stopped");
    } finally {
      if (abortRef.current === controller) setReading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const max = reviewRef.current?.points.length ?? 0;
      setPly((place) => {
        const current = place ?? 0;
        return event.key === "ArrowLeft" ? Math.max(0, current - 1) : Math.min(max, current + 1);
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector("[aria-current='true']");
    if (!strip || !(current instanceof HTMLElement)) return;
    strip.scrollLeft = current.offsetLeft - strip.clientWidth / 2 + current.clientWidth / 2;
  }, [ply]);

  if (!game || !state) {
    return (
      <main className="play">
        <p className="sr">Go</p>
      </main>
    );
  }

  const yours = game.phase === "play" && game.you != null && game.you === game.toPlay && !sending;
  const open = game.phase === "waiting" && game.you == null && (!game.blackSeated || !game.whiteSeated);
  const finished = game.engine != null && game.phase === "done";
  const title = titleOf(game);
  const clocks = clockOf(game, now, receivedAt);
  const point = ready && review && ply != null && ply > 0 ? review.points[ply - 1] ?? null : null;
  const best =
    point && point.best.kind === "play" && point.best.x != null && point.best.y != null && choicesDiffer(point.played, point.best)
      ? { x: point.best.x, y: point.best.y }
      : null;
  const rating = formatGor(game.ratingBefore, game.ratingAfter);
  const boardLabel = point ? `Played ${point.played.label}. Best ${point.best.label}.` : title.heading;

  return (
    <main className="play">
      <div className="stage">
        <Board
          state={state}
          interactive={yours}
          label={boardLabel}
          mark={best}
          coords={yours || ready}
          onPlay={(x, y) => void send({ kind: "play", x, y })}
        />
      </div>
      <aside className="panel">
        <p className="status">
          <span className="status-title">{title.heading}</span>
          <span className="status-kicker">{title.kicker}</span>
        </p>
        {game.engine ? <p className="engine-name">{game.engine}</p> : null}
        {finished && rating ? <p className="rating">{rating}</p> : null}
        {reading ? (
          <div className="review-progress" aria-live="polite" aria-busy="true">
            <p className="note">Reviewing {review ? `${review.points.length} / ${review.total}` : ""}</p>
            {review && review.total > 0 ? (
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (review.points.length / review.total) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
        {point ? (
          <div className="compare">
            <p>
              <span>Played</span>
              <strong>{point.played.label}</strong>
            </p>
            <p>
              <span>Best</span>
              <strong className={choicesDiffer(point.played, point.best) ? "differ" : undefined}>{point.best.label}</strong>
            </p>
          </div>
        ) : null}
        {ready && review ? (
          <>
            <div className="stepper">
              <button type="button" aria-label="Start" disabled={ply === 0} onClick={() => go(0)}>
                «
              </button>
              <button type="button" aria-label="Previous move" disabled={ply === 0} onClick={() => go((ply ?? 0) - 1)}>
                ‹
              </button>
              <span>
                {ply ?? 0} / {review.points.length}
              </span>
              <button type="button" aria-label="Next move" disabled={(ply ?? 0) >= review.points.length} onClick={() => go((ply ?? 0) + 1)}>
                ›
              </button>
              <button type="button" aria-label="End" disabled={(ply ?? 0) >= review.points.length} onClick={() => go(review.points.length)}>
                »
              </button>
            </div>
            <div className="move-strip" ref={stripRef}>
              {review.points.map((item, index) => (
                <button
                  key={item.played.label + String(index)}
                  type="button"
                  aria-label={`Move ${index + 1}, ${item.played.label}`}
                  aria-current={ply === index + 1 ? "true" : undefined}
                  className={choicesDiffer(item.played, item.best) ? "differ" : undefined}
                  onClick={() => go(index + 1)}
                >
                  {item.played.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {finished ? (
          <div className="result-bar">
            <button type="button" onClick={() => void start(game.you ?? "black")}>
              New game
            </button>
            <button type="button" onClick={() => void start(game.you === "white" ? "black" : "white")}>
              Rematch
            </button>
            <button type="button" aria-pressed={review?.done === true} disabled={reading} onClick={() => void analyze()}>
              Analysis
            </button>
          </div>
        ) : null}
        <p className="move-no">{clocks}</p>
        <p className="move-no">{ready && ply === 0 ? "Start" : `Move ${String(state.plies).padStart(2, "0")}`}</p>
        {review?.score ? <p className="score-line">{review.score}</p> : null}
        <p className="note">{note}</p>
        <div className="prisoners">
          <span>Prisoners</span>
          <span className="count">
            <i className="pip black" />
            {String(state.prisoners.black).padStart(2, "0")}
          </span>
          <span className="count">
            <i className="pip white" />
            {String(state.prisoners.white).padStart(2, "0")}
          </span>
        </div>
        {finished ? null : (
          <div className="actions">
            {open ? (
              <button type="button" onClick={() => void sit()}>
                Sit
              </button>
            ) : null}
            <button type="button" disabled={!yours} onClick={() => void send({ kind: "pass" })}>
              Pass
            </button>
            <button type="button" disabled={!yours} onClick={() => void send({ kind: "resign" })}>
              Resign
            </button>
          </div>
        )}
        <p className="link">{`/g/${game.id}`}</p>
      </aside>
    </main>
  );
}

function painted(game: PublicGame, body: Intent): PublicGame {
  if (!game.toPlay) return game;
  const color = game.toPlay;
  const done = body.kind === "resign";
  return {
    ...game,
    phase: done ? "done" : game.phase,
    toPlay: done ? null : opposite(color),
    winner: done ? opposite(color) : game.winner,
    resultReason: done ? "resign" : game.resultReason,
    moves: [
      ...game.moves,
      {
        n: game.moves.length + 1,
        color,
        kind: body.kind,
        x: body.kind === "play" ? body.x : null,
        y: body.kind === "play" ? body.y : null,
      },
    ],
  };
}

function formatGor(before: number | null, after: number | null): string {
  if (before == null || after == null) return "";
  const delta = Math.round(after) - Math.round(before);
  const sign = delta >= 0 ? "+" : "−";
  return `${Math.round(after)}  ${sign}${Math.abs(delta)}`;
}

function titleOf(game: PublicGame): { heading: string; kicker: string } {
  if (game.phase === "done" && game.resultReason === "resign" && game.winner) {
    const resigned: Color = game.winner === "black" ? "white" : "black";
    return { heading: label(game, resigned), kicker: "Resigned" };
  }
  if (game.phase === "done" && game.resultReason === "timeout" && game.winner) {
    return { heading: label(game, game.winner), kicker: "Time" };
  }
  if (game.phase === "done" && game.resultReason === "score") {
    return { heading: game.winner ? label(game, game.winner) : "Jigo", kicker: game.scoreText ?? "Score" };
  }
  if (game.phase === "waiting" && !game.engine) {
    const seated = game.you ?? (game.blackSeated ? "black" : "white");
    return { heading: name(seated), kicker: "Waiting" };
  }
  return { heading: label(game, game.toPlay ?? "black"), kicker: "To play" };
}

function label(game: PublicGame, color: Color) {
  if (game.engine && game.engineColor === color) return game.engine;
  return name(color);
}

function name(color: Color) {
  return color === "black" ? "Black" : "White";
}

function clockOf(game: PublicGame, now: number, receivedAt: number): string {
  const elapsed =
    game.clock.running && game.clock.turnStartedAt != null
      ? game.clock.serverNow - game.clock.turnStartedAt + Math.max(0, now - receivedAt)
      : 0;
  return `${live(game, "black", elapsed)}  ${live(game, "white", elapsed)}`;
}

function live(game: PublicGame, color: Color, elapsed: number): string {
  const main = color === "black" ? game.clock.blackMainMs : game.clock.whiteMainMs;
  const periods = color === "black" ? game.clock.blackPeriods : game.clock.whitePeriods;
  if (game.clock.running && game.toPlay === color) {
    const charged = charge({ mainMs: main, periods }, elapsed);
    const left = charged.periodLeftMs == null ? charged.mainMs : charged.periodLeftMs;
    return `${formatClock(left)}·${charged.periods}`;
  }
  if (main === 0) return `${formatClock(PERIOD_MS)}·${periods}`;
  return `${formatClock(main)}·${periods}`;
}

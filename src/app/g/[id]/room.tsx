"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Board from "@/components/Board";
import { charge, formatClock, PERIOD_MS } from "@/lib/clock";
import type { PublicGame } from "@/lib/play";
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

type Suggestion =
  | { kind: "play"; color: Color; x: number; y: number; label: string }
  | { kind: "pass" | "resign"; color: Color; label: string };

type Analysis = {
  score: string;
  suggestion: Suggestion;
  ratingBefore: number | null;
  ratingAfter: number | null;
};

export default function Room({ id }: { id: string }) {
  const router = useRouter();
  const [game, setGame] = useState<PublicGame | null>(null);
  const [note, setNote] = useState("");
  const [receivedAt, setReceivedAt] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [reading, setReading] = useState(false);
  const [sending, setSending] = useState(false);

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

  const state = useMemo(() => (game ? replay(game.size, game.moves) : null), [game]);

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

  async function analyze() {
    if (reading) return;
    setReading(true);
    try {
      const response = await fetch(`/api/games/${id}/analysis`, { method: "POST" });
      if (!response.ok) return;
      setAnalysis((await response.json()) as Analysis);
    } finally {
      setReading(false);
    }
  }

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
  const hint = analysis?.suggestion.kind === "play" ? { x: analysis.suggestion.x, y: analysis.suggestion.y } : null;
  const rating = formatGor(analysis?.ratingBefore ?? game.ratingBefore, analysis?.ratingAfter ?? game.ratingAfter);

  return (
    <main className="play">
      <div className="stage">
        <Board state={state} interactive={yours} label={title.heading} hint={hint} onPlay={(x, y) => void send({ kind: "play", x, y })} />
      </div>
      <aside className="panel">
        <div className="panel-main">
          <div className="panel-lead">
            <p className="status">
              <span className="status-title">{title.heading}</span>
              <span className="status-kicker">{title.kicker}</span>
            </p>
            {game.engine && game.engine !== title.heading ? <p className="engine-name">{game.engine}</p> : null}
            {finished && rating ? <p className="rating">{rating}</p> : null}
          </div>
          <div className="panel-facts">
            <p className="move-no">{clocks}</p>
            <p className="move-no">Move {String(state.plies).padStart(2, "0")}</p>
            <div className="prisoners">
              <span className="prisoners-label">Prisoners</span>
              <span className="count">
                <i className="pip black" />
                {String(state.prisoners.black).padStart(2, "0")}
              </span>
              <span className="count">
                <i className="pip white" />
                {String(state.prisoners.white).padStart(2, "0")}
              </span>
            </div>
          </div>
          {analysis ? <p className="score-line">{analysis.score}</p> : null}
          {analysis ? <p className="note">{analysis.suggestion.label}</p> : null}
          {reading ? (
            <p className="note" aria-busy="true">
              Reading
            </p>
          ) : null}
          {note ? <p className="note">{note}</p> : null}
        </div>
        {finished ? (
          <div className="result-bar">
            <button type="button" onClick={() => void start(game.you ?? "black")}>
              New game
            </button>
            <button type="button" onClick={() => void start(game.you === "white" ? "black" : "white")}>
              Rematch
            </button>
            <button type="button" onClick={() => void analyze()}>
              Analysis
            </button>
          </div>
        ) : (
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

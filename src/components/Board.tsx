"use client";

import { useEffect, useRef, useState } from "react";
import type { Color, GameState, Point } from "@/lib/rules";

const hoshi: Record<number, Point[]> = {
  19: [
    { x: 3, y: 3 },
    { x: 9, y: 3 },
    { x: 15, y: 3 },
    { x: 3, y: 9 },
    { x: 9, y: 9 },
    { x: 15, y: 9 },
    { x: 3, y: 15 },
    { x: 9, y: 15 },
    { x: 15, y: 15 },
  ],
  13: [
    { x: 3, y: 3 },
    { x: 9, y: 3 },
    { x: 6, y: 6 },
    { x: 3, y: 9 },
    { x: 9, y: 9 },
  ],
  9: [
    { x: 2, y: 2 },
    { x: 6, y: 2 },
    { x: 4, y: 4 },
    { x: 2, y: 6 },
    { x: 6, y: 6 },
  ],
};

function letters(size: number) {
  const alphabet = "ABCDEFGHJKLMNOPQRST";
  return alphabet.slice(0, size).split("");
}

export default function Board({
  state,
  interactive,
  onPlay,
  label,
  hint = null,
}: {
  state: GameState;
  interactive: boolean;
  onPlay?: (x: number, y: number) => void;
  label: string;
  hint?: Point | null;
}) {
  const size = state.size;
  const pad = (1.5 / (size + 2)) * 100;
  const span = 100 - pad * 2;
  const step = size === 1 ? 0 : span / (size - 1);
  const at = (n: number) => pad + n * step;
  const stars = hoshi[size] ?? [];
  const [hover, setHover] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: Math.floor(size / 2), y: Math.floor(size / 2) });
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCursor((point) => ({
      x: Math.min(point.x, size - 1),
      y: Math.min(point.y, size - 1),
    }));
  }, [size]);

  function moveCursor(dx: number, dy: number) {
    setCursor((point) => ({
      x: Math.min(size - 1, Math.max(0, point.x + dx)),
      y: Math.min(size - 1, Math.max(0, point.y + dy)),
    }));
  }

  const cols = letters(size);

  return (
    <div
      ref={root}
      className="board"
      role={interactive ? "grid" : "img"}
      aria-label={label}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "ArrowRight") moveCursor(1, 0);
              else if (event.key === "ArrowLeft") moveCursor(-1, 0);
              else if (event.key === "ArrowDown") moveCursor(0, 1);
              else if (event.key === "ArrowUp") moveCursor(0, -1);
              else if (event.key === "Enter") onPlay?.(cursor.x, cursor.y);
              else return;
              event.preventDefault();
            }
          : undefined
      }
    >
      <svg className="grid" viewBox="0 0 100 100" aria-hidden="true">
        {Array.from({ length: size }, (_, index) => (
          <g key={index}>
            <line x1={at(index)} y1={pad} x2={at(index)} y2={100 - pad} />
            <line x1={pad} y1={at(index)} x2={100 - pad} y2={at(index)} />
          </g>
        ))}
        {stars.map((star) => (
          <circle key={`${star.x},${star.y}`} className="hoshi" cx={at(star.x)} cy={at(star.y)} r={0.55} />
        ))}
      </svg>
      {interactive
        ? cols.map((letter, x) => (
            <span key={`c${letter}`} className="coord x" style={{ left: `${at(x)}%` }}>
              {letter}
            </span>
          ))
        : null}
      {interactive
        ? Array.from({ length: size }, (_, y) => (
            <span key={`r${y}`} className="coord y" style={{ top: `${at(y)}%` }}>
              {size - y}
            </span>
          ))
        : null}
      {Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => {
          const stone = state.board[y][x];
          const last = state.lastMove?.x === x && state.lastMove?.y === y;
          const ghost = interactive && !stone && hover?.x === x && hover?.y === y;
          return (
            <button
              key={`${x},${y}`}
              type="button"
              className="point"
              style={{ left: `${at(x)}%`, top: `${at(y)}%`, width: `${step}%`, height: `${step}%` }}
              data-point={`${x},${y}`}
              data-stone={stone ?? ""}
              data-last={last ? "true" : "false"}
              disabled={!interactive}
              aria-label={`${cols[x]}${size - y}${stone ? ` ${stone}` : ""}`}
              onMouseEnter={() => interactive && setHover({ x, y })}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setCursor({ x, y })}
              onClick={() => interactive && onPlay?.(x, y)}
            >
              {stone ? <Stone color={stone} mark={last} /> : null}
              {ghost ? <span className={`ghost ${state.toPlay}`} /> : null}
              {hint?.x === x && hint?.y === y ? <span className="hint" /> : null}
            </button>
          );
        }),
      )}
    </div>
  );
}

function Stone({ color, mark }: { color: Color; mark: boolean }) {
  return (
    <span className={`stone ${color}${mark ? " last" : ""}`}>
      {mark ? <span className="mark" /> : null}
    </span>
  );
}

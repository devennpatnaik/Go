"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Color } from "@/lib/rules";

const sizes = [9, 13, 19] as const;

export default function Home() {
  const [size, setSize] = useState<(typeof sizes)[number]>(9);
  const [color, setColor] = useState<Color>("black");
  const [opponent, setOpponent] = useState<"gnugo" | "online">("gnugo");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function create() {
    if (pending || opponent !== "gnugo") return;
    setPending(true);
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ size, color, opponent: "gnugo" }),
    });
    if (!response.ok) {
      setPending(false);
      return;
    }
    const game = (await response.json()) as { id: string };
    router.push(`/g/${game.id}`);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      void create();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="launch">
      <h1 className="sr">Go</h1>
      <div className="choices">
        <div role="group" aria-label="Opponent">
          <button type="button" aria-pressed={opponent === "gnugo"} onClick={() => setOpponent("gnugo")}>
            GNU Go
          </button>
          <button type="button" aria-pressed={opponent === "online"} onClick={() => setOpponent("online")}>
            Online
          </button>
        </div>
        <div role="group" aria-label="Color">
          <button type="button" aria-pressed={color === "black"} onClick={() => setColor("black")}>
            Black
          </button>
          <button type="button" aria-pressed={color === "white"} onClick={() => setColor("white")}>
            White
          </button>
        </div>
        <div role="group" aria-label="Board size">
          {sizes.map((value) => (
            <button key={value} type="button" aria-pressed={size === value} onClick={() => setSize(value)}>
              {value}
            </button>
          ))}
        </div>
      </div>
      {opponent === "online" ? <p className="soon">Coming soon</p> : null}
      <button className="start" type="button" disabled={pending || opponent !== "gnugo"} onClick={() => void create()}>
        Play
      </button>
    </main>
  );
}

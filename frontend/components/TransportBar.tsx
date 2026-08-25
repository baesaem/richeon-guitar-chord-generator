"use client";

import { useState } from "react";

interface Props {
  duration: number;
  time: number;
  playing: boolean;
  transpose: number;
  rate: number;
  loop: { a: number; b: number } | null;
  onSeek: (t: number) => void;
  onToggle: () => void;
  onTranspose: (semitones: number) => void;
  onRate: (rate: number) => void;
  onLoop: (loop: { a: number; b: number } | null) => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5];

function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = String(Math.floor(t % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

/** 화면 아래 고정 컨트롤: 음높이 · 빠르기 · 반복 + 탐색/재생 */
export function TransportBar(props: Props) {
  const { duration, time, playing, transpose, rate, loop } = props;
  const [panel, setPanel] = useState<"pitch" | "speed" | "loop" | null>(null);

  const toggle = (p: "pitch" | "speed" | "loop") =>
    setPanel((cur) => (cur === p ? null : p));

  const tabClass = (active: boolean) =>
    [
      "flex-1 rounded-lg py-2 text-sm",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "bg-gray-100 dark:bg-gray-800",
    ].join(" ");

  return (
    <div className="sticky bottom-0 border-t border-gray-200 bg-white px-3 pb-3 pt-2 dark:border-gray-800 dark:bg-black">
      {panel === "pitch" && (
        <div className="mb-2 flex items-center gap-2">
          <button className="rounded bg-gray-100 px-3 py-2 dark:bg-gray-800"
            onClick={() => props.onTranspose(transpose - 1)}>−</button>
          <div className="flex-1 text-center text-sm">
            {transpose === 0 ? "원조" : `${transpose > 0 ? "+" : ""}${transpose} 반음`}
            <span className="ml-2 text-xs text-gray-500">
              {transpose < 0 ? `카포 ${-transpose}` : ""}
            </span>
          </div>
          <button className="rounded bg-gray-100 px-3 py-2 dark:bg-gray-800"
            onClick={() => props.onTranspose(transpose + 1)}>+</button>
          <button className="rounded px-2 py-2 text-xs text-gray-500"
            onClick={() => props.onTranspose(0)}>초기화</button>
        </div>
      )}

      {panel === "speed" && (
        <div className="mb-2 flex gap-1.5">
          {RATES.map((r) => (
            <button
              key={r}
              className={[
                "flex-1 rounded py-2 text-sm",
                r === rate
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-gray-100 dark:bg-gray-800",
              ].join(" ")}
              onClick={() => props.onRate(r)}
            >
              {r}×
            </button>
          ))}
        </div>
      )}

      {panel === "loop" && (
        <div className="mb-2 flex items-center gap-1.5 text-sm">
          <button className="flex-1 rounded bg-gray-100 py-2 dark:bg-gray-800"
            onClick={() => props.onLoop({ a: time, b: loop?.b ?? duration })}>
            A 지정 {loop ? `(${clock(loop.a)})` : ""}
          </button>
          <button className="flex-1 rounded bg-gray-100 py-2 dark:bg-gray-800"
            onClick={() => props.onLoop({ a: loop?.a ?? 0, b: time })}>
            B 지정 {loop ? `(${clock(loop.b)})` : ""}
          </button>
          <button className="rounded px-3 py-2 text-xs text-gray-500"
            onClick={() => props.onLoop(null)}>해제</button>
        </div>
      )}

      <div className="mb-1.5 flex items-center gap-2">
        <button
          className="h-10 w-10 shrink-0 rounded-full bg-black text-white dark:bg-white dark:text-black"
          onClick={props.onToggle}
          aria-label={playing ? "일시정지" : "재생"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">
          {clock(time)}
        </span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={Math.max(duration, 1)}
          step={0.1}
          value={Math.min(time, duration)}
          onChange={(e) => props.onSeek(Number(e.target.value))}
        />
        <span className="w-10 shrink-0 text-xs tabular-nums text-gray-500">
          {clock(duration)}
        </span>
      </div>

      <div className="flex gap-1.5">
        <button className={tabClass(panel === "pitch")} onClick={() => toggle("pitch")}>
          음높이{transpose !== 0 ? ` ${transpose > 0 ? "+" : ""}${transpose}` : ""}
        </button>
        <button className={tabClass(panel === "speed")} onClick={() => toggle("speed")}>
          빠르기{rate !== 1 ? ` ${rate}×` : ""}
        </button>
        <button className={tabClass(panel === "loop")} onClick={() => toggle("loop")}>
          반복{loop ? " ●" : ""}
        </button>
      </div>
    </div>
  );
}

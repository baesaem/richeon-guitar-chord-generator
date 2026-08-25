"use client";

import { useEffect, useRef } from "react";

import { chordIndexAt, type Bar } from "@/lib/bars";
import { labelFor, transposeRoot } from "@/lib/notation";
import type { Chord } from "@/lib/types";

interface Props {
  bars: Bar[];
  chords: Chord[];
  currentBar: number;
  /** 지금 울리는 코드의 인덱스. 마디 안에서 어느 코드가 울리는지 표시한다 */
  currentChord: number;
  flats: boolean;
  transpose: number;
  follow: boolean;
}

interface Span {
  chordIndex: number;
  beats: number;
}

/**
 * 한 마디를 박 단위로 쪼개, 같은 코드가 이어지는 박을 하나로 묶는다.
 *
 * 마디 안에 코드를 그냥 나열하면 "Bbm Ab Db"처럼 붙어 나와 몇 박씩인지 알 수 없다.
 * 박 칸을 차지하는 폭으로 보여주면 실제 악보처럼 읽힌다.
 */
function spansOf(bar: Bar, chords: Chord[]): Span[] {
  const spans: Span[] = [];
  for (const t of bar.beatTimes) {
    const idx = chordIndexAt(chords, t);
    const last = spans[spans.length - 1];
    if (last && last.chordIndex === idx) last.beats += 1;
    else spans.push({ chordIndex: idx, beats: 1 });
  }
  return spans;
}

/** 코드 악보. 마디를 칸으로 놓고 코드가 몇 박씩 이어지는지 폭으로 보여준다. */
export function ChordSheet({
  bars,
  chords,
  currentBar,
  currentChord,
  flats,
  transpose,
  follow,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!follow) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow]);

  return (
    <div className="grid grid-cols-4 gap-1">
      {bars.map((bar, i) => {
        const active = i === currentBar;
        const spans = spansOf(bar, chords);
        const beatCount = bar.beatTimes.length || 1;

        return (
          <div
            key={bar.number}
            ref={active ? activeRef : undefined}
            className={[
              // 한 줄 4칸. 코드 이름이 넉넉히 들어간다.
              "rounded border px-0.5 pb-0.5 pt-1",
              active
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-gray-200 dark:border-gray-700",
            ].join(" ")}
          >
            <div
              className="grid items-center gap-x-0.5"
              style={{ gridTemplateColumns: `repeat(${beatCount}, minmax(0, 1fr))` }}
            >
              {spans.map((span, j) => {
                const chord = chords[span.chordIndex];
                const sounding = active && span.chordIndex === currentChord;
                return (
                  <div
                    key={j}
                    style={{ gridColumn: `span ${span.beats}` }}
                    className={[
                      "min-w-0 truncate text-center text-sm font-bold leading-tight",
                      // 같은 마디 안에서 지금 울리는 코드를 구분한다
                      sounding ? "" : active ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    {chord
                      ? labelFor(transposeRoot(chord.root, transpose), chord.quality, flats)
                      : "·"}
                    {/* 몇 박 이어지는지 점으로 표시 */}
                    {span.beats > 1 && (
                      <span className="ml-0.5 align-middle text-[10px] opacity-40">
                        {"·".repeat(span.beats - 1)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-0.5 text-[10px] leading-none opacity-40">{bar.number}</div>
          </div>
        );
      })}
    </div>
  );
}

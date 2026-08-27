"use client";

import { useEffect, useRef } from "react";

import { ChordLabel } from "@/components/ChordLabel";
import { chordIndexAt, type Bar } from "@/lib/bars";
import { EDIT_HOLD_MS } from "@/lib/editChords";
import { labelFor, transposeRoot } from "@/lib/notation";
import { useLongPress } from "@/lib/useLongPress";
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
  /** 마디를 길게 누르거나 오른쪽 클릭했을 때. 코드 고치기에 쓴다 */
  onEditBar?: (barIndex: number) => void;
  /** 마디를 짧게 눌렀을 때 그 자리로 건너뛴다 */
  onSeek?: (t: number) => void;
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
  onEditBar,
  onSeek,
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
        // 앞 마디에서 이어지는 코드는 이름을 다시 적지 않는다(악보의 % 표기).
        // 코드가 언제 바뀌는지가 한눈에 들어온다.
        const prevLast = i > 0 ? spansOf(bars[i - 1], chords).at(-1)?.chordIndex : undefined;

        return (
          <BarCell
            key={bar.number}
            innerRef={active ? activeRef : undefined}
            active={active}
            onSeek={onSeek ? () => onSeek(bar.start) : undefined}
            onEdit={onEditBar ? () => onEditBar(i) : undefined}
          >
            <div
              className="grid items-center gap-x-0.5"
              style={{ gridTemplateColumns: `repeat(${beatCount}, minmax(0, 1fr))` }}
            >
              {spans.map((span, j) => {
                const chord = chords[span.chordIndex];
                const sounding = active && span.chordIndex === currentChord;
                const carried = j === 0 && span.chordIndex === prevLast;
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
                    {carried ? (
                      // 앞 마디에서 이어지는 중 — 악보의 반복 기호
                      <span className="opacity-30">%</span>
                    ) : chord ? (
                      <ChordLabel
                        label={labelFor(
                          transposeRoot(chord.root, transpose),
                          chord.quality,
                          flats,
                        )}
                      />
                    ) : (
                      "·"
                    )}
                    {/* 몇 박 이어지는지 점으로 표시 */}
                    {!carried && span.beats > 1 && (
                      <span className="ml-0.5 align-middle text-[10px] opacity-40">
                        {"·".repeat(span.beats - 1)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-0.5 text-[10px] leading-none opacity-40">{bar.number}</div>
          </BarCell>
        );
      })}
    </div>
  );
}

/**
 * 마디 칸.
 *
 * 짧게 누르면 그 자리로 건너뛰고, 길게 누르면 코드를 고친다. 누르는 동안
 * 칸이 왼쪽부터 물들어 얼마나 남았는지 보인다 — 이게 없으면 눌러도 아무
 * 일이 없다고 느껴 손을 뗀다.
 */
function BarCell({
  innerRef,
  active,
  onSeek,
  onEdit,
  children,
}: {
  innerRef?: React.Ref<HTMLDivElement>;
  active: boolean;
  onSeek?: () => void;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  const press = useLongPress(() => onEdit?.(), EDIT_HOLD_MS);
  return (
    <div
      ref={innerRef}
      onClick={() => onSeek?.()}
      {...(onEdit ? press.handlers : {})}
      className={[
        // 한 줄 4칸. 코드 이름이 넉넉히 들어간다.
        "relative overflow-hidden rounded border px-0.5 pb-0.5 pt-1",
        onSeek || onEdit ? "cursor-pointer select-none" : "",
        active
          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
          : "border-gray-200 dark:border-gray-700",
      ].join(" ")}
    >
      {press.progress > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--accent)] opacity-25"
          style={{ width: `${press.progress * 100}%` }}
        />
      )}
      <span className="relative block">{children}</span>
    </div>
  );
}

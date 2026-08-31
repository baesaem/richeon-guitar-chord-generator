"use client";

import { ViewSteppers } from "@/components/ViewSteppers";
import { useEffect, useRef, useState } from "react";

import { ChordLabel } from "@/components/ChordLabel";
import { chordIndexAt, type Bar } from "@/lib/bars";
import { EDIT_HOLD_MS } from "@/lib/editChords";
import { labelFor, transposeRoot } from "@/lib/notation";
import { useLongPress } from "@/lib/useLongPress";
import { useSmoothTime } from "@/lib/useSmoothTime";
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
  /** 한 줄에 놓을 칸 수. 0이면 자동(좁으면 4칸, 넓으면 8칸) */
  perRow?: number;
  onPerRow?: (n: number) => void;
  /**
   * 한 번에 보여줄 줄 수. 0이면 곡 전체를 늘어놓는다.
   *
   * 연습실에서는 몇 줄만 띄운다 — 백 마디를 다 늘어놓으면 지금 자리를
   * 눈으로 찾아야 하고, 아래에 가사를 놓을 자리도 없다.
   */
  visibleRows?: number;
  /** 코드 싱크(초) */
  sync?: number;
  onSync?: (sec: number) => void;
  /**
   * 지금 재생 위치(초). 주면 지금 마디 안에서 진행바가 지나간다.
   *
   * 칸이 물드는 것만으로는 마디의 어디쯤인지 알 수 없다 — 네 박 중
   * 몇 박째인지 보여야 따라 칠 수 있다.
   */
  time?: number;
  getTime?: () => number;
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
  perRow = 0,
  onPerRow,
  sync,
  onSync,
  time,
  getTime,
  visibleRows = 0,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const now = useSmoothTime(time ?? 0, getTime);

  /* 몇 줄만 띄우려면 한 줄에 몇 칸인지 알아야 한다. perRow가 0이면
     CSS가 넓이를 보고 정하므로(4칸·8칸) 같은 눈금을 여기서도 본다 */
  const [wideCols, setWideCols] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWideCols(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const cols = perRow || (wideCols ? 8 : 4);
  const rowCount = Math.ceil(bars.length / cols);
  /* 지금 줄이 늘 맨 위에 온다(타브와 같은 규칙) — 눈이 한 자리를 본다.
     곡 끝에서는 마지막 줄들이 보이도록 더 내려가지 않는다 */
  const firstRow = visibleRows
    ? Math.min(
        Math.max(Math.floor(Math.max(currentBar, 0) / cols), 0),
        Math.max(rowCount - visibleRows, 0),
      )
    : 0;
  const lastRow = visibleRows ? firstRow + visibleRows - 1 : rowCount - 1;

  useEffect(() => {
    // 몇 줄만 띄울 때는 화면이 알아서 따라가므로 스크롤할 것이 없다
    if (!follow || visibleRows) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow, visibleRows]);

  return (
    <div>
      {/* 코드악보·멜로디와 같은 조절. 화면을 옮길 때마다 단추를 새로
          찾게 하지 않는다. 여기서 「마디」는 한 줄에 놓는 칸 수다. */}
      {(onSync || onPerRow) && (
        <div className="mb-1.5 flex justify-end text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          <ViewSteppers
            sync={sync}
            onSync={onSync}
            bars={onPerRow ? perRow : undefined}
            onBars={onPerRow}
            barsMax={8}
            barsLabel="자동"
          />
        </div>
      )}
    <div
      className={perRow ? "grid gap-1" : "grid grid-cols-4 gap-1 lg:grid-cols-8"}
      style={perRow ? { gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` } : undefined}
    >
      {bars.map((bar, i) => {
        const row = Math.floor(i / cols);
        if (row < firstRow || row > lastRow) return null;
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
            // 지금 마디 안에서 몇 박째인지 — 시각을 받았을 때만
            progress={
              active && time !== undefined && bar.end > bar.start
                ? Math.min(Math.max((now - bar.start) / (bar.end - bar.start), 0), 1)
                : undefined
            }
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
  progress,
  onSeek,
  onEdit,
  children,
}: {
  innerRef?: React.Ref<HTMLDivElement>;
  active: boolean;
  /** 이 마디를 얼마나 지났는지(0~1). 지금 마디에만 준다 */
  progress?: number;
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
          : "border-[var(--panel-line)]",
      ].join(" ")}
    >
      {press.progress > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--accent)] opacity-25"
          style={{ width: `${press.progress * 100}%` }}
        />
      )}
      {/* 진행바. 칸 바탕이 검게 뒤집히므로 붉은 선이 가장 잘 보인다 */}
      {progress !== undefined && (
        <span
          className="pointer-events-none absolute inset-y-0 w-[2px] bg-red-500"
          style={{ left: `${progress * 100}%` }}
        />
      )}
      <span className="relative block">{children}</span>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

import { chordIndexAt, type Bar } from "@/lib/bars";
import { labelFor, spellKey, transposeRoot } from "@/lib/notation";
import type { Chord } from "@/lib/types";

interface Props {
  bars: Bar[];
  chords: Chord[];
  currentBar: number;
  flats: boolean;
  transpose: number;
  timeSignature: string;
  musicKey: string;
  follow: boolean;
  /** 한 줄에 넣을 마디 수 */
  perLine?: number;
  onSeek?: (t: number) => void;
}

// 좌표계. width는 100%로 늘어나고 viewBox 비율대로 확대된다.
const VB_W = 400;
const PAD_X = 10;
const STAFF_TOP = 34;      // 오선 첫 줄
const LINE_GAP = 7;        // 오선 간격
const STAFF_H = LINE_GAP * 4;
const CHORD_Y = 22;        // 코드 심볼 기준선
const ROW_H = STAFF_TOP + STAFF_H + 14;

/**
 * 코드 악보 (리듬 슬래시 표기).
 *
 * 오선 위에 코드 심볼을 얹고, 박마다 슬래시를 그어 몇 박씩 치는지 보이게 한다.
 * 멜로디는 추출하지 않으므로 음표 대신 슬래시를 쓰는 기타 리듬 악보 형식이다.
 */
export function ChordScore({
  bars,
  chords,
  currentBar,
  flats,
  transpose,
  timeSignature,
  musicKey,
  follow,
  perLine = 6,
  onSeek,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!follow) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow]);

  const lines: Bar[][] = [];
  for (let i = 0; i < bars.length; i += perLine) {
    lines.push(bars.slice(i, i + perLine));
  }

  const [beatsPerBar] = timeSignature.split("/");

  return (
    <div className="space-y-1">
      <div className="text-[11px] text-gray-500">
        조성 {spellKey(musicKey) || "미상"} · 박자 {timeSignature}
      </div>

      {lines.map((line, lineIndex) => {
        const hasActive = line.some((_, i) => lineIndex * perLine + i === currentBar);
        const measureW = (VB_W - PAD_X * 2) / perLine;
        // 한 줄에 마디를 많이 넣을수록 칸이 좁아진다. 코드 심볼이 옆 칸을
        // 침범하지 않도록 글자 크기를 칸 너비에 맞춘다.
        const chordFont = Math.max(6, Math.min(11, measureW * 0.17));
        // 첫 줄 첫 마디에만 박자표 자리를 비운다
        const firstLine = lineIndex === 0;

        return (
          <div key={lineIndex} ref={hasActive ? activeRef : undefined}>
            <svg
              viewBox={`0 0 ${VB_W} ${ROW_H}`}
              className="w-full text-gray-900 dark:text-gray-100"
              role="img"
              aria-label={`${lineIndex * perLine + 1}마디부터`}
            >
              {/* 오선 */}
              {Array.from({ length: 5 }, (_, i) => (
                <line
                  key={i}
                  x1={PAD_X} x2={VB_W - PAD_X}
                  y1={STAFF_TOP + i * LINE_GAP} y2={STAFF_TOP + i * LINE_GAP}
                  stroke="currentColor" strokeWidth={0.6} opacity={0.55}
                />
              ))}

              {line.map((bar, i) => {
                const index = lineIndex * perLine + i;
                const active = index === currentBar;
                const x0 = PAD_X + i * measureW;
                // 첫 줄 첫 마디는 박자표만큼 안쪽에서 시작한다
                const contentX = firstLine && i === 0 ? x0 + 16 : x0 + 3;
                const contentW = x0 + measureW - contentX - 3;
                const beats = bar.beatTimes.length || 1;

                return (
                  <g key={bar.number}>
                    {/* 지금 연주 중인 마디 */}
                    {active && (
                      <rect
                        x={x0} y={STAFF_TOP - 10}
                        width={measureW} height={STAFF_H + 20}
                        fill="currentColor" opacity={0.08}
                      />
                    )}

                    {/* 마디선 */}
                    <line
                      x1={x0} x2={x0}
                      y1={STAFF_TOP} y2={STAFF_TOP + STAFF_H}
                      stroke="currentColor" strokeWidth={0.8} opacity={0.7}
                    />

                    {/* 박자표는 맨 처음에만 */}
                    {firstLine && i === 0 && (
                      <>
                        <text
                          x={x0 + 8} y={STAFF_TOP + LINE_GAP * 1.15}
                          textAnchor="middle" fontSize={9} fontWeight="700"
                          fill="currentColor"
                        >
                          {beatsPerBar}
                        </text>
                        <text
                          x={x0 + 8} y={STAFF_TOP + LINE_GAP * 3.3}
                          textAnchor="middle" fontSize={9} fontWeight="700"
                          fill="currentColor"
                        >
                          4
                        </text>
                      </>
                    )}

                    {/* 박마다 리듬 슬래시 + 코드가 바뀌는 박 위에 코드 심볼 */}
                    {bar.beatTimes.map((t, b) => {
                      const slot = contentX + (contentW * (b + 0.5)) / beats;
                      const idx = chordIndexAt(chords, t);
                      const prevIdx = b === 0 ? -2 : chordIndexAt(chords, bar.beatTimes[b - 1]);
                      const chord = chords[idx];
                      const changed = idx !== prevIdx;

                      return (
                        <g key={b}>
                          <line
                            x1={slot - 2.6} y1={STAFF_TOP + STAFF_H - 1.5}
                            x2={slot + 2.6} y2={STAFF_TOP + 1.5}
                            stroke="currentColor" strokeWidth={1.5}
                            opacity={changed ? 0.85 : 0.35}
                          />
                          {changed && chord && (
                            <text
                              x={slot} y={CHORD_Y}
                              textAnchor="middle" fontSize={chordFont} fontWeight="700"
                              fill="currentColor"
                            >
                              {labelFor(
                                transposeRoot(chord.root, transpose),
                                chord.quality,
                                flats,
                              )}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* 마디 번호 */}
                    <text
                      x={x0 + 2} y={STAFF_TOP - 3}
                      fontSize={5.5} fill="currentColor" opacity={0.4}
                    >
                      {bar.number}
                    </text>

                    {/* 클릭하면 그 마디로 이동 */}
                    <rect
                      x={x0} y={STAFF_TOP - 12}
                      width={measureW} height={STAFF_H + 24}
                      fill="transparent"
                      className={onSeek ? "cursor-pointer" : undefined}
                      onClick={() => onSeek?.(bar.start)}
                    />
                  </g>
                );
              })}

              {/* 줄 끝 마디선 */}
              <line
                x1={VB_W - PAD_X} x2={VB_W - PAD_X}
                y1={STAFF_TOP} y2={STAFF_TOP + STAFF_H}
                stroke="currentColor" strokeWidth={0.8} opacity={0.7}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

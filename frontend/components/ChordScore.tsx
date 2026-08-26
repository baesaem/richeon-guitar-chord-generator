"use client";

import { useEffect, useRef } from "react";

import { chordIndexAt, type Bar } from "@/lib/bars";
import { labelFor, spellKey, transposeRoot } from "@/lib/notation";
import type { Chord } from "@/lib/types";

/** SVG 텍스트 안에서 ♭·♯를 위첨자(tspan)로 올린다. dy는 누적이라 복귀시켜야 한다. */
function svgLabel(label: string): React.ReactNode {
  return label.split(/([♭♯])/).map((part, i) =>
    part === "♭" || part === "♯" ? (
      <tspan key={i} dy="-0.35em" fontSize="70%">
        {part}
        <tspan dy="0.5em" fontSize="1"> </tspan>
      </tspan>
    ) : (
      <tspan key={i}>{part}</tspan>
    ),
  );
}

interface Props {
  bars: Bar[];
  chords: Chord[];
  currentBar: number;
  flats: boolean;
  transpose: number;
  timeSignature: string;
  musicKey: string;
  follow: boolean;
  /**
   * 한 줄에 넣을 마디 수.
   *
   * 4가 표준이다. 대중음악은 4마디·8마디 악구로 짜여 있어 4마디씩 끊으면
   * 한 줄이 한 악구가 되고 줄바꿈이 곡의 구조와 일치한다.
   */
  perLine?: number;
  /**
   * 한 번에 보여줄 줄 수. 지정하면 현재 줄이 맨 위에 오도록 창을 옮긴다.
   * 재생 화면은 2를 써서 「지금 줄 + 다음 줄」만 띄운다 — 스크롤을 쫓지
   * 않아도 눈이 늘 같은 자리를 본다.
   */
  visibleLines?: number;
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
  perLine = 4,
  visibleLines,
  onSeek,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 창 방식일 때는 화면이 알아서 따라오므로 스크롤할 것이 없다
    if (!follow || visibleLines) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow, visibleLines]);

  const lines: Bar[][] = [];
  for (let i = 0; i < bars.length; i += perLine) {
    lines.push(bars.slice(i, i + perLine));
  }

  // 창 방식: 현재 줄부터 visibleLines개만. 현재 줄이 늘 맨 위에 온다.
  const from = visibleLines ? Math.floor(currentBar / perLine) : 0;
  const shown = visibleLines
    ? lines.slice(from, from + visibleLines).map((line, i) => [from + i, line] as const)
    : lines.map((line, i) => [i, line] as const);

  const [beatsPerBar] = timeSignature.split("/");

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>
          조성 {spellKey(musicKey) || "미상"} · 박자 {timeSignature}
        </span>
        {visibleLines && lines.length > visibleLines && (
          <span className="tabular-nums">
            {from + 1}–{Math.min(from + visibleLines, lines.length)} / {lines.length}줄
          </span>
        )}
      </div>

      {shown.map(([lineIndex, line]) => {
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
                      // 마디 첫 박은 앞 마디 끝과 비교한다. 같은 코드가 이어지면
                      // 이름을 다시 적지 않는다 — 바뀌는 자리만 눈에 들어온다.
                      const prevT =
                        b === 0 ? bar.beatTimes[0] - 0.001 : bar.beatTimes[b - 1];
                      const prevIdx = chordIndexAt(chords, prevT);
                      const chord = chords[idx];
                      // 화면에 보이는 첫 마디는 앞을 볼 수 없으니 지금 코드를
                      // 반드시 적어 준다. 그래야 무엇을 짚고 있는지 알 수 있다.
                      const opensView = lineIndex === from && i === 0 && b === 0;
                      const changed = idx !== prevIdx || opensView;

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
                              {svgLabel(
                                labelFor(
                                  transposeRoot(chord.root, transpose),
                                  chord.quality,
                                  flats,
                                ),
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

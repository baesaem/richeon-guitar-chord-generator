"use client";

import { useEffect, useMemo, useRef } from "react";

import { chordIndexAt, type Bar } from "@/lib/bars";
import { labelFor, spellKey, transposeRoot } from "@/lib/notation";
import type { Chord, Note, Strum } from "@/lib/types";

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

// 음이름 → 오선에서 몇 칸 위인지(온음계 자리). 검은건반은 바로 아래 흰건반
// 자리에 ♯을 붙여 적는다.
const DIATONIC_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const IS_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

/** 높은음자리표 맨 아래 줄은 E4다. 그 자리를 0으로 두고 칸 수를 센다. */
function staffStep(midi: number): number {
  const octave = Math.floor(midi / 12) - 1;
  const pc = ((midi % 12) + 12) % 12;
  return octave * 7 + DIATONIC_STEP[pc] - (4 * 7 + 2); // E4 기준
}

interface Props {
  bars: Bar[];
  chords: Chord[];
  /** 보컬에서 딴 멜로디. 있으면 슬래시 대신 음표를 그린다 */
  melody?: Note[];
  /** 스트로크 패턴. 있으면 오선 아래에 ↓↑로 그린다 */
  strums?: Strum[];
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
const STRUM_Y = STAFF_TOP + STAFF_H + 9;   // 오선 아래 스트로크 줄
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
  melody,
  strums,
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

  /**
   * 멜로디를 오선 한가운데로 끌어오는 옥타브 이동.
   *
   * 남성 보컬은 실제 음이 높은음자리표 아래로 한참 내려가 덧줄투성이가 된다.
   * 성악 악보가 테너를 한 옥타브 올려 적는 것과 같은 처리다. 옥타브만
   * 옮기므로 음이름과 선율의 모양은 그대로다.
   */
  const octaveShift = useMemo(() => {
    if (!melody?.length) return 0;
    const sorted = [...melody.map((n) => n.midi)].sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)];
    return Math.round((71 - middle) / 12) * 12; // 71 = B4, 오선 한가운데
  }, [melody]);

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
          {octaveShift !== 0 && (
            <span className="ml-1 text-[var(--accent)]">
              멜로디 {octaveShift > 0 ? "+" : "−"}
              {Math.abs(octaveShift) / 12}옥타브 표기
            </span>
          )}
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

                    {/* 스트로크. 오선 아래에 ↓↑로 언제 쓸어내리고 올리는지 */}
                    {strums?.map((s, k) => {
                      const beatSpan =
                        bar.beatTimes.length > 1
                          ? bar.beatTimes[1] - bar.beatTimes[0]
                          : 0.5;
                      const barEnd =
                        (bar.beatTimes[bar.beatTimes.length - 1] ?? bar.start) + beatSpan;
                      if (s.t < bar.start - 1e-3 || s.t >= barEnd - 1e-3) return null;

                      const span = Math.max(barEnd - bar.start, 1e-6);
                      const x = contentX + (contentW * (s.t - bar.start)) / span;
                      // 세게 친 스트로크를 진하게. 강약이 보이면 리듬이 읽힌다.
                      const weight = 0.45 + s.strength * 0.55;

                      return (
                        <g key={`s${k}`} opacity={weight}>
                          {s.down ? (
                            // ↓ 쓸어내림: 세로줄 + 아래쪽 화살촉
                            <path
                              d={`M${x} ${STRUM_Y - 4} L${x} ${STRUM_Y + 2} M${x - 1.4} ${STRUM_Y} L${x} ${STRUM_Y + 2.2} L${x + 1.4} ${STRUM_Y}`}
                              stroke="currentColor"
                              strokeWidth={0.9}
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          ) : (
                            // ↑ 쓸어올림: 세로줄 + 위쪽 화살촉
                            <path
                              d={`M${x} ${STRUM_Y + 2} L${x} ${STRUM_Y - 4} M${x - 1.4} ${STRUM_Y - 2} L${x} ${STRUM_Y - 4.2} L${x + 1.4} ${STRUM_Y - 2}`}
                              stroke="currentColor"
                              strokeWidth={0.9}
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                        </g>
                      );
                    })}

                    {/* 멜로디 음표. 있으면 이 마디에 걸친 음을 오선에 얹는다 */}
                    {melody?.map((note, k) => {
                      const barEnd = bar.beatTimes.length
                        ? bar.beatTimes[bar.beatTimes.length - 1] +
                          (bar.beatTimes[1] ?? bar.beatTimes[0] + 0.5) -
                          bar.beatTimes[0]
                        : bar.start;
                      if (note.end <= bar.start || note.t >= barEnd) return null;

                      const span = Math.max(barEnd - bar.start, 1e-6);
                      const from = Math.max(note.t, bar.start);
                      const to = Math.min(note.end, barEnd);
                      const x = contentX + (contentW * (from - bar.start)) / span;
                      const w = Math.max(
                        2.2,
                        (contentW * (to - from)) / span - 0.6,
                      );

                      const step = staffStep(note.midi + octaveShift);
                      // 한 칸은 줄 간격의 절반. 위로 갈수록 y가 작아진다.
                      const y = STAFF_TOP + STAFF_H - (step * LINE_GAP) / 2;
                      // 오선을 벗어나면 덧줄을 그어 어느 음인지 알 수 있게 한다
                      const ledgers: number[] = [];
                      for (let s = 10; s <= step; s += 2) ledgers.push(s);
                      for (let s = -2; s >= step; s -= 2) ledgers.push(s);

                      return (
                        <g key={`n${k}`} opacity={0.9}>
                          {ledgers.map((s) => (
                            <line
                              key={s}
                              x1={x - 1.6}
                              x2={x + 3.4}
                              y1={STAFF_TOP + STAFF_H - (s * LINE_GAP) / 2}
                              y2={STAFF_TOP + STAFF_H - (s * LINE_GAP) / 2}
                              stroke="currentColor"
                              strokeWidth={0.5}
                              opacity={0.6}
                            />
                          ))}
                          {/* 길이는 가로 막대로 — 몇 박 끄는 음인지 바로 보인다 */}
                          <rect
                            x={x}
                            y={y - 0.9}
                            width={w}
                            height={1.8}
                            rx={0.9}
                            fill="var(--accent)"
                            opacity={0.35}
                          />
                          <ellipse
                            cx={x + 1.4}
                            cy={y}
                            rx={1.9}
                            ry={1.4}
                            fill="var(--accent)"
                          />
                          {IS_SHARP[((note.midi % 12) + 12) % 12] && (
                            <text
                              x={x - 2.2}
                              y={y + 1.4}
                              fontSize={4}
                              textAnchor="middle"
                              fill="var(--accent)"
                            >
                              ♯
                            </text>
                          )}
                        </g>
                      );
                    })}

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
                            // 멜로디를 얹으면 슬래시는 배경으로 물러난다
                            opacity={(changed ? 0.85 : 0.35) * (melody?.length ? 0.35 : 1)}
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

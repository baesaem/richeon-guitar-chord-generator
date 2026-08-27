"use client";

import { useEffect, useMemo, useRef } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { EDIT_HOLD_MS } from "@/lib/editChords";
import { useLongPress } from "@/lib/useLongPress";
import { arpPattern, arpString } from "@/lib/arpeggio";
import { chordIndexAt, type Bar } from "@/lib/bars";
import { labelFor, transposeRoot } from "@/lib/notation";
import { voicingFor } from "@/lib/voicings";
import { suggestStrum } from "@/lib/strumLibrary";
import type { Chord, Strum } from "@/lib/types";

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
  /** 스트로크. 주 패턴 하나만 뽑아 안내줄에 적는다 */
  strums?: Strum[];
  /** 안내줄에 함께 보일 연주설정(카포·빠르기 등). 바꾼 것만 넘긴다 */
  playNotes?: string[];
  /** 안내줄 오른쪽 끝에 놓을 것(악보보기 버튼 등) */
  headerRight?: React.ReactNode;
  currentBar: number;
  flats: boolean;
  transpose: number;
  timeSignature: string;
  musicKey: string;
  /** 스트로크 패턴 추천에 쓴다 */
  bpm?: number;
  /** 스트로크 표기를 누르면 부른다(다른 패턴 고르기) */
  onPickStrum?: () => void;
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
  /** 마디를 길게 누르거나 오른쪽 클릭했을 때. 코드 고치기에 쓴다 */
  onEditBar?: (barIndex: number) => void;
  /**
   * 주법. 0이면 스트로크(리듬 슬래시), 1~이면 아르페지오 패턴 번호 —
   * 슬래시 대신 8분음표 칸마다 뜯는 줄의 프렛 숫자를 찍고, 숫자가
   * 촘촘해지므로 한 줄을 2마디로 넓힌다.
   */
  arp?: number;
}

// 좌표계. width는 100%로 늘어나고 viewBox 비율대로 확대된다.
const VB_W = 400;
const PAD_X = 10;
const STAFF_TOP = 34;      // 타브 첫 줄(1번줄)
// 타브 여섯 줄. 프렛 숫자가 줄 위에 앉으므로 숫자가 서로 닿지 않을
// 만큼 간격을 벌린다.
const LINE_GAP = 5;
const STAFF_H = LINE_GAP * 5;
const CHORD_Y = 22;        // 코드 심볼 기준선
// 오선 아래 여백. 가사를 적지 않으므로 마디 강조 사각형이 잘리지 않을
// 만큼만 남긴다.
const ROW_H = STAFF_TOP + STAFF_H + 8;

/**
 * 코드 악보 (타브 + 리듬 슬래시).
 *
 * 여섯 줄 타브(맨 위가 1번줄) 위에 코드 심볼을 얹고, 코드가 바뀌는 박에는
 * 그 코드의 운지(프렛 숫자)를 줄 위에 찍는다 — 코드표를 오가지 않아도
 * 악보만 보고 짚을 수 있다. 나머지 박은 슬래시로 리듬만 보인다.
 * 멜로디는 추출하지 않으므로 음표는 없다.
 */
export function ChordScore({
  bars,
  chords,
  strums,
  playNotes,
  headerRight,
  currentBar,
  flats,
  transpose,
  timeSignature,
  musicKey,
  bpm = 0,
  onPickStrum,
  follow,
  perLine = 4,
  visibleLines,
  onSeek,
  onEditBar,
  arp = 0,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  // 아르페지오 모드면 한 줄 2마디 — 마디마다 프렛 숫자 8칸이 들어가므로
  // 4마디씩 넣으면 숫자가 겹쳐 못 읽는다.
  const pattern = arp > 0 ? arpPattern(arp) : null;
  const per = pattern ? Math.min(perLine, 2) : perLine;

  useEffect(() => {
    // 창 방식일 때는 화면이 알아서 따라오므로 스크롤할 것이 없다
    if (!follow || visibleLines) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow, visibleLines]);

  // 이 곡에 어울리는 스트로크 한 가지. 소리에서 그대로 뽑는 대신
  // 표준 패턴 중 실제 연주에 가장 가까운 것을 고른다.
  const strum = useMemo(
    () => suggestStrum(bars, strums, bpm, timeSignature),
    [bars, strums, bpm, timeSignature],
  );

  const lines: Bar[][] = [];
  for (let i = 0; i < bars.length; i += per) {
    lines.push(bars.slice(i, i + per));
  }

  // 창 방식: 현재 줄부터 visibleLines개만. 현재 줄이 늘 맨 위에 온다.
  const from = visibleLines ? Math.floor(currentBar / per) : 0;
  const shown = visibleLines
    ? lines.slice(from, from + visibleLines).map((line, i) => [from + i, line] as const)
    : lines.map((line, i) => [i, line] as const);

  const [beatsPerBar] = timeSignature.split("/");

  return (
    <div className="space-y-0.5">
      <SongInfoLine
        musicKey={musicKey}
        timeSignature={timeSignature}
        strum={strum}
        playNotes={playNotes}
        onPickStrum={onPickStrum}
        right={headerRight}
      >
        {visibleLines && lines.length > visibleLines
          ? `${from + 1}–${Math.min(from + visibleLines, lines.length)} / ${lines.length}줄`
          : ""}
      </SongInfoLine>

      {shown.map(([lineIndex, line]) => {
        const hasActive = line.some((_, i) => lineIndex * per + i === currentBar);
        const measureW = (VB_W - PAD_X * 2) / per;
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
              aria-label={`${lineIndex * per + 1}마디부터`}
            >
              {/* 타브 여섯 줄. 맨 아래(6번줄)는 굵은 줄이라 살짝 두껍게 */}
              {Array.from({ length: 6 }, (_, i) => (
                <line
                  key={i}
                  x1={PAD_X} x2={VB_W - PAD_X}
                  y1={STAFF_TOP + i * LINE_GAP} y2={STAFF_TOP + i * LINE_GAP}
                  stroke="currentColor" strokeWidth={i === 5 ? 0.9 : 0.6}
                  opacity={0.5}
                />
              ))}

              {line.map((bar, i) => {
                const index = lineIndex * per + i;
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
                          x={x0 + 8} y={STAFF_TOP + 7.4}
                          textAnchor="middle" fontSize={9} fontWeight="700"
                          fill="currentColor"
                        >
                          {beatsPerBar}
                        </text>
                        <text
                          x={x0 + 8} y={STAFF_TOP + 20.6}
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
                      // 스트로크: 코드가 바뀌는 박에만 운지를 찍는다(매 박은
                      // 숫자에 파묻힌다). 아르페지오: 매 박이 곧 운지다.
                      const voicing =
                        chord && (pattern || changed)
                          ? voicingFor(
                              transposeRoot(chord.root, transpose),
                              chord.quality,
                            )
                          : null;

                      return (
                        <g key={b}>
                          {pattern && voicing ? (
                            // 아르페지오: 이 박의 8분음표 두 칸에, 패턴이
                            // 뜯는 줄의 프렛 숫자를 찍는다. 엄지(근음)는
                            // 강조색 — 마디의 기둥이 눈에 들어온다.
                            [0, 1].map((half) => {
                              const k = b * 2 + half;
                              const fs =
                                pattern.seq[k % pattern.seq.length] ?? [];
                              const sx =
                                contentX +
                                (contentW * (k + 0.5)) / (beats * 2);
                              return fs.map((f) => {
                                const str = arpString(f, voicing);
                                if (str === null) return null;
                                return (
                                  <text
                                    key={`${half}${f}`}
                                    x={sx}
                                    y={STAFF_TOP + (str - 1) * LINE_GAP + 1.8}
                                    textAnchor="middle"
                                    fontSize={5.2}
                                    fontWeight="700"
                                    fill={
                                      f === "p"
                                        ? "var(--accent)"
                                        : "currentColor"
                                    }
                                    stroke="var(--background)"
                                    strokeWidth={1.4}
                                    paintOrder="stroke"
                                  >
                                    {voicing.frets[6 - str]}
                                  </text>
                                );
                              });
                            })
                          ) : voicing ? (
                            voicing.frets.map((fret, s) =>
                              fret < 0 ? null : (
                                <text
                                  key={s}
                                  x={slot}
                                  // frets[0]이 6번줄(맨 아래 줄)이다
                                  y={STAFF_TOP + (5 - s) * LINE_GAP + 1.6}
                                  textAnchor="middle"
                                  fontSize={5.2}
                                  fontWeight="700"
                                  fill="currentColor"
                                  stroke="var(--background)"
                                  strokeWidth={1.4}
                                  paintOrder="stroke"
                                >
                                  {fret}
                                </text>
                              ),
                            )
                          ) : (
                            <line
                              x1={slot - 2.6} y1={STAFF_TOP + STAFF_H - 1.5}
                              x2={slot + 2.6} y2={STAFF_TOP + 1.5}
                              stroke="currentColor" strokeWidth={1.5}
                              opacity={changed ? 0.85 : 0.35}
                            />
                          )}
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

                    {/* 누르면 그 마디로 이동, 길게 누르면 코드 고치기 */}
                    <BarTarget
                      x={x0} y={STAFF_TOP - 12}
                      width={measureW} height={STAFF_H + 24}
                      onSeek={onSeek ? () => onSeek(bar.start) : undefined}
                      onEdit={onEditBar ? () => onEditBar(index) : undefined}
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


/**
 * 마디를 덮는 투명한 판.
 *
 * 짧게 누르면 그 자리로 건너뛰고, 길게 누르면 코드를 고친다. 재생하면서
 * 고치기 때문에 짧은 탭으로 편집창이 열리면 곤란하다 — 듣던 자리로
 * 돌아가려고 누른 것이 코드 편집으로 이어진다.
 *
 * 누르는 동안 마디가 서서히 물든다. 이게 없으면 눌러도 아무 일이 없다고
 * 느껴 손을 뗀다.
 */
function BarTarget({
  x,
  y,
  width,
  height,
  onSeek,
  onEdit,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  onSeek?: () => void;
  onEdit?: () => void;
}) {
  const press = useLongPress(() => onEdit?.(), EDIT_HOLD_MS);
  return (
    <g>
      {press.progress > 0 && (
        <rect
          x={x}
          y={y}
          width={width * press.progress}
          height={height}
          fill="var(--accent)"
          opacity={0.25}
          pointerEvents="none"
        />
      )}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        className={onSeek || onEdit ? "cursor-pointer" : undefined}
        onClick={() => onSeek?.()}
        {...(onEdit ? press.handlers : {})}
      />
    </g>
  );
}

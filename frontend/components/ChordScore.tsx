"use client";

import { useEffect, useMemo, useRef } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { ViewSteppers } from "@/components/ViewSteppers";
import { EDIT_HOLD_MS } from "@/lib/editChords";
import { useLongPress } from "@/lib/useLongPress";
import { arpPattern, arpString } from "@/lib/arpeggio";
import { chordIndexAt, type Bar } from "@/lib/bars";
import { labelFor, transposeRoot } from "@/lib/notation";
import { voicingFor } from "@/lib/voicings";
import type { LyricLine, PickedBar } from "@/lib/types";
import { PATTERNS, suggestStrum } from "@/lib/strumLibrary";
import { useSmoothTime } from "@/lib/useSmoothTime";
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
  /** 이 곡을 치는 방식 — 「스트로크」 또는 「아르페지오 3」 */
  playStyle?: string;
  /** 안내줄 오른쪽 끝에 놓을 것(악보보기 버튼 등) */
  headerRight?: React.ReactNode;
  currentBar: number;
  /** 지금 재생 위치(초). 마디 안에서 진행 바가 지나간다 */
  time?: number;
  /**
   * 재생 위치를 바로 읽는 길. 바깥의 time은 초당 네 번만 갱신되어
   * 진행 바가 뒤처져 보인다 — 이 창만 제 시계로 매 프레임 따라간다.
   */
  getTime?: () => number;
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
  /** 한 줄 마디 수를 안내줄에서 바꾼다. 없으면 단추를 두지 않는다 */
  onPerLine?: (n: number) => void;
  /** 코드 싱크(초). 악보를 보며 맞추는 것이라 안내줄에 둔다 */
  sync?: number;
  onSync?: (sec: number) => void;
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
   * 슬래시 대신 8분음표 칸마다 뜯는 줄의 프렛 숫자를 찍는다.
   */
  arp?: number;
  /** 직접 고른 스트로크 패턴 이름. 있으면 자동 추천 대신 쓴다 */
  strumName?: string;
  /**
   * 인쇄된 타브 악보에서 읽어 온 마디들. 마디 번호(0부터)로 찾는다.
   *
   * 있는 마디는 코드에서 만들어 낸 운지 대신 **적힌 그대로** 그린다 —
   * 편곡자가 짚으라고 정한 자리다.
   */
  pickedTab?: Record<number, PickedBar>;
  /**
   * 가사. 있으면 마디마다 그 마디에서 부르는 대목을 오선 아래에 적는다.
   * 어느 마디에서 무엇을 부르는지 보이지 않으면, 타브만 보고는 곡의
   * 어디쯤인지 짚기 어렵다.
   */
  lyrics?: LyricLine[];
}

// 좌표계. width는 100%로 늘어나고 viewBox 비율대로 확대된다.
const VB_W = 400;
const PAD_X = 10;
const STAFF_TOP = 34;      // 타브 첫 줄(1번줄)
// 타브 여섯 줄. 프렛 숫자가 줄 위에 앉으므로 숫자가 서로 닿지 않을
// 만큼 간격을 넉넉히 벌린다.
const LINE_GAP = 7;
const STAFF_H = LINE_GAP * 5;
const CHORD_Y = 22;        // 코드 심볼 기준선
// 오선 아래 여백. 가사를 적지 않으므로 마디 강조 사각형이 잘리지 않을
// 만큼만 남긴다.
const ROW_H = STAFF_TOP + STAFF_H + 8;
/** 가사를 적을 때의 줄 높이와 가사 기준선 */
const ROW_H_LYRIC = ROW_H + 9;
const LYRIC_Y = STAFF_TOP + STAFF_H + 12;

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
  playStyle,
  headerRight,
  currentBar,
  time,
  getTime,
  flats,
  transpose,
  timeSignature,
  musicKey,
  bpm = 0,
  onPickStrum,
  follow,
  perLine = 4,
  onPerLine,
  sync,
  onSync,
  visibleLines,
  onSeek,
  onEditBar,
  arp = 0,
  strumName = "",
  pickedTab,
  lyrics,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const now = useSmoothTime(time ?? 0, time === undefined ? undefined : getTime);
  // 아르페지오 모드에서도 한 줄 4마디를 유지한다 — 줄바꿈이 악구와
  // 일치하는 쪽이 숫자가 조금 촘촘한 것보다 낫다.
  const pattern = arp > 0 ? arpPattern(arp) : null;
  const per = perLine;

  useEffect(() => {
    // 창 방식일 때는 화면이 알아서 따라오므로 스크롤할 것이 없다
    if (!follow || visibleLines) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow, visibleLines]);

  // 이 곡에 어울리는 스트로크 한 가지. 직접 고른 패턴이 있으면 그것을,
  // 없으면 표준 패턴 중 실제 연주에 가장 가까운 것을 고른다.
  const strum = useMemo(() => {
    const manual = strumName
      ? PATTERNS.find((p) => p.name === strumName)
      : null;
    if (manual) return { pattern: manual, why: "직접 고른 패턴" };
    return suggestStrum(bars, strums, bpm, timeSignature);
  }, [bars, strums, bpm, timeSignature, strumName]);

  /**
   * 마디마다 그 사이에 부르는 대목.
   *
   * 한 줄의 가사는 여러 마디에 걸쳐 있다. 줄이 걸친 시간 가운데 이 마디가
   * 차지하는 몫만큼 글자를 떼어 온다 — 노래책처럼 마디 밑에 그 마디에서
   * 부르는 글자가 온다. 글자 길이가 시간에 정확히 비례하지는 않지만,
   * 어느 마디에서 어디를 부르는지 짚기에는 넉넉하다.
   */
  const barLyrics = useMemo(() => {
    if (!lyrics?.length) return null;
    const out: string[] = [];
    for (const bar of bars) {
      let text = "";
      for (let i = 0; i < lyrics.length; i++) {
        const ln = lyrics[i];
        const end =
          ln.end > ln.t ? ln.end : (lyrics[i + 1]?.t ?? ln.t + 4);
        if (end <= bar.start || ln.t >= bar.end) continue;
        const span = Math.max(end - ln.t, 0.01);
        const chars = [...ln.text];
        const a = Math.max(0, (bar.start - ln.t) / span);
        const b = Math.min(1, (bar.end - ln.t) / span);
        text += chars
          .slice(Math.round(a * chars.length), Math.round(b * chars.length))
          .join("");
      }
      out.push(text.trim());
    }
    return out;
  }, [lyrics, bars]);

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
      {/* 아르페지오 모드에서는 스트로크 패턴을 숨긴다 — 치지 않는 주법의
          화살표가 안내줄에 남아 있으면 어느 쪽을 따르라는 건지 헷갈린다.
          주법 표시는 playNotes의 「아르페지오 N」이 대신한다. */}
      <SongInfoLine
        musicKey={musicKey}
        timeSignature={timeSignature}
        strum={pattern ? null : strum}
        playNotes={playNotes}
        playStyle={playStyle}
        onPickStrum={pattern ? undefined : onPickStrum}
        right={headerRight}
      >
        <ViewSteppers
          sync={sync}
          onSync={onSync}
          bars={onPerLine ? per : undefined}
          onBars={onPerLine}
          barsMax={8}
        />
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
              viewBox={`0 0 ${VB_W} ${barLyrics ? ROW_H_LYRIC : ROW_H}`}
              className="w-full text-[var(--foreground)]"
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
                // 그림 악보에서 읽어 온 마디면 그것을 그린다
                const picked = pickedTab?.[index];

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

                    {/* 마디선. 타브 여섯 줄 사이에서도 마디 경계가 한눈에
                        들어오게 굵게 긋는다 */}
                    <line
                      x1={x0} x2={x0}
                      y1={STAFF_TOP} y2={STAFF_TOP + STAFF_H}
                      stroke="currentColor" strokeWidth={1.6} opacity={0.8}
                    />

                    {/* 박자표는 맨 처음에만 */}
                    {firstLine && i === 0 && (
                      <>
                        <text
                          x={x0 + 8} y={STAFF_TOP + 10.4}
                          textAnchor="middle" fontSize={9} fontWeight="700"
                          fill="currentColor"
                        >
                          {beatsPerBar}
                        </text>
                        <text
                          x={x0 + 8} y={STAFF_TOP + 29}
                          textAnchor="middle" fontSize={9} fontWeight="700"
                          fill="currentColor"
                        >
                          4
                        </text>
                      </>
                    )}

                    {/* 코드 이름을 적을 자리.
                        한 마디에 둘이면 첫째는 마디 시작선, 둘째는 마디
                        한가운데다 — 박에 맞춰 잘게 놓으면 어느 마디의
                        코드인지 헷갈린다. 셋째부터는 적지 않는다. */}
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
                      // 이 마디에서 몇 번째로 바뀌는 코드인가
                      let rank = 0;
                      if (changed) {
                        for (let k = 0; k < b; k++) {
                          const pk =
                            k === 0 ? bar.beatTimes[0] - 0.001 : bar.beatTimes[k - 1];
                          const opens = lineIndex === from && i === 0 && k === 0;
                          if (chordIndexAt(chords, bar.beatTimes[k]) !== chordIndexAt(chords, pk) || opens) {
                            rank += 1;
                          }
                        }
                      }
                      // 첫째는 마디 시작선에, 둘째는 한가운데에
                      const nameX = rank === 0 ? contentX + 1 : contentX + contentW / 2;
                      const nameAnchor = rank === 0 ? "start" : "middle";
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
                          {picked ? null : pattern && voicing ? (
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
                                    y={STAFF_TOP + (str - 1) * LINE_GAP + 2.4}
                                    textAnchor="middle"
                                    fontSize={7.2}
                                    fontWeight="700"
                                    fill={
                                      f === "p"
                                        ? "var(--accent)"
                                        : "currentColor"
                                    }
                                    stroke="var(--background)"
                                    strokeWidth={1.8}
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
                                  y={STAFF_TOP + (5 - s) * LINE_GAP + 2.4}
                                  textAnchor="middle"
                                  fontSize={7.2}
                                  fontWeight="700"
                                  fill="currentColor"
                                  stroke="var(--background)"
                                  strokeWidth={1.8}
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
                          {/* 코드가 없는 자리(N.C.)는 이름을 적지 않는다 —
                              잡을 것이 없다는 뜻인데 코드처럼 읽힌다 */}
                          {changed &&
                            chord &&
                            rank < 2 &&
                            labelFor(
                              transposeRoot(chord.root, transpose),
                              chord.quality,
                              flats,
                            ) !== "N.C." && (
                              <text
                                x={nameX} y={CHORD_Y}
                                textAnchor={nameAnchor} fontSize={chordFont} fontWeight="700"
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

                    {/* 그림 악보에서 읽어 온 마디. 코드에서 만든 운지 대신
                        적힌 그대로 그린다 */}
                    {picked && (
                      <PickedBarMarks bar={picked} x={contentX} w={contentW} />
                    )}

                    {/* 지금 자리. 멜로디 악보와 같은 진행 바다 —
                        마디만 물들면 마디 안 어디쯤인지 알 수 없다. */}
                    {time !== undefined && now >= bar.start && now < bar.end && (
                      <line
                        x1={x0 + (measureW * (now - bar.start)) / Math.max(bar.end - bar.start, 0.01)}
                        x2={x0 + (measureW * (now - bar.start)) / Math.max(bar.end - bar.start, 0.01)}
                        y1={STAFF_TOP - 8} y2={STAFF_TOP + STAFF_H + 4}
                        stroke="var(--accent)" strokeWidth={0.9} opacity={0.8}
                      />
                    )}

                    {/* 이 마디에서 부르는 대목. 마디 폭에 맞춰 글자를
                        줄인다 — 넘치면 옆 마디 가사와 뒤엉킨다 */}
                    {barLyrics?.[index] && (
                      <text
                        x={x0 + measureW / 2} y={LYRIC_Y}
                        textAnchor="middle"
                        fontSize={Math.max(
                          3.4,
                          Math.min(6, (measureW - 4) / ([...barLyrics[index]].length * 0.95)),
                        )}
                        fill="currentColor" opacity={0.75}
                      >
                        {barLyrics[index]}
                      </text>
                    )}

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
                stroke="currentColor" strokeWidth={1.6} opacity={0.8}
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

/**
 * 그림 타브에서 읽어 온 한 마디.
 *
 * 음표 길이는 옮기지 않는다 — 프렛 숫자와 짚는 차례만 담고, 한 마디
 * 안에 고르게 벌려 놓는다. 훑는 마디는 숫자 대신 코드 한 벌을 앞에 두고
 * 칠 자리마다 손 방향(↓·↑)을 여섯 줄 한가운데에 굵게 적는다.
 */
function PickedBarMarks({ bar, x, w }: { bar: PickedBar; x: number; w: number }) {
  const slots = bar.kind === "pick"
    ? Math.max(1, bar.cols.length)
    : Math.max(1, bar.strokes.length);
  const at = (n: number) => x + (w * (n + 0.5)) / slots;
  const fret = (sx: number, str: number, f: number, key: string) => (
    <text
      key={key}
      x={sx}
      y={STAFF_TOP + (str - 1) * LINE_GAP + 2.4}
      textAnchor="middle" fontSize={7.2} fontWeight="700"
      fill="currentColor" stroke="var(--background)" strokeWidth={1.8}
      paintOrder="stroke"
    >
      {f}
    </text>
  );

  if (bar.kind === "pick") {
    return (
      <>
        {bar.cols.map((col, i) =>
          Object.entries(col).map(([str, f]) =>
            fret(at(i), Number(str), f, `${i}-${str}`),
          ),
        )}
      </>
    );
  }
  return (
    <>
      {Object.entries(bar.chord).map(([str, f]) =>
        fret(x + 2.5, Number(str), f, str),
      )}
      {bar.strokes.split("").map((d, i) => (
        <text
          key={i}
          x={at(i)} y={STAFF_TOP + LINE_GAP * 2.5 + 3.4}
          textAnchor="middle" fontSize={9.5} fontWeight="700"
          fill="currentColor" stroke="var(--background)" strokeWidth={2}
          paintOrder="stroke"
        >
          {d === "D" ? "↓" : "↑"}
        </text>
      ))}
    </>
  );
}

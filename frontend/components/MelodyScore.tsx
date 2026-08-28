"use client";

import { useEffect, useMemo, useRef } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { chordIndexAt, type Bar } from "@/lib/bars";
import { labelFor, transposeRoot } from "@/lib/notation";
import {
  BOTTOM_LINE,
  diatonic,
  fitLyrics,
  keySignature,
  pickOctave,
  SIG_OCTAVE,
  SOLFEGE,
  spellMidi,
  type StaffNote,
} from "@/lib/staff";
import type { Chord, LyricLine, Note } from "@/lib/types";

/** SVG 텍스트 안에서 ♭·♯를 위첨자로 올린다. dy는 누적이라 복귀시켜야 한다. */
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

// 좌표계. ChordScore와 같은 폭을 써서 두 화면의 마디가 같은 자리에 온다.
const VB_W = 400;
const PAD_X = 10;
const STAFF_TOP = 26;      // 오선 맨 윗줄
const LINE_GAP = 7;        // 줄 사이
const STEP = LINE_GAP / 2; // 한 음(도→레) 높이
const STAFF_H = LINE_GAP * 4;
const STAFF_BOT = STAFF_TOP + STAFF_H;
const SOL_Y = STAFF_BOT + 14;   // 계이름
const LYR_Y = STAFF_BOT + 25;   // 가사
const ROW_H = LYR_Y + 6;

/** 음표 머리의 y. 맨 아랫줄이 미4다. */
function noteY(dia: number): number {
  return STAFF_BOT - STEP * (dia - BOTTOM_LINE);
}

/** 자리표·조표가 차지하는 폭 */
const CLEF_W = 25;

interface Props {
  bars: Bar[];
  chords: Chord[];
  /** 보컬에서 딴 멜로디 */
  melody: Note[];
  /** 시간 동기화된 가사. 없으면 음표만 그린다 */
  lyrics?: LyricLine[];
  /** 지금 재생 위치(초). 있으면 그 자리에 세로선을 긋는다 */
  time?: number;
  /** 안내줄에 함께 보일 연주설정(카포·빠르기 등) */
  playNotes?: string[];
  /** 안내줄 오른쪽 끝에 놓을 것 */
  headerRight?: React.ReactNode;
  currentBar: number;
  flats: boolean;
  transpose: number;
  timeSignature: string;
  musicKey: string;
  follow: boolean;
  perLine?: number;
  visibleLines?: number;
  onSeek?: (t: number) => void;
}

/**
 * 멜로디 악보 (오선 + 코드 + 가사).
 *
 * 가요반주기가 보여 주는 화면과 같다 — 오선 위에 코드와 멜로디 음표가
 * 지나가고, 음표 아래에 그 음에 붙는 글자가 놓인다. 코드악보(타브)와
 * 같은 마디 배치를 쓰므로 두 화면을 오가도 자리를 잃지 않는다.
 *
 * 음표 자리는 마디 안에서 실제 부른 시각에 비례한다. 박에 맞춰 8분음표·
 * 4분음표로 반올림하지 않는다 — 기계가 듣고 받아 적은 것이라 반올림하면
 * 틀린 자리가 더 도드라진다.
 */
export function MelodyScore({
  bars,
  chords,
  melody,
  lyrics,
  time,
  playNotes,
  headerRight,
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
  const per = perLine;

  useEffect(() => {
    if (!follow || visibleLines) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow, visibleLines]);

  // 가사를 음표에 얹는 일은 곡을 열 때 한 번이면 된다
  const notes = useMemo(() => fitLyrics(melody, lyrics), [melody, lyrics]);
  // 덧줄이 가장 적은 옥타브. 남자 목소리는 대개 한 옥타브 올려 적는다.
  const octave = useMemo(() => pickOctave(melody), [melody]);
  const sig = useMemo(
    () => keySignature(musicKey, transpose),
    [musicKey, transpose],
  );
  // 조표에 든 음은 음표마다 ♭·♯을 다시 붙이지 않는다
  const sigSet = useMemo(
    () =>
      new Set([
        ...sig.flats.map((l) => `${l}b`),
        ...sig.sharps.map((l) => `${l}#`),
      ]),
    [sig],
  );
  // 음표 이름은 조표를 따른다. 코드 표기 설정(flats)과 섞으면 조표와
  // 어긋난 임시표가 붙는다 — 조표에 ♭이 있는데 음표에 ♯을 다는 식이다.
  const useFlats = sig.useFlats;

  const lines: Bar[][] = [];
  for (let i = 0; i < bars.length; i += per) lines.push(bars.slice(i, i + per));

  const from = visibleLines ? Math.floor(currentBar / per) : 0;
  const shown = visibleLines
    ? lines.slice(from, from + visibleLines).map((line, i) => [from + i, line] as const)
    : lines.map((line, i) => [i, line] as const);

  const [beatsPerBar] = timeSignature.split("/");

  // 오선 위로 얼마나 비워 둘지. 곡마다 가장 높은 음이 다르므로 미리
  // 재어 둔다 — 넉넉히 잡으면 낮은 곡은 위가 텅 비고, 좁게 잡으면 높은
  // 음이 잘린다. 코드 이름은 그 위에 얹는다.
  const topY = useMemo(() => {
    let min = STAFF_TOP;
    for (const n of notes) {
      const y = noteY(diatonic(spellMidi(n.midi + transpose + octave, useFlats)));
      if (y < min) min = y;
    }
    return min - 4;
  }, [notes, transpose, octave, useFlats]);
  const chordY = topY - 2;
  // 마디 번호는 코드 이름 위에 따로 한 줄 — 겹치면 「Cm7」의 7과 마디
  // 번호가 붙어 읽히지 않는다.
  const vbTop = chordY - 13;

  return (
    <div className="space-y-0.5">
      <SongInfoLine
        musicKey={musicKey}
        timeSignature={timeSignature}
        playNotes={playNotes}
        right={headerRight}
      >
        {[
          octave > 0 ? "한 옥타브 올려 적음" : octave < 0 ? "한 옥타브 내려 적음" : "",
          visibleLines && lines.length > visibleLines
            ? `${from + 1}–${Math.min(from + visibleLines, lines.length)} / ${lines.length}줄`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </SongInfoLine>

      {shown.map(([lineIndex, line]) => {
        const hasActive = line.some((_, i) => lineIndex * per + i === currentBar);
        const measureW = (VB_W - PAD_X * 2) / per;
        const chordFont = Math.max(6, Math.min(11, measureW * 0.17));

        return (
          <div key={lineIndex} ref={hasActive ? activeRef : undefined}>
            <svg
              viewBox={`0 ${vbTop} ${VB_W} ${ROW_H - vbTop}`}
              className="w-full text-gray-900 dark:text-gray-100"
              role="img"
              aria-label={`${lineIndex * per + 1}마디부터`}
            >
              {/* 오선 다섯 줄 */}
              {Array.from({ length: 5 }, (_, i) => (
                <line
                  key={i}
                  x1={PAD_X} x2={VB_W - PAD_X}
                  y1={STAFF_TOP + i * LINE_GAP} y2={STAFF_TOP + i * LINE_GAP}
                  stroke="currentColor" strokeWidth={0.6} opacity={0.5}
                />
              ))}

              {/* 높은음자리표. 한 옥타브 올려 적었으면 기타 악보처럼 아래에 8 */}
              <text
                x={PAD_X + 1} y={STAFF_BOT + 1.5}
                fontSize={LINE_GAP * 4.4}
                fontFamily='"Segoe UI Symbol","Apple Symbols","Noto Music","Noto Sans Symbols 2",serif'
                fill="currentColor" opacity={0.75}
              >
                &#119070;
              </text>
              {octave !== 0 && (
                <text
                  x={PAD_X + 6.5} y={STAFF_BOT + 11}
                  textAnchor="middle" fontSize={5} fill="currentColor" opacity={0.6}
                >
                  8
                </text>
              )}

              {/* 조표 */}
              {sig.flats.map((letter, i) => (
                <text
                  key={`f${letter}`}
                  x={PAD_X + 15 + i * 3.6}
                  y={noteY(diatonic({ letter, acc: "b", octave: SIG_OCTAVE.flat[letter] })) + 2.4}
                  fontSize={7.5} fill="currentColor" opacity={0.75}
                >
                  &#9837;
                </text>
              ))}
              {sig.sharps.map((letter, i) => (
                <text
                  key={`s${letter}`}
                  x={PAD_X + 15 + i * 3.6}
                  y={noteY(diatonic({ letter, acc: "#", octave: SIG_OCTAVE.sharp[letter] })) + 2.4}
                  fontSize={7.5} fill="currentColor" opacity={0.75}
                >
                  &#9839;
                </text>
              ))}

              {line.map((bar, i) => {
                const index = lineIndex * per + i;
                const active = index === currentBar;
                const x0 = PAD_X + i * measureW;
                // 첫 마디는 자리표·조표만큼 안쪽에서 시작한다
                const inset = i === 0 ? CLEF_W + (sig.flats.length + sig.sharps.length) * 3.6 : 2;
                const contentX = x0 + inset;
                const contentW = x0 + measureW - contentX - 2;
                const span = Math.max(bar.end - bar.start, 0.01);
                const at = (t: number) =>
                  contentX + (contentW * Math.min(Math.max(t - bar.start, 0), span)) / span;

                return (
                  <g key={bar.number}>
                    {active && (
                      <rect
                        x={x0} y={vbTop}
                        width={measureW} height={ROW_H - vbTop}
                        fill="currentColor" opacity={0.06}
                      />
                    )}

                    {/* 마디선 */}
                    <line
                      x1={x0} x2={x0}
                      y1={STAFF_TOP} y2={STAFF_BOT}
                      stroke="currentColor" strokeWidth={1.6} opacity={0.8}
                    />

                    {/* 박자표는 맨 처음 마디에만 */}
                    {lineIndex === 0 && i === 0 && (
                      <>
                        <text
                          x={contentX - 4} y={STAFF_TOP + LINE_GAP * 1.6}
                          textAnchor="middle" fontSize={7.5} fontWeight="700" fill="currentColor"
                        >
                          {beatsPerBar}
                        </text>
                        <text
                          x={contentX - 4} y={STAFF_TOP + LINE_GAP * 3.6}
                          textAnchor="middle" fontSize={7.5} fontWeight="700" fill="currentColor"
                        >
                          4
                        </text>
                      </>
                    )}

                    {/* 코드 — 이 마디에서 바뀌는 자리마다 */}
                    {bar.chords.map((chord, c) => {
                      const start = Math.max(chord.start, bar.start);
                      // 앞 마디에서 이어지는 코드는 마디 첫머리에 한 번만 적는다
                      const prev = chordIndexAt(chords, start - 0.001);
                      const here = chordIndexAt(chords, start + 0.001);
                      const opensView = lineIndex === from && i === 0 && c === 0;
                      if (prev === here && !opensView && chord.start < bar.start) return null;
                      return (
                        <text
                          key={c}
                          x={at(start)} y={chordY}
                          textAnchor="start" fontSize={chordFont} fontWeight="700"
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
                      );
                    })}

                    {/* 멜로디 음표 + 그 아래 계이름·가사 */}
                    {notes
                      .filter((n) => n.t >= bar.start && n.t < bar.end)
                      .map((n, k) => (
                        <NoteHead
                          key={k}
                          note={n}
                          x={at(n.t)}
                          x2={at(Math.min(n.end, bar.end))}
                          midi={n.midi + transpose + octave}
                          useFlats={useFlats}
                          sigSet={sigSet}
                          now={time !== undefined && time >= n.t && time < n.end}
                        />
                      ))}

                    {/* 지금 자리 */}
                    {time !== undefined && time >= bar.start && time < bar.end && (
                      <line
                        x1={at(time)} x2={at(time)}
                        y1={vbTop + 2} y2={LYR_Y + 2}
                        stroke="var(--accent)" strokeWidth={0.9} opacity={0.8}
                      />
                    )}

                    <text
                      x={x0 + 1.5} y={vbTop + 5}
                      fontSize={5} fill="currentColor" opacity={0.4}
                    >
                      {bar.number}
                    </text>

                    <rect
                      x={x0} y={vbTop}
                      width={measureW} height={ROW_H - vbTop}
                      fill="transparent"
                      className={onSeek ? "cursor-pointer" : undefined}
                      onClick={() => onSeek?.(bar.start)}
                    />
                  </g>
                );
              })}

              <line
                x1={VB_W - PAD_X} x2={VB_W - PAD_X}
                y1={STAFF_TOP} y2={STAFF_BOT}
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
 * 음표 하나 — 덧줄, 임시표, 머리, 기둥, 끈 길이, 계이름, 가사.
 *
 * 계이름을 늘 적는다. 오선을 처음 보는 분에게는 음표의 높낮이보다
 * 「도·레·미」 세 글자가 먼저 읽힌다.
 */
function NoteHead({
  note,
  x,
  x2,
  midi,
  useFlats,
  sigSet,
  now,
}: {
  note: StaffNote;
  x: number;
  x2: number;
  midi: number;
  useFlats: boolean;
  sigSet: Set<string>;
  now: boolean;
}) {
  const sp = spellMidi(midi, useFlats);
  const dia = diatonic(sp);
  const y = noteY(dia);
  const color = now ? "var(--accent)" : "currentColor";
  const ledgers: number[] = [];
  for (let d = BOTTOM_LINE - 2; d >= dia; d -= 2) ledgers.push(noteY(d));
  for (let d = BOTTOM_LINE + 10; d <= dia; d += 2) ledgers.push(noteY(d));

  const key = sp.letter + sp.acc;
  const accidental = sp.acc
    ? sigSet.has(key)
      ? ""
      : sp.acc === "b"
        ? "♭"
        : "♯"
    : sigSet.has(`${sp.letter}b`) || sigSet.has(`${sp.letter}#`)
      ? "♮"
      : "";

  // 오선 가운데(시4)보다 아래면 기둥을 위로 세운다
  const up = dia < BOTTOM_LINE + 4;

  return (
    <g>
      {ledgers.map((ly, i) => (
        <line
          key={i}
          x1={x - 3.6} x2={x + 3.6} y1={ly} y2={ly}
          stroke="currentColor" strokeWidth={0.6} opacity={0.5}
        />
      ))}

      {/* 끈 길이 */}
      {x2 > x + 2.5 && (
        <rect
          x={x + 2.2} y={y - 0.8}
          width={x2 - x - 2.2} height={1.6} rx={0.8}
          fill="var(--accent)" opacity={now ? 0.5 : 0.22}
        />
      )}

      {accidental && (
        <text
          x={x - 5.4} y={y + 2.2}
          fontSize={6} fill="currentColor" opacity={0.8}
        >
          {accidental}
        </text>
      )}

      <line
        x1={x + (up ? 2.3 : -2.3)} x2={x + (up ? 2.3 : -2.3)}
        y1={y} y2={y + (up ? -10 : 10)}
        stroke={color} strokeWidth={0.7}
      />
      <ellipse
        cx={x} cy={y} rx={2.7} ry={2.1}
        fill={color}
        transform={`rotate(-20 ${x} ${y})`}
      />

      <text
        x={x} y={SOL_Y}
        textAnchor="middle" fontSize={4.6}
        fill="var(--accent)" opacity={now ? 1 : 0.7}
      >
        {SOLFEGE[sp.letter]}
      </text>
      {note.syl && (
        <text
          x={x} y={LYR_Y}
          textAnchor="middle" fontSize={6.6} fontWeight="500"
          fill={color}
        >
          {note.syl}
        </text>
      )}
    </g>
  );
}

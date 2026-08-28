"use client";

import { useEffect, useMemo, useRef } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { type Bar } from "@/lib/bars";
import {
  BOTTOM_LINE,
  diatonic,
  keySignature,
  pickOctave,
  SIG_OCTAVE,
  SOLFEGE,
  spellMidi,
  type StaffNote,
} from "@/lib/staff";
import {
  passAt,
  viewFromMelody,
  viewFromScore,
  type ScoreAlign,
  type ScoreData,
  type ViewBar,
  type ViewNote,
} from "@/lib/scoreStaff";
import {
  FONT_STACK,
  GLYPH,
  fontSize,
  flagGlyph,
  headGlyph,
  headWidth,
  restGlyph,
  restLine,
  timeSigDigit,
} from "@/lib/smufl";
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
// 첫머리에 놓이는 것들의 폭(오선 칸 단위). Bravura 글자의 실제 크기다.
const CLEF_W = 2.9;      // 높은음자리표
const SIG_W = 0.92;      // 조표 한 개
const TIME_W = 2.4;      // 박자표
/** 첫머리 여백 */
const HEAD_PAD = 0.5;
/** 음표·쉼표 글자를 표준보다 조금 작게. 칸에 꽉 차면 답답하다 */
const NOTE_SCALE = 0.9;

/** 음표 머리의 y. 맨 아랫줄이 미4다. */
function noteY(dia: number): number {
  return STAFF_BOT - STEP * (dia - BOTTOM_LINE);
}

interface Props {
  /** 음원에서 뽑은 마디. 악보가 없을 때 쓴다 */
  bars: Bar[];
  chords: Chord[];
  /** 보컬에서 딴 멜로디. 악보가 없을 때 쓴다 */
  melody: Note[];
  lyrics?: LyricLine[];
  /** 강사님이 올린 정식 악보. 있으면 이쪽을 그린다 */
  score?: ScoreData | null;
  align?: ScoreAlign | null;
  /** 지금 재생 위치(초) */
  time?: number;
  playNotes?: string[];
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
  /** 관리자에게만 「손볼 마디」 표시를 보인다 */
  showChecks?: boolean;
}

/**
 * 멜로디 악보 (오선 + 코드 + 가사).
 *
 * 가요반주기가 보여 주는 화면과 같다 — 오선 위에 코드와 멜로디 음표가
 * 지나가고, 음표 아래에 그 음에 붙는 글자가 놓인다. 코드악보(타브)와
 * 같은 마디 배치를 쓰므로 두 화면을 오가도 자리를 잃지 않는다.
 *
 * 그릴 것이 두 갈래다. 강사님이 올린 **정식 악보**가 있으면 그것을
 * 그린다 — 음표가 하나도 빠지지 않는다. 없으면 보컬에서 **뽑아낸
 * 멜로디**를 그리는데, 부른 음의 15~30%밖에 잡히지 않아 뼈대만 남는다.
 */
export function MelodyScore({
  bars,
  chords,
  melody,
  lyrics,
  score,
  align,
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
  showChecks = false,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const per = perLine;

  const usingScore = !!(score && align && align.passes.length > 0);
  // 되풀이하는 곡은 악보 한 벌을 여러 번 쓴다. 지금이 몇 바퀴째인지.
  const pass = usingScore ? passAt(align!, time ?? 0) : 0;

  const view = useMemo(
    () =>
      usingScore
        ? viewFromScore(score!, align!, pass, transpose, flats)
        : viewFromMelody(bars, chords, melody, lyrics, transpose, flats),
    [usingScore, score, align, pass, bars, chords, melody, lyrics, transpose, flats],
  );

  // 지금 마디. 시각을 알면 그것으로 찾는다 — 악보를 쓰면 마디 번호가
  // 음원 마디와 달라, 바깥에서 받은 번호를 그대로 쓸 수 없다.
  const barIndex = useMemo(() => {
    if (time === undefined) return currentBar;
    const i = view.bars.findIndex((b) => time >= b.start && time < b.end);
    if (i >= 0) return i;
    if (view.bars.length && time >= view.bars[view.bars.length - 1].end)
      return view.bars.length - 1;
    return 0;
  }, [time, currentBar, view.bars]);

  useEffect(() => {
    if (!follow || visibleLines) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [barIndex, follow, visibleLines]);

  const octave = useMemo(
    () => pickOctave(view.notes.map((n) => ({ t: n.t, end: n.end, midi: n.midi }))),
    [view.notes],
  );
  const sig = useMemo(() => keySignature(musicKey, transpose), [musicKey, transpose]);
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

  const lines: ViewBar[][] = [];
  for (let i = 0; i < view.bars.length; i += per)
    lines.push(view.bars.slice(i, i + per));

  const from = visibleLines ? Math.floor(barIndex / per) : 0;
  const shown = visibleLines
    ? lines.slice(from, from + visibleLines).map((line, i) => [from + i, line] as const)
    : lines.map((line, i) => [i, line] as const);

  const [beatsPerBar] = timeSignature.split("/");

  // 오선 위로 얼마나 비워 둘지. 곡마다 가장 높은 음이 다르므로 미리
  // 재어 둔다 — 넉넉히 잡으면 낮은 곡은 위가 텅 비고, 좁게 잡으면 높은
  // 음이 잘린다. 코드 이름은 그 위에 얹는다.
  const topY = useMemo(() => {
    let min = STAFF_TOP;
    for (const n of view.notes) {
      const y = noteY(diatonic(spellMidi(n.midi + transpose + octave, useFlats)));
      if (y < min) min = y;
    }
    return min - 4;
  }, [view.notes, transpose, octave, useFlats]);
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
          usingScore
            ? align!.passes.length > 1
              ? `악보 ${(align!.passes[pass]?.verse ?? pass) + 1}절`
              : "악보"
            : "",
          octave > 0 ? "한 옥타브 올려 적음" : octave < 0 ? "한 옥타브 내려 적음" : "",
          visibleLines && lines.length > visibleLines
            ? `${from + 1}–${Math.min(from + visibleLines, lines.length)} / ${lines.length}줄`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </SongInfoLine>

      {shown.map(([lineIndex, line]) => {
        const hasActive = line.some((_, i) => lineIndex * per + i === barIndex);
        const measureW = (VB_W - PAD_X * 2) / per;
        const chordFont = Math.max(6, Math.min(11, measureW * 0.17));

        return (
          <div key={lineIndex} ref={hasActive ? activeRef : undefined}>
            <svg
              viewBox={`0 ${vbTop} ${VB_W} ${ROW_H - vbTop}`}
              className="w-full text-gray-900 dark:text-gray-100"
              role="img"
              aria-label={`${line[0]?.number ?? 1}마디부터`}
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

              {/* 높은음자리표. 한 옥타브 올려 적었으면 기타 악보처럼 8을 단다.
                  글자의 기준선이 「솔」 줄(아래에서 둘째)에 놓인다. */}
              <text
                x={PAD_X + HEAD_PAD * LINE_GAP} y={STAFF_TOP + LINE_GAP * 3}
                fontSize={fontSize(LINE_GAP)} fontFamily={FONT_STACK}
                fill="currentColor"
              >
                {octave !== 0 ? GLYPH.clefG8vb : GLYPH.clefG}
              </text>

              {/* 조표 */}
              {sig.flats.map((letter, i) => (
                <text
                  key={`f${letter}`}
                  x={PAD_X + (HEAD_PAD + CLEF_W + i * SIG_W) * LINE_GAP}
                  y={noteY(diatonic({ letter, acc: "b", octave: SIG_OCTAVE.flat[letter] }))}
                  fontSize={fontSize(LINE_GAP)} fontFamily={FONT_STACK}
                  fill="currentColor"
                >
                  {GLYPH.flat}
                </text>
              ))}
              {sig.sharps.map((letter, i) => (
                <text
                  key={`s${letter}`}
                  x={PAD_X + (HEAD_PAD + CLEF_W + i * SIG_W) * LINE_GAP}
                  y={noteY(diatonic({ letter, acc: "#", octave: SIG_OCTAVE.sharp[letter] }))}
                  fontSize={fontSize(LINE_GAP)} fontFamily={FONT_STACK}
                  fill="currentColor"
                >
                  {GLYPH.sharp}
                </text>
              ))}

              {line.map((bar, i) => {
                const index = lineIndex * per + i;
                const active = index === barIndex;
                const x0 = PAD_X + i * measureW;
                // 줄 첫머리에는 자리표·조표가, 곡의 첫 마디에는 박자표까지 선다
                const accs = sig.flats.length + sig.sharps.length;
                const inset =
                  i === 0
                    ? (HEAD_PAD * 2 + CLEF_W + accs * SIG_W +
                       (lineIndex === 0 ? TIME_W : 0.4)) * LINE_GAP
                    : 2;
                const contentX = x0 + inset;
                const contentW = x0 + measureW - contentX - 2;
                const span = Math.max(bar.end - bar.start, 0.01);
                const at = (t: number) =>
                  contentX +
                  (contentW * Math.min(Math.max(t - bar.start, 0), span)) / span;

                return (
                  <g key={`${bar.number}-${i}`}>
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
                          x={contentX - LINE_GAP * 1.3} y={STAFF_TOP + LINE_GAP}
                          textAnchor="middle" fontSize={fontSize(LINE_GAP)}
                          fontFamily={FONT_STACK} fill="currentColor"
                        >
                          {[...beatsPerBar].map((d) => timeSigDigit(Number(d))).join("")}
                        </text>
                        <text
                          x={contentX - LINE_GAP * 1.3} y={STAFF_TOP + LINE_GAP * 3}
                          textAnchor="middle" fontSize={fontSize(LINE_GAP)}
                          fontFamily={FONT_STACK} fill="currentColor"
                        >
                          {[...(timeSignature.split("/")[1] ?? "4")]
                            .map((d) => timeSigDigit(Number(d)))
                            .join("")}
                        </text>
                      </>
                    )}

                    {/* 코드 */}
                    {bar.chords.map((c, k) => (
                      <text
                        key={k}
                        x={at(c.t)} y={chordY}
                        textAnchor="start" fontSize={chordFont} fontWeight="700"
                        fill="currentColor"
                      >
                        {svgLabel(c.label)}
                      </text>
                    ))}

                    {/* 쉼표. 어디서 쉬는지 보이지 않으면 리듬을 읽을 수 없다 */}
                    {bar.rests.map((r, k) => (
                      <Rest key={`r${k}`} x={at(r.t)} value={r.value} dots={r.dots} />
                    ))}

                    {/* 멜로디 음표 + 그 아래 계이름·가사 */}
                    {view.notes.map((n, k) =>
                      n.t >= bar.start && n.t < bar.end ? (
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
                      ) : null,
                    )}

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

                    {/* 가사가 어긋난 마디. 손볼 자리를 강사님에게만 알린다 */}
                    {showChecks && bar.off !== undefined && (
                      <circle
                        cx={x0 + measureW - 3} cy={vbTop + 3.5} r={1.6}
                        fill="#d97706"
                      >
                        <title>{`가사가 ${bar.off > 0 ? "+" : ""}${bar.off}초 어긋납니다`}</title>
                      </circle>
                    )}

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
  note: ViewNote;
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

  // 앞 마디에서 이어진 음은 꼬리만 그린다. 머리를 다시 그리면 같은
  // 음을 두 번 치라는 뜻이 된다.
  if (note.tie) {
    return (
      <rect
        x={x} y={y - 0.8}
        width={Math.max(x2 - x, 1)} height={1.6} rx={0.8}
        fill="var(--accent)" opacity={now ? 0.55 : 0.28}
      />
    );
  }

  const ledgers: number[] = [];
  for (let d = BOTTOM_LINE - 2; d >= dia; d -= 2) ledgers.push(noteY(d));
  for (let d = BOTTOM_LINE + 10; d <= dia; d += 2) ledgers.push(noteY(d));

  const key = sp.letter + sp.acc;
  const accidental = sp.acc
    ? sigSet.has(key)
      ? ""
      : sp.acc === "b"
        ? GLYPH.flat
        : GLYPH.sharp
    : sigSet.has(`${sp.letter}b`) || sigSet.has(`${sp.letter}#`)
      ? GLYPH.natural
      : "";

  // 오선 가운데(시4)보다 아래면 기둥을 위로 세운다
  const up = dia < BOTTOM_LINE + 4;
  // 악보에 적힌 길이. 없으면(뽑아낸 멜로디) 4분음표 모양으로 그린다.
  const value = note.value ?? 1;
  // 음표는 표준 크기의 0.9배. 오선 칸에 꽉 차면 답답해 보인다.
  const size = fontSize(LINE_GAP) * NOTE_SCALE;
  // 기둥은 머리의 가장자리에 붙는다. 머리 폭의 절반이 그 자리다.
  const half = (headWidth(value) * LINE_GAP) / 2;
  const stemX = x + (up ? half - 0.35 : -half + 0.35);
  // 기둥은 3.2칸. 오선 밖의 음은 가운뎃줄까지는 닿게 늘인다 — 악보의 약속이다.
  const middle = noteY(BOTTOM_LINE + 4);
  const plain = y + (up ? -LINE_GAP * 3.2 : LINE_GAP * 3.2);
  const stemY = up ? Math.min(plain, middle) : Math.max(plain, middle);
  const flag = flagGlyph(value, up);

  return (
    <g>
      {ledgers.map((ly, i) => (
        <line
          key={i}
          x1={x - LINE_GAP * 0.9} x2={x + LINE_GAP * 0.9} y1={ly} y2={ly}
          stroke="currentColor" strokeWidth={0.6} opacity={0.5}
        />
      ))}

      {/* 실제로 끈 길이. 적힌 음표 값과 다를 수 있다(붙임줄) */}
      {x2 > x + 2.5 && (
        <rect
          x={x + half} y={y - 0.8}
          width={x2 - x - half} height={1.6} rx={0.8}
          fill="var(--accent)" opacity={now ? 0.5 : 0.2}
        />
      )}

      {accidental && (
        <text
          x={x - half - LINE_GAP * 0.35} y={y}
          textAnchor="end" fontSize={size} fontFamily={FONT_STACK}
          fill="currentColor"
        >
          {accidental}
        </text>
      )}

      {/* 온음표에는 기둥이 없다 */}
      {value < 4 && (
        <line
          x1={stemX} x2={stemX} y1={y} y2={stemY}
          stroke={color} strokeWidth={LINE_GAP * 0.16}
        />
      )}
      {flag && (
        <text
          x={stemX} y={stemY}
          fontSize={size} fontFamily={FONT_STACK} fill={color}
        >
          {flag}
        </text>
      )}

      <text
        x={x} y={y}
        textAnchor="middle" fontSize={size} fontFamily={FONT_STACK} fill={color}
      >
        {headGlyph(value)}
      </text>

      {/* 점음표. 줄 위에 앉은 음은 점을 한 칸 올려 찍는다 */}
      {Array.from({ length: note.dots ?? 0 }, (_, i) => (
        <text
          key={i}
          x={x + half + LINE_GAP * (0.45 + i * 0.45)}
          y={(dia - BOTTOM_LINE) % 2 === 0 ? y - STEP : y}
          fontSize={size} fontFamily={FONT_STACK} fill={color}
        >
          {GLYPH.dot}
        </text>
      ))}

      {/* 잇단음표 표시는 늘 오선 위에. 아래에 두면 계이름·가사와 겹친다. */}
      {note.triplet && (
        <text
          x={x}
          y={Math.min(STAFF_TOP - LINE_GAP * 0.5, y - LINE_GAP * 1.2, stemY - LINE_GAP * 0.4)}
          textAnchor="middle" fontSize={size * 0.6} fontFamily={FONT_STACK}
          fill="currentColor" opacity={0.7}
        >
          {GLYPH.tuplet3}
        </text>
      )}

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

/**
 * 쉼표.
 *
 * 온·2분쉼표는 줄에 걸린 네모, 4분쉼표는 지그재그, 8분 이하는 갈고리다.
 * 유니코드 음악 기호는 기기마다 없는 글꼴이 있어 직접 그린다.
 */
function Rest({ x, value }: { x: number; value: number; dots: number }) {
  return (
    <text
      x={x}
      y={STAFF_TOP + LINE_GAP * restLine(value)}
      textAnchor="middle"
      fontSize={fontSize(LINE_GAP) * NOTE_SCALE}
      fontFamily={FONT_STACK}
      fill="currentColor"
      opacity={0.85}
    >
      {restGlyph(value)}
    </text>
  );
}

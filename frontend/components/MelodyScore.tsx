"use client";

import { useEffect, useMemo, useRef } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { type Bar } from "@/lib/bars";
import {
  BOTTOM_LINE,
  diatonic,
  keySignature,
  pickOctave,
  signatureOf,
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
import { useSmoothTime } from "@/lib/useSmoothTime";
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
const SOL_Y = STAFF_BOT + 10.5; // 계이름
const LYR_Y = STAFF_BOT + 20;   // 가사
const ROW_H = LYR_Y + 4;
// 첫머리에 놓이는 것들의 폭(오선 칸 단위). Bravura 글자의 실제 크기다.
const CLEF_W = 1.9;      // 높은음자리표
const SIG_W = 0.7;      // 조표 한 개
const TIME_W = 1.8;      // 박자표
/** 첫머리 여백 */
const HEAD_PAD = 0.5;
/**
 * 음표·쉼표 글자를 표준보다 작게.
 *
 * 자리는 부른 시각을 따르므로 짧은 음끼리는 원래 가깝다. 표준 크기로
 * 그리면 머리가 서로 닿는다 — 자리를 흔드는 대신 글자를 줄인다.
 */
const NOTE_SCALE = 0.95;
/**
 * 자리표·조표·박자표의 크기.
 *
 * 표준대로 그리면 자리표가 오선을 위아래로 크게 넘친다. 원본 악보를
 * 재어 보니 자리표가 오선 높이의 1.4배쯤이었다 — 낱장 리드시트는
 * 자리표를 작게 쓴다.
 */
const HEAD_SCALE = 0.62;

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
  /**
   * 재생 위치를 바로 읽는 길. 바깥의 time은 초당 네 번만 갱신되어
   * 진행 바가 뒤처져 보인다 — 이 창만 제 시계로 매 프레임 따라간다.
   */
  getTime?: () => number;
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
  /**
   * 악보에 코드가 적혀 있지 않을 때 음원에서 딴 코드를 얹을지.
   * 곡마다 강사님이 켠다 — 그림만으로는 인쇄된 코드가 있는지 알 수 없다.
   */
  autoChords?: boolean;
  /** 음표 아래 계이름(도·레·미)을 적을지. 원본 악보에는 없다 */
  solfege?: boolean;
  onSolfege?: () => void;
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
  time: rawTime,
  getTime,
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
  autoChords = false,
  solfege = false,
  onSolfege,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const per = perLine;
  const hasTime = rawTime !== undefined;
  const time = useSmoothTime(rawTime ?? 0, hasTime ? getTime : undefined);

  const usingScore = !!(score && align && align.passes.length > 0);
  // 되풀이하는 곡은 악보 한 벌을 여러 번 쓴다. 지금이 몇 바퀴째인지.
  const pass = usingScore ? passAt(align!, time ?? 0) : 0;

  const view = useMemo(
    () =>
      usingScore
        ? viewFromScore(
            score!,
            align!,
            pass,
            transpose,
            flats,
            // 악보에 코드가 없을 때 대신 얹을 것. 곡마다 켜 준 때에만
            // 넘긴다 — 인쇄된 코드가 있는 악보에 겹쳐 적으면 안 된다.
            autoChords ? chords : undefined,
          )
        : viewFromMelody(bars, chords, melody, lyrics, transpose, flats),
    [usingScore, score, align, pass, bars, chords, melody, lyrics, transpose, flats, autoChords],
  );

  // 지금 마디. 시각을 알면 그것으로 찾는다 — 악보를 쓰면 마디 번호가
  // 음원 마디와 달라, 바깥에서 받은 번호를 그대로 쓸 수 없다.
  const barIndex = useMemo(() => {
    if (!hasTime) return currentBar;
    const i = view.bars.findIndex((b) => time >= b.start && time < b.end);
    if (i >= 0) return i;
    if (view.bars.length && time >= view.bars[view.bars.length - 1].end)
      return view.bars.length - 1;
    return 0;
  }, [hasTime, time, currentBar, view.bars]);

  useEffect(() => {
    if (!follow || visibleLines) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [barIndex, follow, visibleLines]);

  const octave = useMemo(
    () => pickOctave(view.notes.map((n) => ({ t: n.t, end: n.end, midi: n.midi }))),
    [view.notes],
  );
  // 조표도 악보에 적힌 그대로. 음원의 조(가장조)가 아니라 악보의
  // 조(사장조)를 쓴다 — 옮겨 그리지 않기로 했으므로.
  const sig = useMemo(
    () =>
      usingScore && score
        ? signatureOf(score.fifths + 0)
        : keySignature(musicKey, transpose),
    [usingScore, score, musicKey, transpose],
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
  const vbTop = chordY - 9.5;

  return (
    <div className="space-y-0.5">
      <SongInfoLine
        musicKey={musicKey}
        timeSignature={timeSignature}
        playNotes={playNotes}
        right={headerRight}
      >
        {onSolfege && (
          <button
            className={[
              "shrink-0 rounded px-1.5 py-0.5",
              solfege
                ? "bg-[var(--accent)] text-white"
                : "text-gray-500 underline decoration-dotted underline-offset-2",
            ].join(" ")}
            onClick={onSolfege}
            title="음표 아래에 도·레·미를 적습니다(원본 악보에는 없습니다)"
          >
            계이름
          </button>
        )}
        {[
          usingScore
            ? align!.passes.length > 1
              ? `악보 ${(align!.passes[pass]?.verse ?? pass) + 1}절`
              : "악보"
            : "",
          // 악보를 옮겨 그리지 않으므로, 음원과 맞추려면 카포가 필요하다
          usingScore && align && align.shift > 0
            ? `카포 ${align.shift}프렛`
            : "",
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
        const chordFont = Math.max(5.2, Math.min(9, measureW * 0.145));

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
                fontSize={fontSize(LINE_GAP) * HEAD_SCALE} fontFamily={FONT_STACK}
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
                  fontSize={fontSize(LINE_GAP) * HEAD_SCALE} fontFamily={FONT_STACK}
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
                  fontSize={fontSize(LINE_GAP) * HEAD_SCALE} fontFamily={FONT_STACK}
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
                    // 마디선에 음표 머리가 닿지 않게 한 칸쯤 띄운다
                    : LINE_GAP * 1.15;
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
                          textAnchor="middle" fontSize={fontSize(LINE_GAP) * HEAD_SCALE}
                          fontFamily={FONT_STACK} fill="currentColor"
                        >
                          {[...beatsPerBar].map((d) => timeSigDigit(Number(d))).join("")}
                        </text>
                        <text
                          x={contentX - LINE_GAP * 1.3} y={STAFF_TOP + LINE_GAP * 3}
                          textAnchor="middle" fontSize={fontSize(LINE_GAP) * HEAD_SCALE}
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
                    <BarNotes
                      notes={view.notes.filter(
                        (n) => n.t >= bar.start && n.t < bar.end,
                      )}
                      at={at}
                      barEnd={bar.end}
                      contentX={contentX}
                      contentW={contentW}
                      barBeats={bar.beats}
                      shift={transpose + octave}
                      useFlats={useFlats}
                      sigSet={sigSet}
                      time={hasTime ? time : undefined}
                      solfege={solfege}
                    />

                    {/* 지금 자리 */}
                    {hasTime && time >= bar.start && time < bar.end && (
                      <line
                        x1={at(time)} x2={at(time)}
                        y1={vbTop + 2} y2={LYR_Y + 2}
                        stroke="var(--accent)" strokeWidth={0.9} opacity={0.8}
                      />
                    )}

                    <text
                      x={x0 + 1.5} y={vbTop + 4}
                      fontSize={4.2} fill="currentColor" opacity={0.4}
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
 * 한 마디의 음표들.
 *
 * 8분음표보다 짧은 음이 한 박 안에 이어 나오면 꼬리를 떼고 **이음보**로
 * 묶는다. 인쇄된 악보가 그렇게 하고, 그래야 어디가 한 박인지 눈에
 * 들어온다. 기둥 방향은 묶음 전체가 같아야 하므로 묶음의 평균 높이로
 * 한 번에 정한다.
 */
function BarNotes({
  notes,
  at,
  barEnd,
  contentX,
  contentW,
  barBeats,
  shift,
  useFlats,
  sigSet,
  time,
  solfege,
}: {
  notes: ViewNote[];
  at: (t: number) => number;
  barEnd: number;
  contentX: number;
  contentW: number;
  barBeats?: number;
  shift: number;
  useFlats: boolean;
  sigSet: Set<string>;
  time?: number;
  solfege: boolean;
}) {
  const raw = notes.map((n) => {
    const sp = spellMidi(n.midi + shift, useFlats);
    const dia = diatonic(sp);
    return {
      note: n,
      sp,
      dia,
      x: at(n.t),
      x2: at(Math.min(n.end, barEnd)),
      y: noteY(dia),
      value: n.value ?? 1,
      now: time !== undefined && time >= n.t && time < n.end,
    };
  });

  // 인쇄 악보는 자리를 길이에 **정비례**로 나누지 않는다. 그러면 16분음표
  // 넷이 4분음표 하나만큼만 차지해 머리가 겹친다. 길이의 0.55제곱으로
  // 나누는 것이 오래된 규칙이다 — 짧은 음이 제 몫보다 넉넉히 받는다.
  //
  // 마디 안에서만 나눈다. 마디 경계는 커서가 딛는 자리라 어긋나면 안 된다.
  const xs: number[] = [];
  const beats = barBeats ?? 4;
  const known = raw.length > 0 && raw.every((p) => p.note.beat !== undefined);
  if (known) {
    const spans = raw.map((p, i) => {
      const b = p.note.beat ?? 0;
      const next = i + 1 < raw.length ? (raw[i + 1].note.beat ?? beats) : beats;
      return Math.max(next - b, 0.05);
    });
    const w = spans.map((v) => Math.pow(v, 0.55));
    const total = w.reduce((a, b) => a + b, 0) || 1;
    // 첫 음표가 마디선에 닿지 않게 왼쪽을 조금 비운다
    let acc = 0;
    for (let i = 0; i < raw.length; i++) {
      xs.push(contentX + (contentW * acc) / total);
      acc += w[i];
    }
  } else {
    raw.forEach((p) => xs.push(p.x));
    const minGap = LINE_GAP * 1.4;
    for (let i = 1; i < xs.length; i++) {
      xs[i] = Math.max(xs[i], xs[i - 1] + minGap);
    }
  }

  const placed = raw.map((p, i) => ({
    ...p,
    x: xs[i],
    x2: Math.max(p.x2, xs[i]),
  }));

  // 한 박 안에서 이어지는 짧은 음들을 묶는다. 이어진 음(tie)은 머리가
  // 없으므로 묶음을 끊는다.
  const groups: number[][] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length > 1) groups.push(run);
    run = [];
  };
  placed.forEach((p, i) => {
    // 8분음표보다 짧고, 앞 음에서 이어진 것이 아니어야 묶는다
    const short = p.value <= 0.5 && !p.note.tie && p.note.beat !== undefined;
    if (!short) {
      flush();
      return;
    }
    // 박이 바뀌면 끊는다 — 그래야 어디가 한 박인지 눈에 들어온다
    const sameBeat =
      run.length > 0 &&
      Math.floor(placed[run[0]].note.beat ?? 0) === Math.floor(p.note.beat ?? 0);
    if (run.length && !sameBeat) flush();
    run.push(i);
  });
  flush();

  const inBeam = new Set(groups.flat());

  return (
    <g>
      {groups.map((g, gi) => {
        const first = placed[g[0]];
        const last = placed[g[g.length - 1]];
        // 묶음의 기둥 방향은 하나로. 평균이 가운뎃줄보다 아래면 위로 세운다.
        const mean = g.reduce((sum, i) => sum + placed[i].dia, 0) / g.length;
        const up = mean < BOTTOM_LINE + 4;
        const tips = g.map((i) => {
          const p = placed[i];
          return p.y + (up ? -LINE_GAP * 3.3 : LINE_GAP * 3.3);
        });
        const y0 = up ? Math.min(...tips) : Math.max(...tips);
        const y1 = y0;
        const beams = Math.max(
          ...g.map((i) => Math.round(Math.log2(0.5 / placed[i].value)) + 1),
        );
        const half = (headWidth(1) * LINE_GAP) / 2 - 0.35;
        const bx0 = first.x + (up ? half : -half);
        const bx1 = last.x + (up ? half : -half);

        return (
          <g key={`b${gi}`}>
            {g.map((i) => {
              const p = placed[i];
              const sx = p.x + (up ? half : -half);
              return (
                <line
                  key={i}
                  x1={sx} x2={sx} y1={p.y} y2={y0}
                  stroke={p.now ? "var(--accent)" : "currentColor"}
                  strokeWidth={LINE_GAP * 0.16}
                />
              );
            })}
            {Array.from({ length: beams }, (_, b) => (
              <line
                key={b}
                x1={bx0} x2={bx1}
                y1={y0 + (up ? 1 : -1) * b * LINE_GAP * 0.62}
                y2={y1 + (up ? 1 : -1) * b * LINE_GAP * 0.62}
                stroke="currentColor"
                strokeWidth={LINE_GAP * 0.5}
                strokeLinecap="butt"
              />
            ))}
          </g>
        );
      })}

      {placed.map((p, i) => (
        <NoteHead
          key={i}
          note={p.note}
          x={p.x}
          x2={p.x2}
          midi={p.note.midi + shift}
          useFlats={useFlats}
          sigSet={sigSet}
          now={p.now}
          beamed={inBeam.has(i)}
        />
      ))}
    </g>
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
  beamed = false,
  solfege = false,
}: {
  note: ViewNote;
  x: number;
  x2: number;
  midi: number;
  useFlats: boolean;
  sigSet: Set<string>;
  now: boolean;
  /** 이음보로 묶인 음표인가. 기둥과 꼬리는 묶음이 그린다 */
  beamed?: boolean;
  solfege?: boolean;
}) {
  const sp = spellMidi(midi, useFlats);
  const dia = diatonic(sp);
  const y = noteY(dia);
  const color = now ? "var(--accent)" : "currentColor";

  // 앞 마디에서 이어진 음. 머리를 다시 그리면 같은 음을 두 번 치라는
  // 뜻이 되므로, 원본처럼 **이음줄**만 그어 소리가 이어짐을 보인다.
  if (note.tie) {
    const end = Math.max(x2, x + LINE_GAP);
    return (
      <path
        d={`M ${x} ${y + 2.4} Q ${(x + end) / 2} ${y + LINE_GAP * 1.1} ${end} ${y + 2.4}`}
        fill="none"
        stroke={now ? "var(--accent)" : "currentColor"}
        strokeWidth={0.7}
        opacity={now ? 0.9 : 0.5}
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
  // 기둥은 3.3칸 — 인쇄 악보의 표준(3.5칸)에 가깝게. 표준은 3.5칸이지만 여기는 오선이 작고 줄이 촘촘해
  // 길면 위아래로 답답해 보인다. 오선 밖의 음은 가운뎃줄까지 닿게 한다.
  const middle = noteY(BOTTOM_LINE + 4);
  const plain = y + (up ? -LINE_GAP * 3.3 : LINE_GAP * 3.3);
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

      {/* 끈 길이는 **악보가 없을 때만** 그린다. 악보에서 온 음표는 값
          자체가 길이를 말하므로(온음표·점2분음표…) 또 그리면 군더더기다. */}
      {note.value === undefined && x2 > x + LINE_GAP && (
        <path
          d={`M ${x + half} ${y + (up ? 2 : -2)} Q ${(x + x2) / 2} ${
            y + (up ? LINE_GAP * 0.9 : -LINE_GAP * 0.9)
          } ${x2} ${y + (up ? 2 : -2)}`}
          fill="none"
          stroke={now ? "var(--accent)" : "currentColor"}
          strokeWidth={0.7}
          opacity={now ? 0.8 : 0.35}
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

      {/* 온음표에는 기둥이 없다. 묶인 음표는 묶음이 기둥을 그린다 */}
      {value < 4 && !beamed && (
        <line
          x1={stemX} x2={stemX} y1={y} y2={stemY}
          stroke={color} strokeWidth={LINE_GAP * 0.16}
        />
      )}
      {flag && !beamed && (
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

      {/* 잇단음표는 괄호와 숫자로. 원본이 그렇게 적고, 숫자만 있으면
          어디까지가 한 묶음인지 보이지 않는다. 늘 오선 위에 둔다 —
          아래에 두면 계이름·가사와 겹친다. */}
      {note.triplet && (
        <Tuplet
          x={x}
          width={(note.tupletBeats ?? 1) * LINE_GAP * 3.2}
          y={Math.min(STAFF_TOP - LINE_GAP * 0.7, y - LINE_GAP * 1.4, stemY - LINE_GAP * 0.5)}
          size={size}
        />
      )}

      {/* 계이름은 원본 악보에 없다. 켤 때만 적는다. */}
      {solfege && (
        <text
          x={x} y={SOL_Y}
          textAnchor="middle" fontSize={4.6}
          fill="var(--accent)" opacity={now ? 1 : 0.8}
        >
          {SOLFEGE[sp.letter]}
        </text>
      )}
      {note.syl && (
        <text
          x={x} y={LYR_Y}
          textAnchor="middle" fontSize={6.4} fontWeight="500"
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

/** 잇단음표 괄호 — ⌐3¬ */
function Tuplet({
  x,
  width,
  y,
  size,
}: {
  x: number;
  width: number;
  y: number;
  size: number;
}) {
  const half = Math.max(width, LINE_GAP * 2) / 2;
  const drop = LINE_GAP * 0.45;
  return (
    <g opacity={0.7}>
      <path
        d={`M ${x - half} ${y + drop} L ${x - half} ${y} L ${x - LINE_GAP * 0.55} ${y}
            M ${x + LINE_GAP * 0.55} ${y} L ${x + half} ${y} L ${x + half} ${y + drop}`}
        fill="none" stroke="currentColor" strokeWidth={0.5}
      />
      <text
        x={x} y={y + LINE_GAP * 0.42}
        textAnchor="middle" fontSize={size * 0.55} fontFamily={FONT_STACK}
        fill="currentColor"
      >
        {GLYPH.tuplet3}
      </text>
    </g>
  );
}

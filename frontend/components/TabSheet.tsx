"use client";

import { useEffect, useMemo, useRef } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { ViewSteppers } from "@/components/ViewSteppers";
import type { SongChordResult } from "@/lib/abcChords";
import type { Bar } from "@/lib/bars";
import { barIndexAt } from "@/lib/bars";
import type { TabScore } from "@/lib/msczToAbc";
import { shiftChordLabel } from "@/lib/notation";
import type { StrumChoice } from "@/lib/strumLibrary";
import type { LyricLine } from "@/lib/types";
import { useSmoothTime } from "@/lib/useSmoothTime";

/*
 * 타브 악보를 처음부터 우리가 그린다.
 *
 * 예전에는 abcjs에게 오선 악보를 그리게 하고, 그 아래 덧붙는 타브만
 * 남기고 나머지를 가렸다. 가려 둔 오선 위에 얹혀 있으니 마디 너비도
 * 숫자 간격도 오선의 사정을 따랐다 — 음표 머리가 없는 타브에서는
 * 숫자가 뭉쳤다 벌어졌다 하여 어느 자리에 짚는지 눈으로 셀 수 없었다.
 * 그려 놓고 다시 밀어 고치느니 여섯 줄을 우리가 긋는다.
 *
 * 숫자와 줄은 악보 파일에 적힌 그대로다(fret·string). 카포는 손가락
 * 자리를 바꾸지 않으므로 이조하지 않는다.
 */

/** 한 줄에 넣는 마디 수. 종이 악보와 같게 넷 */
const PER_LINE = 4;
/**
 * 그림 좌표계의 너비. 화면 폭에 맞춰 늘어난다.
 *
 * 좁게 잡을수록 화면에서 크게 그려진다 — 660이면 손전화 폭에서 숫자가
 * 거의 제 크기로 나온다. 작아 안 보이면 여기를 줄인다.
 */
const W = 660;
/** 왼쪽 여백 */
const LEFT = 18;
/** 줄과 줄 사이 */
const GAP = 13;
/** 여섯 줄의 높이 */
const STAFF = GAP * 5;
/**
 * 여섯 줄 위 — 마디 번호·코드·1·2번 괄호·세뇨가 차례로 앉는 자리.
 *
 * 셋이 층을 이룬다. 좁게 잡으면 괄호 선이 코드 이름을 가로질러 「Cm」이
 * 「m」으로 보인다 — 각자 제 띠를 갖도록 넉넉히 둔다.
 */
const HEAD = 58;
/** 여섯 줄 아래 — 가사가 앉는 자리 */
const FOOT = 40;
/** 한 줄이 차지하는 높이 */
const ROW = HEAD + STAFF + FOOT;

interface Props {
  score: TabScore;
  /** 음원에서 딴 마디 격자. 커서를 여기에 맞춘다 */
  bars: Bar[];
  time: number;
  /** 매 프레임 위치를 묻는 함수. 있으면 커서가 부드럽게 흐른다 */
  getTime?: () => number;
  /**
   * 음원 마디 번호 → 악보 마디 번호(1부터).
   *
   * 도돌이를 돌면 음원 마디는 계속 느는데 악보는 같은 마디를 다시
   * 부른다 — 이 표가 있어야 커서가 되돌아갈 자리를 안다.
   */
  scoreBarNumbers?: Record<number, number>;
  /** 악보 첫 마디가 음원의 몇 번째 마디인지 */
  barOffset?: number;
  sync?: number;
  onSync?: (sec: number) => void;
  onShiftBar?: (delta: number) => void;
  headerRight?: React.ReactNode;
  musicKey: string;
  timeSignature: string;
  playNotes?: string[];
  strum?: StrumChoice | null;
  onPickStrum?: () => void;
  playStyle?: string;
  chordNote?: SongChordResult | null;
  /**
   * 코드 이름을 옮길 반음 수. 프렛 숫자는 옮기지 않는다.
   *
   * 카포는 짚는 자리를 바꾸지 않으므로 숫자는 적힌 그대로다. 그러나
   * 이름은 다른 화면과 같아야 한다 — 멜로디가 Gm이라 부르는 자리를
   * 타브가 Em이라 부르면 서로 짚어 말할 수가 없다.
   */
  chordShift?: number;
  /** ♭로 적을지 ♯로 적을지. 곡의 조를 보고 앱이 정한 값 */
  flats?: boolean;
  /** 이 곡의 가사. 악보의 음절에 띄어쓰기를 되살리는 데 쓴다 */
  lyrics?: LyricLine[];
}

/**
 * 악보의 음절에 띄어쓰기를 되살린다.
 *
 * 뮤즈스코어는 음표마다 한 음절씩 적을 뿐, 어디서 낱말이 끝나는지
 * 적어 두지 않는다(이 악보에는 syllabic이 하나도 없다). 그대로 이으면
 * 「이제모두세월따라」가 된다. 곡에 딸린 가사에는 띄어쓰기가 살아
 * 있으니, 마디의 음절을 거기서 찾아 그 자리의 빈칸을 옮겨 온다.
 *
 * 못 찾은 마디는 악보에 적힌 대로 둔다 — 지어내지 않는다.
 */
function spaceLyrics(raw: string[], lines: LyricLine[] | undefined): string[] {
  if (!lines?.length) return raw.map((one) => one ?? "");
  const letters: string[] = [];
  const gapAfter: boolean[] = [];
  for (const ch of lines.map((l) => l.text).join(" ")) {
    if (/\s/.test(ch)) {
      if (letters.length) gapAfter[letters.length - 1] = true;
    } else {
      letters.push(ch);
      gapAfter.push(false);
    }
  }
  const flat = letters.join("");
  let from = 0;
  return raw.map((one) => {
    // 예전에 담아 둔 악보에는 2절 칸이 아예 없다 — 없는 것은 빈 줄이다
    const syls = (one ?? "").replace(/\s+/g, "");
    if (!syls) return "";
    let at = flat.indexOf(syls, from);
    // 도돌이를 돌면 같은 말이 다시 나온다 — 앞에서 다시 찾는다
    if (at < 0) at = flat.indexOf(syls);
    if (at < 0) return one ?? "";
    let out = "";
    for (let k = 0; k < syls.length; k++) {
      out += flat[at + k];
      if (gapAfter[at + k] && k + 1 < syls.length) out += " ";
    }
    from = at + syls.length;
    return out;
  });
}

/** 마디 안에서 자리마다 언제 시작하는가(0~1). 박 길이대로 잰다 */
function offsets(units: number[]): number[] {
  const total = units.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  let at = 0;
  for (const u of units) {
    out.push(at / total);
    at += u;
  }
  return out;
}

export function TabSheet({
  score,
  bars,
  time,
  getTime,
  scoreBarNumbers,
  barOffset = 0,
  sync = 0,
  onSync,
  onShiftBar,
  headerRight,
  musicKey,
  timeSignature,
  playNotes,
  strum,
  onPickStrum,
  playStyle,
  chordNote,
  chordShift = 0,
  flats = false,
  lyrics,
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 지금 치는 줄의 자리표. 창을 굴려 이 자리를 가운데로 끌어온다 */
  const markRef = useRef<SVGRectElement | null>(null);
  /* 재생 중에는 매 프레임 자리를 묻는다 — 상태로만 따라가면 커서가
     마디마다 툭툭 끊겨 보인다. 다른 악보 화면과 같은 시계를 쓴다 */
  const now = useSmoothTime(time, getTime);

  const words = useMemo(
    () => spaceLyrics(score.bars.map((b) => b.lyric), lyrics),
    [score.bars, lyrics],
  );
  /* 2절은 1절 아래 줄에. 도돌이를 돌 때 부르는 말이라 같은 마디에 둘이
     붙는다 — 위아래로 놓아야 어느 것이 몇 절인지 안다 */
  const words2 = useMemo(
    () => spaceLyrics(score.bars.map((b) => b.lyric2), lyrics),
    [score.bars, lyrics],
  );

  const rows = Math.max(Math.ceil(score.bars.length / PER_LINE), 1);
  const height = rows * ROW + 16;
  const barW = (W - LEFT * 2) / PER_LINE;

  /** 마디 j가 그림의 어디에 놓이는가 */
  const placeOf = (j: number) => {
    const row = Math.floor(j / PER_LINE);
    return {
      row,
      x: LEFT + (j % PER_LINE) * barW,
      w: barW,
      top: 24 + row * ROW + HEAD,
    };
  };

  /** 지금 울리는 악보 마디와 그 마디 안에서의 진행(0~1) */
  const at = useMemo(() => {
    if (!bars.length) return null;
    const i = barIndexAt(bars, now);
    const bar = bars[i];
    if (!bar) return null;
    const span = bar.end - bar.start;
    const f = span > 0 ? Math.min(Math.max((now - bar.start) / span, 0), 1) : 0;
    const no = scoreBarNumbers?.[i];
    const j = no !== undefined ? no - 1 : i - barOffset;
    if (!(j >= 0 && j < score.bars.length)) return null;
    return { bar: j, f };
  }, [bars, now, scoreBarNumbers, barOffset, score.bars.length]);

  const liveRow = at ? Math.floor(at.bar / PER_LINE) : -1;

  /*
   * 지금 치는 줄을 창 가운데쯤에 붙들어 둔다.
   *
   * 줄이 창 아래끝에 걸리면 다음에 짚을 자리가 화면 밖에 있어, 눈이
   * 악보를 앞질러 갈 수가 없다 — 손은 이미 그리로 가고 있는데. 줄이
   * 위로 지나갔거나 아래끝에 닿으려 하면 위쪽 3할 자리로 끌어올린다.
   */
  useEffect(() => {
    const mark = markRef.current;
    if (!mark || liveRow < 0) return;
    const seen = mark.getBoundingClientRect();
    const vh = window.innerHeight;
    if (!(vh > 0)) return;
    /* 무엇이 굴러가는지 우리가 고르지 않는다 — 창일 수도, 악보 칸일
       수도, 그 사이 어떤 칸일 수도 있다. 브라우저에게 맡기면 굴러가는
       것을 알아서 찾아 준다 */
    if (seen.top < vh * 0.12 || seen.bottom > vh * 0.82)
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [liveRow]);

  const staves: React.ReactNode[] = [];
  const ink: React.ReactNode[] = [];
  const marks: React.ReactNode[] = [];

  // ---- 여섯 줄 ----
  for (let r = 0; r < rows; r++) {
    const top = 24 + r * ROW + HEAD;
    for (let k = 0; k < 6; k++)
      staves.push(
        <line
          key={`l${r}.${k}`}
          x1={LEFT}
          x2={W - LEFT}
          y1={top + k * GAP}
          y2={top + k * GAP}
          stroke="var(--tab-line)"
          strokeWidth={0.8}
        />,
      );
  }

  // ---- 마디마다 ----
  score.bars.forEach((bar, j) => {
    const p = placeOf(j);
    const right = p.x + p.w;
    const y0 = p.top;
    const y1 = p.top + STAFF;

    // 마디를 닫는 세로줄
    ink.push(
      <line
        key={`b${j}`}
        x1={bar.endRepeat ? right - 1.4 : right}
        x2={bar.endRepeat ? right - 1.4 : right}
        y1={y0}
        y2={y1}
        stroke="var(--tab-line)"
        strokeWidth={bar.endRepeat ? 2.8 : 1}
      />,
    );
    if (bar.endRepeat)
      ink.push(
        <g key={`er${j}`} fill="var(--tab-ink)">
          <circle cx={right - 8} cy={y0 + GAP * 1.5} r={2.2} />
          <circle cx={right - 8} cy={y0 + GAP * 3.5} r={2.2} />
        </g>,
      );
    // 마디를 여는 세로줄. 도돌이 시작이면 굵게 긋고 점을 찍는다
    if (bar.startRepeat)
      ink.push(
        <g key={`sr${j}`} fill="var(--tab-ink)">
          <line
            x1={p.x + 1.4}
            x2={p.x + 1.4}
            y1={y0}
            y2={y1}
            stroke="var(--tab-line)"
            strokeWidth={2.8}
          />
          <circle cx={p.x + 8} cy={y0 + GAP * 1.5} r={2.2} />
          <circle cx={p.x + 8} cy={y0 + GAP * 3.5} r={2.2} />
        </g>,
      );
    else if (j % PER_LINE === 0)
      ink.push(
        <line
          key={`o${j}`}
          x1={p.x}
          x2={p.x}
          y1={y0}
          y2={y1}
          stroke="var(--tab-line)"
          strokeWidth={1}
        />,
      );

    // 마디 번호 — 마디 왼쪽 위 구석에 작게
    marks.push(
      <text key={`n${j}`} x={p.x + 3} y={y0 - 5} fontSize={9} fill="var(--tab-dim)">
        {j + 1}
      </text>,
    );

    // 1·2번 괄호
    if (bar.volta)
      marks.push(
        <g key={`v${j}`}>
          <path
            d={`M ${p.x + 1} ${y0 - 33} L ${p.x + 1} ${y0 - 43} L ${right - 2} ${y0 - 43}`}
            stroke="var(--tab-line)"
            strokeWidth={1}
            fill="none"
          />
          <text x={p.x + 6} y={y0 - 35} fontSize={9} fill="var(--tab-ink)">
            {bar.volta}.
          </text>
        </g>,
      );

    // 세뇨·코다·달세뇨
    if (bar.marks.length)
      marks.push(
        <text
          key={`m${j}`}
          x={p.x + 14}
          y={y0 - 47}
          fontSize={13}
          fontWeight={700}
          fill="var(--tab-ink)"
        >
          {bar.marks.join(" ")}
        </text>,
      );

    // 가사 — 마디 아래 가운데
    [words[j], words2[j]].forEach((line, v) => {
      if (!line) return;
      marks.push(
        <text
          key={`w${j}.${v}`}
          x={p.x + p.w / 2}
          y={y1 + 18 + v * 14}
          fontSize={12}
          fontWeight={700}
          textAnchor="middle"
          fill={v === 0 ? "var(--tab-ink)" : "var(--tab-dim)"}
        >
          {line}
        </text>,
      );
    });

    // ---- 숫자와 코드 ----
    const offs = offsets(bar.cols.map((c) => c.units));
    bar.cols.forEach((col, k) => {
      /* 자리는 박 길이가 아니라 **고른 간격**으로 나눈다. 음표 머리도
         기둥도 없는 타브에서는 그래야 몇 번째에 짚는지 눈으로 센다 */
      const x = p.x + ((k + 0.5) * p.w) / bar.cols.length;
      const live =
        at?.bar === j &&
        at.f >= offs[k] &&
        (k + 1 >= offs.length || at.f < offs[k + 1]);
      if (col.chord)
        marks.push(
          <text
            key={`c${j}.${k}`}
            x={x}
            y={y0 - 20}
            fontSize={13}
            fontWeight={700}
            textAnchor="middle"
            fill="var(--tab-ink)"
          >
            {shiftChordLabel(col.chord, chordShift, flats)}
          </text>,
        );
      for (const f of col.frets) {
        const y = y0 + f.string * GAP;
        ink.push(
          <g key={`f${j}.${k}.${f.string}`}>
            {/* 숫자 뒤를 지운다 — 줄이 글자를 가로지르면 읽기 어렵다 */}
            <rect x={x - 5.5} y={y - 6} width={11} height={12} fill="var(--tab-paper)" />
            <text
              x={x}
              y={y + 4.6}
              fontSize={13}
              fontWeight={700}
              textAnchor="middle"
              fill={live ? "#dc2626" : "var(--tab-ink)"}
            >
              {f.fret}
            </text>
          </g>,
        );
      }
    });
  });

  // ---- 커서 ----
  let cursor: React.ReactNode = null;
  if (at) {
    const p = placeOf(at.bar);
    const x = p.x + at.f * p.w;
    cursor = (
      <line
        x1={x}
        x2={x}
        y1={p.top - 6}
        y2={p.top + STAFF + 6}
        stroke="#dc2626"
        strokeWidth={2.2}
        opacity={0.85}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SongInfoLine
        musicKey={musicKey}
        timeSignature={timeSignature}
        playNotes={playNotes}
        strum={strum}
        onPickStrum={onPickStrum}
        playStyle={playStyle}
        right={headerRight}
      >
        <ViewSteppers sync={sync} onSync={onSync} onShiftBar={onShiftBar} />
        {chordNote && chordNote.source !== "none" && chordNote.changed > 0 && (
          <span className="text-[11px] text-red-600 dark:text-red-400">
            {chordNote.source === "audio" ? "음원 코드" : "악보 코드"}로 모음{" "}
            {chordNote.changed}곳
          </span>
        )}
      </SongInfoLine>
      {/* 종이 색은 화면을 따른다 — 밤에는 어두운 바탕에 흰 숫자다 */}
      <div
        ref={boxRef}
        className="min-h-0 flex-1 overflow-y-auto rounded bg-[var(--tab-paper)] px-2 py-1"
        style={
          {
            "--tab-paper": "var(--background)",
            "--tab-ink": "var(--foreground)",
            "--tab-line": "color-mix(in srgb, var(--foreground) 45%, transparent)",
            "--tab-dim": "color-mix(in srgb, var(--foreground) 55%, transparent)",
          } as React.CSSProperties
        }
      >
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img">
          <title>{score.title || "타브 악보"}</title>
          {score.title && (
            <text
              x={W / 2}
              y={15}
              fontSize={13}
              fontWeight={700}
              textAnchor="middle"
              fill="var(--tab-ink)"
            >
              {score.title}
            </text>
          )}
          {staves}
          {ink}
          {marks}
          {liveRow >= 0 && (
            <rect
              ref={markRef}
              x={0}
              y={24 + liveRow * ROW}
              width={W}
              height={ROW}
              fill="none"
              pointerEvents="none"
            />
          )}
          {cursor}
        </svg>
      </div>
    </div>
  );
}

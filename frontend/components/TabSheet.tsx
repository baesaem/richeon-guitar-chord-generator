"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { ViewSteppers } from "@/components/ViewSteppers";
import type { TabBarEdit } from "@/lib/tabEdits";
import type { Bar } from "@/lib/bars";
import { barIndexAt } from "@/lib/bars";
import type { TabCol, TabScore } from "@/lib/msczToAbc";
import { shiftChordLabel } from "@/lib/notation";
import type { StrumChoice } from "@/lib/strumLibrary";
import { shiftBarCols } from "@/lib/tabShift";
import type { LyricLine, PickedBar } from "@/lib/types";
import { useSmoothTime } from "@/lib/useSmoothTime";
import { chordLabelSvg } from "@/components/ChordLabel";

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
  /** 음높이 손잡이(마디 오른쪽). 주면 안내줄에 낸다 — 전체보기용 */
  pitch?: number;
  onPitch?: (n: number) => void;
  pitchAuto?: number;
  headerRight?: React.ReactNode;
  musicKey: string;
  /** 악보에 적힌 조(원키). 카포로 옮겨 적힌 악보에서 곁들인다 */
  sourceKey?: string;
  timeSignature: string;
  playNotes?: string[];
  strum?: StrumChoice | null;
  onPickStrum?: () => void;
  playStyle?: string;
  /**
   * 코드 이름을 옮길 반음 수. 프렛 숫자는 옮기지 않는다.
   *
   * 카포는 짚는 자리를 바꾸지 않으므로 숫자는 적힌 그대로다. 그러나
   * 이름은 다른 화면과 같아야 한다 — 멜로디가 Gm이라 부르는 자리를
   * 타브가 Em이라 부르면 서로 짚어 말할 수가 없다.
   */
  chordShift?: number;
  /**
   * 마디마다의 코드 — **멜로디가 정한 것**.
   *
   * 코드는 어느 화면에서나 하나여야 한다. 타브가 제 그림에서 읽은 것을
   * 쓰면 멜로디·그리드·파형과 어긋난다. 손으로 고친 것만 이보다 앞선다.
   */
  barChords?: Record<number, string[]>;
  /** ♭로 적을지 ♯로 적을지. 곡의 조를 보고 앱이 정한 값 */
  flats?: boolean;
  /** 이 곡의 가사. 악보의 음절에 띄어쓰기를 되살리는 데 쓴다 */
  lyrics?: LyricLine[];
  /**
   * 그림 악보에서 읽은 타브. 악보 마디 번호(0부터)로 찾는다.
   *
   * 타브 숫자는 **그림 악보에서만** 온다. 멜로디 음에서 지어내면
   * 편곡자가 적은 것과 전혀 다른 한 줄짜리가 나오고, 악보 파일의 타브
   * 보표는 옮겨 적은 사람이 달라 종이와 어긋난다.
   */
  picked?: Record<number, PickedBar>;
  /** 손으로 옮겨 둔 자리. 마디 번호(0부터) → 고친 내용 */
  edits?: Record<number, TabBarEdit>;
  /**
   * 자리를 옮기는 손잡이(강사님, 편집 화면에서만).
   *
   * 없으면 마디를 길게 눌러도 아무 일이 없다 — 전체보기와 연습실은
   * 치기만 하는 자리라 잘못 눌러 악보가 바뀌면 안 된다.
   */
  onEdits?: (next: Record<number, TabBarEdit>) => void;
  /**
   * 마디를 누르면 그 마디 첫머리부터 친다. 받는 시각은 이 악보의 시각
   * (싱크를 더한 값) — 음원 시각으로 되돌리는 것은 부르는 쪽 몫이다.
   */
  onSeek?: (t: number) => void;
  /**
   * 타브 숫자를 몇 반음 옮겨 그릴까. 음높이만큼, 그리고 타브가 멜로디와
   * 다른 조로 적혔으면 그 차이까지 — 타브는 멜로디를 따르고, 음높이를
   * 옮기면 멜로디·타브·그리드가 함께 옮겨진다(강사님 원칙).
   */
  fretShift?: number;
}

/**
 * 마디 안에서 자리 k가 가로로 어디에 서는가(0~1).
 *
 * 기본은 **고르게 나누기**다. 음표 머리도 기둥도 없는 타브에서는 그래야
 * 몇 번째에 짚는지 눈으로 센다. 마디마다 「박 길이대로」로 바꿀 수 있고,
 * 빈 자리를 끼우거나 한 자리만 반 칸씩 밀 수도 있다 — 종이 악보의
 * 손글씨처럼, 짚는 때를 눈에 보이게 하려고.
 */
function spotOf(
  cols: TabCol[],
  k: number,
  edit: TabBarEdit | undefined,
): number {
  const gaps = edit?.gaps ?? [];
  const nudge = edit?.nudge?.[k] ?? 0;
  let at: number;
  let step: number;
  if (edit?.beat) {
    const units = cols.map((c) => c.units);
    const total = units.reduce((a, b) => a + b, 0) || 1;
    const offs = offsets(units);
    step = units[k] / total;
    at = offs[k] + step / 2;
  } else {
    const slots = cols.length + gaps.length || 1;
    const before = gaps.filter((g) => g <= k).length;
    step = 1 / slots;
    at = (k + before + 0.5) * step;
  }
  return Math.min(Math.max(at + (nudge * step) / 2, 0.02), 0.98);
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

/**
 * 한 자리를 「10-60」처럼 적는다.
 *
 * 첫 글자가 줄이다 — 1번이 맨 윗줄(가장 가는 줄), 6번이 맨 아랫줄.
 * 나머지가 프렛이라 「112」는 1번 줄 12프렛이다. 한 자리에 겹쳐 짚는
 * 것은 -로 잇는다. 아무것도 짚지 않는 자리는 빈 칸이다.
 */
function colText(col: TabCol): string {
  return col.frets
    .slice()
    .sort((a, b) => a.string - b.string)
    .map((f) => `${f.string + 1}${f.fret}`)
    .join("-");
}

/** 마디 하나를 적은 글 → 자리들. 못 읽는 토막은 쉼으로 둔다 */
function readCols(text: string, units: number): TabCol[] {
  const parts = text.split(",");
  const each = units / Math.max(parts.length, 1);
  return parts.map((one) => {
    const frets: { string: number; fret: number }[] = [];
    for (const bit of one.split("-")) {
      const m = bit.trim().match(/^([1-6])(\d{1,2})$/);
      if (!m) continue;
      const fret = +m[2];
      if (fret <= 24) frets.push({ string: +m[1] - 1, fret });
    }
    return { units: each, frets };
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

/**
 * 스트록 화살표(↓ 아래·↑ 위).
 *
 * 글자 화살표는 작고 가늘어 잘 안 보였다(강사님) — 선과 삼각형으로 길고
 * 굵게 그린다. 세게 긋는 칸(강세)은 더 굵게, 강조색으로. y0은 1번줄의
 * 높이 — 화살표는 그 위, 코드 이름 아래에 선다(줄 아래는 가사 자리).
 */
function strokeArrow(key: string, x: number, y0: number, down: boolean, accent: boolean) {
  // 1번줄에서 띄운다 — 닿으면 아래 화살표의 머리가 줄과 섞여 막대로 보였다
  const top = y0 - 20;
  const bottom = y0 - 5;
  const w = accent ? 3.2 : 2.4;
  // 머리가 작으면 아래 화살표가 막대로 보인다 — 칸 폭(16분 약 14px)에 맞춰 넉넉히
  const head = accent ? 5.4 : 4.6;
  const color = accent ? "var(--accent)" : "var(--tab-ink)";
  const tip = down ? bottom : top;
  const base = down ? bottom - head * 1.4 : top + head * 1.4;
  return (
    <g key={key}>
      <line
        x1={x}
        x2={x}
        y1={down ? top : base}
        y2={down ? base : bottom}
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
      />
      <polygon points={`${x - head},${base} ${x + head},${base} ${x},${tip}`} fill={color} />
    </g>
  );
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
  pitch,
  onPitch,
  pitchAuto,
  headerRight,
  musicKey,
  sourceKey,
  timeSignature,
  playNotes,
  strum,
  onPickStrum,
  playStyle,
  chordShift = 0,
  barChords,
  flats = false,
  lyrics,
  picked,
  edits,
  onEdits,
  onSeek,
  fretShift = 0,
}: Props) {
  /** 지금 고치고 있는 마디와 고른 자리 */
  const [fixing, setFixing] = useState<{
    bar: number;
    col: number;
    /** 창을 아래쪽에 열까. 고치는 마디를 가리지 않으려고 */
    low?: boolean;
    /**
     * 창을 열 때 이 마디가 어떤 모습이었나.
     *
     * 미는 것은 곧바로 악보에 나타난다 — 그래야 어디로 가는지 보인다.
     * 대신 열 때의 모습을 여기 적어 두었다가 「취소」면 되돌린다.
     */
    was?: TabBarEdit;
  } | null>(null);
  const holdRef = useRef<number | null>(null);
  /** 방금 누른 것이 고치는 창을 열었나 — 그랬으면 손을 떼도 옮기지 않는다 */
  const firedRef = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 지금 치는 줄의 자리표. 창을 굴려 이 자리를 가운데로 끌어온다 */
  const markRef = useRef<SVGRectElement | null>(null);
  /* 재생 중에는 매 프레임 자리를 묻는다 — 상태로만 따라가면 커서가
     마디마다 툭툭 끊겨 보인다. 다른 악보 화면과 같은 시계를 쓴다 */
  const now = useSmoothTime(time, getTime);
  /* 옮겨 그린 숫자는 마디마다 한 번만 센다 — 재생 중에는 매 프레임 다시
     그리므로, 옮길 값·악보·고친 자리가 바뀔 때만 새로 센다 */
  const shiftedCols = useMemo(
    () => new Map<number, TabCol[]>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fretShift, score, picked, edits],
  );

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

  /* 이 곡에 정해 둔 스트로크. 여덟 칸의 D/U/. 과 세게 긋는 칸 */
  const strumCells = strum?.pattern.cells ?? "";
  const strumAccents = strum?.pattern.accents ?? "";

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
    const edit = edits?.[j];
    /* 손으로 고친 것이 먼저, 없으면 그림 악보에서 읽은 것. 둘 다 없으면
       그 마디는 비워 둔다 — 그림에 없는 것을 지어내지 않는다. 기타
       파트를 타브로 쓰기로 고른 곡(ownFrets)만 악보의 숫자를 쓴다 */
    const fromPic = picked?.[j];
    const picCols: TabCol[] =
      fromPic && fromPic.kind === "pick" && fromPic.cols.length
        ? fromPic.cols.map((col) => ({
            units: bar.units / fromPic.cols.length,
            frets: Object.entries(col).map(([string, fret]) => ({
              // 그림에서 읽은 줄은 1번부터, 우리는 0번부터 센다
              string: +string - 1,
              fret,
            })),
          }))
        : score.ownFrets
          ? bar.cols
          : [];
    let cols = shiftedCols.get(j);
    if (!cols) {
      cols = shiftBarCols(edit?.cols ?? picCols, fretShift);
      shiftedCols.set(j, cols);
    }
    /*
     * 코드 이름은 자리를 새로 적어도 남아야 한다.
     *
     * 코드는 자리에 붙어 있으므로, 자리를 갈아 끼우면 함께 지워졌다 —
     * 그림 타브를 부어 넣자 악보 위 코드가 통째로 사라진 까닭이다.
     * 원래 마디의 코드를 자리 비율로 옮겨 온다.
     */
    /* 손으로 고친 것 > 멜로디 > 그림에서 읽은 것 */
    const picNames = edit?.chords?.length
      ? edit.chords
      : (barChords?.[j]?.length ? barChords[j] : fromPic?.chords);
    const chords: (string | undefined)[] = picNames?.length
      ? (() => {
          /* 그림 악보에서 읽어 온 코드. 마디를 코드 수만큼 나눠 얹는다 */
          const out: (string | undefined)[] = new Array(cols.length).fill(
            undefined,
          );
          picNames.forEach((name, i) => {
            const at = Math.min(
              Math.round((i * cols.length) / picNames.length),
              Math.max(cols.length - 1, 0),
            );
            if (at >= 0) out[at] = name;
          });
          return out;
        })()
      : edit?.cols
        ? (() => {
          const out: (string | undefined)[] = new Array(cols.length).fill(
            undefined,
          );
          bar.cols.forEach((c, i) => {
            if (!c.chord) return;
            const at = Math.min(
              Math.round((i / Math.max(bar.cols.length, 1)) * cols.length),
              cols.length - 1,
            );
            if (at >= 0 && !out[at]) out[at] = c.chord;
          });
            return out;
          })()
        : bar.cols.map((c) => c.chord);
    /*
     * 숫자가 없는 마디는 **훑는 마디**다.
     *
     * 종이 악보는 그런 마디를 빗금(∕)과 반복표로만 적는다 — 짚을 자리가
     * 아니라 긋는 자리이기 때문이다. 빈 여섯 줄로 두면 빠뜨린 것처럼
     * 보이므로, 이 곡에 정해 둔 스트로크를 그 자리에 적는다.
     */
    /* 훑는 마디에도 코드 이름은 적는다. 자리(숫자)가 없다고 이름까지
       없으면 무엇을 긋는지 알 수 없다 — 마디를 코드 수만큼 나눠 얹는다 */
    if (!cols.length && picNames?.length)
      picNames.forEach((name, i) => {
        marks.push(
          <text
            key={`sc${j}.${i}`}
            x={p.x + ((i + 0.5) * p.w) / picNames.length}
            // 스트록 화살표 위로 — 화살표가 1번줄 위 20px까지 선다
            y={y0 - 24}
            fontSize={13}
            fontWeight={700}
            textAnchor="middle"
            fill="var(--tab-ink)"
          >
            {chordLabelSvg(shiftChordLabel(name, chordShift, flats))}
          </text>,
        );
      });

    /* 숫자가 없는 마디는 스트로크로. 그림 악보의 스트로크 마디면 거기
       적힌 손 방향을, 아니면 이 곡에 정해 둔 스트로크를 긋는다 */
    const picStrum =
      fromPic && fromPic.kind === "strum" && fromPic.strokes ? fromPic : null;
    const cellsHere = picStrum ? picStrum.strokes : strumCells;
    const accentsHere = picStrum ? (picStrum.accents ?? "") : strumAccents;
    if (!cols.length && cellsHere) {
      const beats = cellsHere.length || 8;
      cellsHere.split("").forEach((c, i) => {
        if (c !== "D" && c !== "U") return;
        const x = p.x + ((i + 0.5) * p.w) / beats;
        const hit = accentsHere[i] === ">";
        // 빗금 — 세게 긋는 칸은 굵게
        ink.push(
          <line
            key={`sl${j}.${i}`}
            x1={x - 3.4}
            x2={x + 3.4}
            y1={y0 + GAP * 3.3}
            y2={y0 + GAP * 1.7}
            stroke="var(--tab-line)"
            strokeWidth={hit ? 2.4 : 1.4}
          />,
        );
        // 손 방향은 줄 위에 — 아래는 가사 자리다. 타브 스트록 칸과 같은 화살표
        marks.push(strokeArrow(`sd${j}.${i}`, x, y0, c === "D", hit));
      });
    }

    const offs = offsets(cols.map((c) => c.units));
    cols.forEach((col, k) => {
      const x = p.x + spotOf(cols, k, edit) * p.w;
      const picked = fixing?.bar === j && fixing.col === k;
      const live =
        at?.bar === j &&
        at.f >= offs[k] &&
        (k + 1 >= offs.length || at.f < offs[k + 1]);
      const chord = chords[k];
      if (chord)
        marks.push(
          <text
            key={`c${j}.${k}`}
            x={x}
            /* 스트록 화살표가 서는 칸은 코드 이름을 그 위로 올린다 */
            y={col.stroke ? y0 - 24 : y0 - 20}
            fontSize={13}
            fontWeight={700}
            textAnchor="middle"
            fill="var(--tab-ink)"
          >
            {chordLabelSvg(shiftChordLabel(chord, chordShift, flats))}
          </text>,
        );
      /* 스트록 칸: 손 방향(↓ 아래·↑ 위)을 줄 위에 적는다 — 줄 아래는 가사
         자리다. 숫자만 쌓여 있으면 아래로 긋는지 위로 긋는지 알 수 없다.
         세게 긋는 칸은 > 기호 대신 크고 굵은 강조색 화살표로(강사님) */
      if (col.stroke)
        marks.push(strokeArrow(`st${j}.${k}`, x, y0, col.stroke === "D", !!col.accent));
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
              fill={picked ? "#2563eb" : live ? "#dc2626" : "var(--tab-ink)"}
            >
              {f.fret}
            </text>
          </g>,
        );
      }
    });
  });

  /**
   * 악보 마디 j를 치는 음원 마디로 옮긴다.
   *
   * 도돌이를 돌면 같은 악보 마디를 두 번 이상 친다 — 그중 지금 자리에서
   * 가장 가까운 것으로 간다. 2절을 치다가 누르면 2절의 그 마디다.
   */
  const seekBar = (j: number) => {
    if (!onSeek) return;
    let best = -1;
    let gap = Infinity;
    bars.forEach((b, i) => {
      const no = scoreBarNumbers?.[i];
      if ((no !== undefined ? no - 1 : i - barOffset) !== j) return;
      const d = Math.abs(b.start - now);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    if (best >= 0) onSeek(bars[best].start);
  };

  /* 마디를 3초 길게 누르면 그 마디를 고친다 — 코드 고칠 때와 같은 손짓.
     마우스는 오른쪽 클릭. 편집 화면에서만 판을 깐다 */
  const holds = onEdits
    ? score.bars.map((bar, j) => {
        const p = placeOf(j);
        /* 창은 고치는 마디의 **반대쪽**에 연다 — 열자마자 그 마디를
           덮어 버리면 미는 것이 보이지 않는다. 그 뒤로는 끌어 옮긴다 */
        const open = (e: { currentTarget: SVGRectElement }) => {
          let low = true;
          try {
            const r = e.currentTarget.getBoundingClientRect();
            low = r.top + r.height / 2 < window.innerHeight / 2;
          } catch {
            /* 못 재면 아래에 연다 */
          }
          firedRef.current = true;
          setFixing({ bar: j, col: 0, low, was: edits?.[j] });
        };
        const start = (e: React.PointerEvent<SVGRectElement>) => {
          const target = e.currentTarget;
          firedRef.current = false;
          if (holdRef.current) window.clearTimeout(holdRef.current);
          holdRef.current = window.setTimeout(
            () => open({ currentTarget: target }),
            3000,
          );
        };
        const stop = () => {
          if (holdRef.current) window.clearTimeout(holdRef.current);
          holdRef.current = null;
        };
        return (
          <rect
            key={`hit${j}`}
            x={p.x}
            y={p.top - HEAD + 10}
            width={p.w}
            height={HEAD + STAFF + FOOT - 12}
            fill="transparent"
            style={{ cursor: onSeek ? "pointer" : "context-menu" }}
            onClick={() => {
              // 길게 눌러 창이 열렸으면 떼는 손은 옮기지 않는다
              if (firedRef.current) firedRef.current = false;
              else seekBar(j);
            }}
            onPointerDown={start}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            onContextMenu={(e) => {
              e.preventDefault();
              open(e);
            }}
          />
        );
      })
    : null;

  /* 치기만 하는 화면(전체보기·연습실)에서는 누르면 옮기기만 한다 */
  const seeks =
    !onEdits && onSeek
      ? score.bars.map((_, j) => {
          const p = placeOf(j);
          return (
            <rect
              key={`seek${j}`}
              x={p.x}
              y={p.top - HEAD + 10}
              width={p.w}
              height={HEAD + STAFF + FOOT - 12}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onClick={() => seekBar(j)}
            />
          );
        })
      : null;

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

  /* ---- 마디 하나를 고치는 창 ---- */
  const fixBar = fixing ? score.bars[fixing.bar] : null;
  const fixEdit = fixing ? edits?.[fixing.bar] : undefined;
  const fixPic = fixing ? picked?.[fixing.bar] : undefined;
  const fixCols: TabCol[] =
    fixEdit?.cols ??
    (fixPic && fixPic.kind === "pick" && fixBar
      ? fixPic.cols.map((col) => ({
          units: fixBar.units / fixPic.cols.length,
          frets: Object.entries(col).map(([string, fret]) => ({
            string: +string - 1,
            fret,
          })),
        }))
      : score.ownFrets && fixBar
        ? fixBar.cols
        : []);
  /** 이 마디의 고친 내용을 갈아 끼운다. 빈 것이 되면 줄째 지운다 */
  const putEdit = (next: TabBarEdit) => {
    if (!fixing || !onEdits) return;
    const all = { ...(edits ?? {}) };
    const empty =
      !next.cols?.length &&
      !next.beat &&
      !next.gaps?.length &&
      !Object.keys(next.nudge ?? {}).length;
    if (empty) delete all[fixing.bar];
    else all[fixing.bar] = next;
    onEdits(all);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {fixing && fixBar && (
        <DragPanel
          title={`${fixing.bar + 1}마디 자리 고치기`}
          low={fixing.low}
          onClose={() => setFixing(null)}
        >
          <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
            <p className="text-[12px] leading-snug text-[color-mix(in_srgb,var(--foreground)_60%,transparent)]">
              옮길 자리를 고르고 ◀ ▶로 미세요. 반 칸씩 움직입니다.
            </p>
            {/* 이 마디의 자리들. 누르면 골라진다 */}
            <div className="flex flex-wrap gap-1">
              {fixCols.map((col, k) => (
                <button
                  key={k}
                  onClick={() => setFixing({ ...fixing, col: k })}
                  className={[
                    "rounded px-2 py-1 text-[12px] font-semibold tabular-nums",
                    fixing.col === k
                      ? "bg-[var(--pick)] text-[var(--pick-ink)]"
                      : "bg-[var(--chip)] text-[var(--foreground)]",
                  ].join(" ")}
                  title={`${k + 1}번째 자리`}
                >
                  {colText(col) || "쉼"}
                </button>
              ))}
            </div>
            {/* 고른 자리를 반 칸씩 민다 */}
            <div className="flex items-center gap-1.5">
              <button
                className="rounded bg-[var(--chip)] px-3 py-1.5 font-semibold"
                onClick={() => {
                  const nudge = { ...(fixEdit?.nudge ?? {}) };
                  nudge[fixing.col] = (nudge[fixing.col] ?? 0) - 1;
                  if (!nudge[fixing.col]) delete nudge[fixing.col];
                  putEdit({ ...fixEdit, nudge });
                }}
              >
                ◀ 반 칸
              </button>
              <span className="min-w-8 text-center text-[12px] tabular-nums text-[color-mix(in_srgb,var(--foreground)_60%,transparent)]">
                {fixEdit?.nudge?.[fixing.col] ?? 0}
              </span>
              <button
                className="rounded bg-[var(--chip)] px-3 py-1.5 font-semibold"
                onClick={() => {
                  const nudge = { ...(fixEdit?.nudge ?? {}) };
                  nudge[fixing.col] = (nudge[fixing.col] ?? 0) + 1;
                  if (!nudge[fixing.col]) delete nudge[fixing.col];
                  putEdit({ ...fixEdit, nudge });
                }}
              >
                반 칸 ▶
              </button>
            </div>
            {/* 빈 자리를 끼우면 그 뒤가 통째로 벌어진다 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                className="rounded bg-[var(--chip)] px-2 py-1.5 text-[12px] font-semibold"
                onClick={() =>
                  putEdit({
                    ...fixEdit,
                    gaps: [...(fixEdit?.gaps ?? []), fixing.col].sort(
                      (a, b) => a - b,
                    ),
                  })
                }
                title="고른 자리 앞을 한 칸 벌립니다"
              >
                빈 자리 넣기
              </button>
              <button
                className="rounded bg-[var(--chip)] px-2 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                disabled={!fixEdit?.gaps?.length}
                onClick={() => {
                  const gaps = [...(fixEdit?.gaps ?? [])];
                  const at = gaps.lastIndexOf(fixing.col);
                  if (at >= 0) gaps.splice(at, 1);
                  else gaps.pop();
                  putEdit({ ...fixEdit, gaps });
                }}
              >
                빈 자리 빼기
              </button>
              <button
                className={[
                  "rounded px-2 py-1.5 text-[12px] font-semibold",
                  fixEdit?.beat
                    ? "bg-[var(--pick)] text-[var(--pick-ink)]"
                    : "bg-[var(--chip)]",
                ].join(" ")}
                onClick={() => putEdit({ ...fixEdit, beat: !fixEdit?.beat })}
                title="음표 길이만큼 자리를 벌립니다. 끄면 고르게 나눕니다"
              >
                박 길이대로
              </button>
            </div>
            {/* 마디를 통째로 적어 넣는다. 미는 것보다 빠를 때가 있고,
                없는 자리를 새로 넣거나 잘못 읽어 온 것을 고칠 수 있다 */}
            <label className="flex flex-col gap-1 border-t border-[var(--panel-line)] pt-3">
              <span className="text-[12px] font-semibold">이 마디를 적어 넣기</span>
              <input
                className="w-full rounded border border-[var(--panel-line)] bg-[var(--background)] px-2 py-1.5 font-mono text-[12px]"
                defaultValue={fixCols.map(colText).join(",")}
                key={`${fixing.bar}.${fixCols.length}`}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const cols = readCols(
                    (e.target as HTMLInputElement).value,
                    fixBar.units,
                  );
                  putEdit({ ...fixEdit, cols, gaps: [], nudge: {} });
                }}
                onBlur={(e) => {
                  const cols = readCols(e.target.value, fixBar.units);
                  if (
                    cols.map(colText).join(",") !== fixCols.map(colText).join(",")
                  )
                    putEdit({ ...fixEdit, cols, gaps: [], nudge: {} });
                }}
                title="첫 글자가 줄(1번이 맨 윗줄), 나머지가 프렛입니다"
              />
              <span className="text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                첫 글자가 줄(1번이 맨 윗줄), 나머지가 프렛입니다. 한 자리에
                겹쳐 짚는 것은 -로 잇고, 자리는 쉼표로 나눕니다 —
                「10-60,20,30」. 빈 칸은 쉼입니다.
              </span>
            </label>
            <div className="flex items-center justify-between gap-2 border-t border-[var(--panel-line)] pt-3">
              <button
                className="rounded px-2 py-1.5 text-[12px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline decoration-dotted underline-offset-2"
                onClick={() => putEdit({})}
                title="악보 파일에 적힌 그대로 되돌립니다"
              >
                이 마디 되돌리기
              </button>
              <span className="flex items-center gap-1.5">
                <button
                  className="rounded bg-[var(--panel)] px-3 py-1.5 font-semibold"
                  onClick={() => {
                    // 열 때의 모습으로 되돌리고 닫는다
                    putEdit(fixing.was ?? {});
                    setFixing(null);
                  }}
                >
                  취소
                </button>
                <button
                  className="rounded bg-[var(--pick)] px-4 py-1.5 font-semibold text-[var(--pick-ink)]"
                  onClick={() => setFixing(null)}
                >
                  수정
                </button>
              </span>
            </div>
          </div>
        </DragPanel>
      )}
      <SongInfoLine
        musicKey={musicKey}
        sourceKey={sourceKey}
        timeSignature={timeSignature}
        playNotes={playNotes}
        strum={strum}
        onPickStrum={onPickStrum}
        playStyle={playStyle}
        right={headerRight}
      >
        <ViewSteppers
          sync={sync}
          onSync={onSync}
          onShiftBar={onShiftBar}
          pitch={pitch}
          onPitch={onPitch}
          pitchAuto={pitchAuto}
        />
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
          {holds}
          {seeks}
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

/**
 * 끌어 옮길 수 있는 작은 창.
 *
 * 가운데 박힌 창에 검은 막까지 덮으면, 자리를 미는 동안 정작 그 마디가
 * 보이지 않는다 — 반 칸 밀 때마다 창을 닫았다 열어야 했다. 막을 걷고
 * 제목줄을 잡아 옆으로 치울 수 있게 한다. 창 밖은 그대로 살아 있어,
 * 옮기는 동안 악보에서 파란 숫자가 움직이는 것이 보인다.
 */
function DragPanel({
  title,
  low,
  onClose,
  children,
}: {
  title: string;
  /** 처음에 아래쪽에 연다. 고치는 마디가 위에 있을 때 */
  low?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /** 창을 화면 안에 붙들어 둔다 — 끌다 놓쳐 밖으로 나가면 되찾을 수 없다 */
  const clamp = (x: number, y: number) => {
    const box = boxRef.current;
    const w = box?.offsetWidth ?? 320;
    const h = box?.offsetHeight ?? 240;
    return {
      x: Math.min(Math.max(x, 4), Math.max(window.innerWidth - w - 4, 4)),
      y: Math.min(Math.max(y, 4), Math.max(window.innerHeight - h - 4, 4)),
    };
  };

  const start = (e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g) return;
    setAt(clamp(e.clientX - g.dx, e.clientY - g.dy));
  };
  const end = () => {
    grab.current = null;
  };

  return (
    <div
      ref={boxRef}
      className="fixed z-50 w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-[var(--panel-line)] bg-[var(--background)] text-[var(--foreground)] shadow-2xl"
      style={
        at
          ? { left: at.x, top: at.y }
          : low
            ? { left: "50%", bottom: "1rem", transform: "translateX(-50%)" }
            : { left: "50%", top: "1rem", transform: "translateX(-50%)" }
      }
    >
      {/* 제목줄이 손잡이다. 잡아 끌면 창이 따라온다 */}
      <div
        className="flex cursor-move touch-none items-center justify-between px-4 pb-2 pt-3"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        title="여기를 잡아 창을 옮기세요"
      >
        <h3 className="select-none text-base font-bold">{title}</h3>
        <button
          className="rounded px-2 py-1 text-sm text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]"
          onClick={onClose}
          aria-label="닫기"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

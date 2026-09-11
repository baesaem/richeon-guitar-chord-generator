"use client";

/**
 * ABC 악보 화면.
 *
 * 자동으로 딴 melody는 부른 음의 15~30%밖에 잡히지 않는다. 강사님이 만든
 * ABC 악보가 곡에 붙어 있으면 이쪽을 그린다 — 음표가 하나도 빠지지 않고,
 * 도돌이표와 1·2절 가사까지 악보 그대로다.
 *
 * 커서는 **악보의 템포를 믿지 않는다.** 악보에 ♩=98이라 적혀 있어도 실제
 * 녹음은 96.8일 수 있고, 그 1%가 3분 쌓이면 2초 넘게 벌어진다. 대신 음원에서
 * 딴 마디 격자(bars)에 악보의 마디를 하나씩 이어 붙인다 — 그러면 곡이
 * 밀거나 당겨져도 커서가 따라간다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { StrumChoice } from "@/lib/strumLibrary";

import { BeatBpm } from "@/components/BeatBpm";
import { SongInfoLine } from "@/components/SongInfoLine";
import { ViewSteppers } from "@/components/ViewSteppers";
import { abcOrders } from "@/lib/abcOrder";
import { reflowAbc } from "@/lib/abcReflow";
import { transposeAbcChords } from "@/lib/abcTranspose";
import type { SongChordResult } from "@/lib/abcChords";
import type { Bar } from "@/lib/bars";
import { EDIT_HOLD_MS } from "@/lib/editChords";
import { useSmoothTime } from "@/lib/useSmoothTime";

/** abcjs가 마디마다 알려 주는 타이밍. 필요한 것만 추린다 */
interface Timing {
  milliseconds: number;
  left: number;
  top: number;
  height: number;
  /** 마디의 첫 이벤트인가. 이것을 세면 연주 순서상 몇 번째 마디인지 나온다 */
  measureStart?: boolean;
  /** 이 이벤트가 차지하는 가로 폭·끝 — 줄을 고르게 훑는 데 쓴다 */
  width?: number;
  endX?: number;
  /** 몇 번째 줄(시스템)인가. 줄을 묶는 기준 */
  line?: number;
  /**
   * 연주 순서상 마디 번호(0부터). 우리가 붙인다.
   *
   * abcjs의 measureNumber는 악보에 적힌 번호라 도돌이를 돌면 되감긴다.
   * 음원의 마디 격자는 선형이므로, 몇 바퀴째든 앞으로만 세는 번호가 필요하다.
   */
  playMeasure: number;
  elements?: SVGElement[][];
}

interface Props {
  /** ABC notation 원문 */
  abc: string;
  /** 음원에서 딴 마디 격자. 커서를 여기에 맞춘다 */
  bars: Bar[];
  /** 지금 재생 위치(초) */
  time: number;
  /** 매 프레임 위치를 묻는 함수. 있으면 커서가 부드럽게 흐른다 */
  getTime?: () => number;
  /** 음높이(반음). 카포와 같은 값 — 악보 표기가 함께 옮겨진다 */
  transpose?: number;
  /**
   * 코드 이름만 옮길 반음. 없으면 transpose와 같다(음표와 함께).
   * 「멜로디 키 고정」이면 음표는 그대로(transpose 0) 코드만 음높이를 따른다.
   */
  chordShift?: number;
  /** 악보를 음원 위에서 미는 보정(초) */
  sync?: number;
  onSync?: (sec: number) => void;
  /** 악보 첫 마디가 음원의 몇 번째 마디인지. 곡에 저장된 값을 준다 */
  barOffset?: number;
  /** 악보를 한 마디씩 미는 손잡이(강사님) */
  onShiftBar?: (delta: number) => void;
  /**
   * 마디를 3초 길게 누르면(마우스는 오른쪽 클릭) 그 마디의 코드를 고친다.
   *
   * 코드는 악보가 정한다 — 타브·그리드·파형이 모두 여기서 만든 코드를
   * 쓴다. 그러니 고치는 자리도 악보여야 한다. 넘기는 값은 **악보에 적힌
   * 마디 번호**(0부터)다.
   */
  onEditBar?: (measure: number) => void;
  /**
   * 음표를 누르면 그 음표 자리의 시각(초)을 넘긴다 — 거기서부터 친다.
   * 시각은 time과 같은 자(싱크·지연을 더한 값)다.
   */
  onSeek?: (t: number) => void;
  /**
   * 진행바를 화면의 어느 높이에 붙여 둘지(0 위 … 1 아래). 연습실은 위쪽
   * (0.28) — 앞으로 칠 줄이 더 보인다. 편집은 가운데(0.5)에 두어 앞뒤를
   * 함께 보며 고친다.
   */
  followAt?: number;
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
  /** 안내줄에 함께 적을 스트로크. 모든 플레이 화면이 같은 것을 보인다 */
  strum?: StrumChoice | null;
  onPickStrum?: () => void;
  /** 이 곡을 치는 방식 — 「스트로크」 또는 「아르페지오 3」 */
  playStyle?: string;
  /** 악보·파형·타브의 코드를 한 벌로 모은 결과. 표시줄에 알려 준다 */
  chordNote?: SongChordResult | null;
  /** 음원 분석과 얼마나 다르든 악보 코드를 따르는가 */
  /**
   * 음원의 박을 악보의 펼친 마디 수에 맞춰 고르게 다시 깐다(강사님).
   * 박 찾기가 정수로 돌아오지 않는 배율로 어긋났을 때의 마지막 길이다.
   */
  onFitBars?: (bars: number) => void;
  /** 빠르기를 손으로 정한다(강사님). 마디 수로 나누는 길이 안 맞을 때 쓴다 */
  onSetBpm?: (bpm: number) => void;
  /** 지금 음원의 빠르기. 손으로 고칠 때 시작값이 된다 */
  audioBpm?: number;
  /** 악보를 펼쳤을 때의 마디 수. onFitBars가 쓴다 */
  playedBars?: number;
  /** 음원의 마디 수. 악보와 얼마나 다른지 보인다 */
  audioBars?: number;
  /**
   * 한 줄에 놓는 마디 수. 0이면 악보에 적힌 대로(보통 4마디).
   *
   * 폰 폭에서는 한 줄 4마디가 38%로 줄어 코드·가사가 8px쯤밖에 안 됐다.
   * 마디를 줄이면 그만큼 크게 보인다 — 그림 악보의 「－ n마디 ＋」와 같다.
   */
  perLine?: number;
  onPerLine?: (n: number) => void;
}

export function AbcScore({
  abc,
  bars,
  time,
  getTime,
  transpose = 0,
  chordShift,
  sync = 0,
  onSync,
  barOffset: barOffsetProp,
  onShiftBar,
  onEditBar,
  onSeek,
  followAt = 0.28,
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
  chordNote,
  onFitBars,
  onSetBpm,
  audioBpm = 0,
  playedBars = 0,
  audioBars = 0,
  perLine = 0,
  onPerLine,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<SVGLineElement | null>(null);
  /** 지금 물들여 둔 음표들과 그 이벤트. 다음 음으로 넘어갈 때 지운다 */
  const markedRef = useRef<SVGElement[]>([]);
  const playedRef = useRef<Timing | null>(null);
  const [timings, setTimings] = useState<Timing[]>([]);
  /** 악보 첫 마디가 음원의 몇 번째 마디인지. 곡에 저장된 값을 쓴다 */
  const barOffset = barOffsetProp ?? 0;
  const now = useSmoothTime(time, getTime);
  /* 고치는 손잡이는 ref로 든다. 프롭이 바뀔 때마다 악보를 다시 그리면
     커서가 튀고 스크롤이 처음으로 돌아간다 */
  const onEditRef = useRef(onEditBar);
  onEditRef.current = onEditBar;

  // ---- 악보 그리기 ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !abc.trim()) return;
    let cancelled = false;

    (async () => {
      const ABCJS = (await import("abcjs")).default;
      if (cancelled || !hostRef.current) return;
      /* 한 줄 N마디는 줄을 여기서 직접 끊어 정확히 맞춘다. 줄 구조가 특이한
         악보만 abcjs 줄바꿈(wrap)으로 대신한다 — 그쪽은 빽빽한 마디를 한
         줄에 덜 넣는다 */
      /* 코드만 따로 옮길 때는 코드 이름을 먼저 옮겨 두고, 음표는 abcjs가
         transpose만큼 옮긴다(abcjs는 코드도 함께 옮기므로 그 차이만) */
      const extra = chordShift === undefined ? 0 : chordShift - transpose;
      const base = extra ? transposeAbcChords(abc, extra) : abc;
      const flowed = perLine > 0 ? reflowAbc(base, perLine) : null;
      // barNumbers는 abcjs가 받는 값인데 타입 정의에 빠져 있다
      const params = {
        responsive: "resize",
        add_classes: true,
        visualTranspose: transpose,
        /* 한 줄 마디 수를 줄이면 그만큼 좁게 그린다 — 화면 폭에 맞춰 늘려
           보이므로 음표·코드·가사가 함께 커진다. 넓게 그리고 마디만 줄이면
           간격만 벌어지고 글자는 그대로다 */
        staffwidth: perLine > 0 ? (flowed ? 185 : 190) * perLine : 740,
        ...(perLine > 0 && !flowed
          ? {
              wrap: {
                /* 간격을 넉넉히 요구하면 16분음표가 빽빽한 마디는 한 줄에
                   못 들어가 「2마디」인데 1마디씩 그렸다(최소 1.0에서도).
                   악보대로(4마디를 740에) 그릴 때만큼은 좁혀도 된다 */
                minSpacing: 0.6,
                maxSpacing: 2.7,
                preferredMeasuresPerLine: perLine,
              },
            }
          : {}),
        // 줄마다 마디 번호를 작게 적는다 — 어디를 치는지 서로 짚어
        // 말할 때 「몇 마디」가 있어야 한다
        barNumbers: 1,
        format: {
          // 코드는 치면서 힐끗 보는 글자다. 12로는 폰 폭에서 악보가 줄어
          // 읽기 어려웠다
          gchordfont: "sans-serif 16 bold",
          measurefont: "sans-serif 9",
        },
      } as Parameters<typeof ABCJS.renderAbc>[2] & { barNumbers?: number };
      /* 마디 번호는 %%barnumbers 지시로 켠다.
         악보 원문은 건드리지 않고 그릴 때만 앞에 붙인다 — 저장되는
         악보에 우리 취향을 섞지 않기 위해서다. */
      /* 성부가 하나뿐인 악보는 성부 이름(「멜로디」)을 줄마다 적지 않는다 —
         가를 것이 없는 이름표가 줄 앞자리만 차지했다(「혜화동」) */
      const body = flowed ?? base;
      const voices = new Set(
        [...body.matchAll(/^V:\s*(\S+)/gm)].map((m) => m[1]),
      );
      const src =
        voices.size <= 1
          ? body.replace(/^V:.*$/gm, (line) =>
              line.replace(/\s+(?:name|nm|subname|sname|snm)=(?:"[^"]*"|\S+)/g, ""),
            )
          : body;
      const drawn = /^%%barnumbers/m.test(src) ? src : `%%barnumbers 1
${src}`;
      const [obj] = ABCJS.renderAbc(hostRef.current, drawn, params);
      if (!obj) return;
      obj.setTiming();
      const raw = (
        (obj as unknown as { noteTimings?: Omit<Timing, "playMeasure">[] })
          .noteTimings ?? []
      ).filter(
        (e) =>
          e &&
          typeof e.milliseconds === "number" &&
          e.left !== null &&
          e.left !== undefined,
      );
      // 연주 순서상 마디 번호를 붙인다 — 도돌이를 돌아도 앞으로만 센다
      let idx = -1;
      const list: Timing[] = raw.map((e) => {
        if (e.measureStart) idx++;
        return { ...e, playMeasure: Math.max(idx, 0) };
      });
      // 코드 이름의 숫자는 작게 — 다른 화면과 같은 규칙
      shrinkChordDigits(hostRef.current);
      if (onEditRef.current) markMeasures(hostRef.current, onEditRef.current);
      setTimings(list);
      // 다시 그렸으니 커서와 음표 표시도 새로 잡는다 (옛 노드는 사라졌다)
      cursorRef.current = null;
      markedRef.current = [];
      playedRef.current = null;
    })();

    return () => {
      cancelled = true;
    };
  }, [abc, transpose, chordShift, perLine]);

  /**
   * 음원 마디 차례 → abcjs가 세는 마디 번호.
   *
   * abcjs는 도돌이표까지만 따라가고 달세뇨·코다 되돌이는 지나친다.
   * 음원은 되돌이를 실제로 도니, 음원의 n번째 마디가 악보의 어느
   * 마디인지 여기서 이어 준다. 되돌이가 없는 곡에서는 그냥 0,1,2…
   */
  const audioToPlay = useMemo(() => {
    const n = timings.length ? timings[timings.length - 1].playMeasure + 1 : 0;
    const plain = Array.from({ length: n }, (_, i) => i);
    if (!n) return plain;
    let o = null;
    try {
      o = abcOrders(abc);
    } catch {
      o = null;
    }
    // 셈이 어긋나면(악보 문법이 특이하면) 손대지 않는다
    if (!o || o.noJump.length !== n || o.withJump.length === o.noJump.length)
      return plain;
    const firstOf = new Map<number, number>();
    o.noJump.forEach((d, k) => {
      if (!firstOf.has(d)) firstOf.set(d, k);
    });
    return o.withJump.map((d) => firstOf.get(d) ?? 0);
  }, [abc, timings]);

  /** 연주 순서상 총 마디 수 (도돌이를 편 길이) */
  const measureCount = audioToPlay.length;

  /**
   * 지금 시각에 해당하는 악보 위치.
   *
   * 음원 마디 격자가 있으면 「지금 몇 번째 마디의 몇 %인가」를 구하고,
   * 악보에서 그 마디의 같은 %를 짚는다. 악보 템포는 쓰지 않는다.
   */
  const at = useMemo(() => {
    if (!timings.length) return null;
    /* 싱크는 부르는 쪽에서 time에 이미 더해 넘긴다(코드악보·가사와 같은
       규칙). 여기서 한 번 더 빼면 서로 지워져 싱크 단추가 먹지 않는다 —
       실제로 그랬다. sync 값은 안내줄의 스텝퍼에 보이는 데만 쓴다. */
    const t = now;

    /* 마디 하나를 일정한 속도로 훑는다.
     *
     * 예전에는 음표에서 음표로 건너뛰며 그 사이를 이었다 — 음표가
     * 촘촘한 자리에서는 커서가 빨라지고 긴 음에서는 멎어, 눈이 따라
     * 가기 어려웠다. 마디의 왼쪽 끝에서 오른쪽 끝까지 시간에 비례해
     * 밀면 어디서나 같은 속도로 흐른다.
     */
    if (bars.length) {
      // 음원의 몇 번째 마디인가
      let bi = -1;
      for (let i = 0; i < bars.length; i++) {
        if (bars[i].start <= t) bi = i;
        else break;
      }
      // 아직 첫 마디에 닿지 않았어도 커서는 세워 둔다 — 재생 전에
      // 커서가 없으면 마디·싱크를 맞출 때 무엇이 바뀌는지 볼 수 없다.
      // 음원의 첫 마디로 쳐서, 마디를 밀면 그 자리가 따라 움직인다.
      if (bi < 0) bi = 0;
      const m = Math.min(Math.max(bi - barOffset, 0), measureCount - 1);
      if (m < 0 || !measureCount) return null;
      const pm = audioToPlay[m];
      const head = timings.find((e) => e.playMeasure === pm);
      if (!head) return null;

      /* 줄은 abcjs가 매기는 line 번호로 묶는다. top(세로 좌표)으로 묶으면
         줄마다 같은 값이 나오는 악보에서 온 곡이 한 줄로 뭉쳐, 커서가
         곡 전체 길이에 걸쳐 기어간다 — 실제로 그런 일이 있었다. */
      const onLine =
        head.line !== undefined
          ? timings.filter((e) => e.line === head.line)
          : timings.filter((e) => e.top === head.top);
      // 도돌이를 도는 줄은 한 번 더 연주된다. 지금 지나는 바퀴만 본다
      const seen = new Set(onLine.map((e) => e.playMeasure));
      const onThisLine = (k: number) =>
        k >= 0 && k < measureCount && seen.has(audioToPlay[k]);

      /* 마디 하나씩 훑는다.
       *
       * 전에는 줄을 통째로 고르게 밀었다. 어디서나 같은 속도라 눈은
       * 편했지만, 마디마다 그려진 폭이 달라(음표가 많은 마디는 넓고
       * 온음표 한 개짜리는 좁다) 커서가 음표에서 벗어났다 — 성긴 마디에
       * 들어서면 뒤처져 따라오는 것처럼 보였다. 코드악보·파형은 칸이
       * 고르게 그려져 그 어긋남이 드러나지 않았다.
       *
       * 이 마디의 첫 음표에서 다음 마디의 첫 음표까지를, 그 마디가
       * 걸리는 시간으로 나눈다. 마디마다 속도는 조금씩 달라지지만
       * 마디선마다 음표와 정확히 다시 맞는다.
       */
      const bar = bars[m + barOffset];
      if (!bar) return null;
      const inThis = onLine.filter((e) => e.playMeasure === pm);
      const left = Math.min(...inThis.map((e) => e.left));
      const inNext = onThisLine(m + 1)
        ? onLine.filter((e) => e.playMeasure === audioToPlay[m + 1])
        : [];
      const right = inNext.length
        ? Math.min(...inNext.map((e) => e.left))
        : Math.max(...inThis.map((e) => e.endX ?? e.left + (e.width ?? 0)));
      const span = bar.end - bar.start;
      const frac =
        span > 0 ? Math.min(Math.max((t - bar.start) / span, 0), 1) : 0;
      const x = left + (Math.max(right, left) - left) * frac;

      // 색을 입힐 음표는 커서가 지나온 마지막 음표
      let ev = head;
      for (const e of inThis) if (e.left <= x) ev = e;
      return { ev, x };
    }

    // 마디 격자가 없으면 악보 템포를 따른다(예전 방식)
    const scoreMs = t * 1000;
    let i = -1;
    for (let k = 0; k < timings.length; k++) {
      if (timings[k].milliseconds <= scoreMs) i = k;
      else break;
    }
    if (i < 0) i = 0; // 재생 전에도 첫 음표 자리에 커서를 세운다
    const ev = timings[i];
    const nx = timings[i + 1];
    let x = ev.left;
    if (nx && nx.top === ev.top && nx.milliseconds > ev.milliseconds) {
      const f = Math.min(
        (scoreMs - ev.milliseconds) / (nx.milliseconds - ev.milliseconds),
        1,
      );
      x = ev.left + (nx.left - ev.left) * f;
    }
    return { ev, x };
  }, [now, sync, bars, barOffset, timings, measureCount, audioToPlay]);

  // ---- 음표를 눌러 거기서부터 치기 ----
  /* 누를 때 쓸 값은 ref로 든다. 악보를 다시 그리지 않고, 붙인 손잡이도
     한 번만 단다 */
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const seekCtx = useRef<SeekContext>({ timings, bars, barOffset, audioToPlay, now });
  seekCtx.current = { timings, bars, barOffset, audioToPlay, now };
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let down: { t: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { t: performance.now(), x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const seek = onSeekRef.current;
      const d = down;
      down = null;
      if (!seek) return;
      /* 길게 누른 것(마디 코드 고치기)과 끈 것(스크롤)은 누름이 아니다 */
      if (
        d &&
        (performance.now() - d.t > 400 ||
          Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8)
      )
        return;
      const t = noteTimeAt(host, e.clientX, e.clientY, seekCtx.current);
      if (t !== null) seek(t);
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("click", onClick);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("click", onClick);
    };
  }, []);

  // ---- 커서 그리기 ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !at) return;
    const svg = host.querySelector("svg");
    if (!svg) return;

    let cur = cursorRef.current;
    if (!cur || !svg.contains(cur)) {
      cur = document.createElementNS("http://www.w3.org/2000/svg", "line");
      cur.setAttribute("class", "abc-cursor");
      cur.setAttribute("stroke", "#dc2626");
      cur.setAttribute("stroke-width", "2.5");
      cur.setAttribute("opacity", "0.85");
      svg.appendChild(cur);
      cursorRef.current = cur;
    }
    const { ev, x } = at;
    cur.setAttribute("x1", String(x - 2));
    cur.setAttribute("x2", String(x - 2));
    cur.setAttribute("y1", String(ev.top));
    cur.setAttribute("y2", String(ev.top + ev.height));

    /* 지금 소리 나는 음표도 물들인다.
       줄 위를 지나는 선만으로는 여러 음이 붙어 있는 자리에서 어느
       음인지 집기 어렵다 — 음표 자체가 색을 입으면 눈이 바로 간다. */
    if (playedRef.current !== ev) {
      for (const el of markedRef.current) el.classList.remove("abc-playing");
      markedRef.current = [];
      for (const group of ev.elements ?? [])
        for (const el of group) {
          el.classList.add("abc-playing");
          markedRef.current.push(el);
        }
      playedRef.current = ev;
    }

    /* 커서가 창 밖으로 흘러내리지 않게 정한 높이(followAt)에 붙여 둔다.
       스크롤은 실제로 스크롤되는 가장 가까운 바깥 칸에서 한다 — 편집
       화면은 악보 상자가 늘어나 페이지가 스크롤되어, 상자만 보다가는
       진행바가 화면 밖으로 나갔다 */
    let box: HTMLElement | null = host.parentElement;
    while (
      box &&
      !(
        box.scrollHeight > box.clientHeight + 1 &&
        /(auto|scroll)/.test(getComputedStyle(box).overflowY)
      )
    )
      box = box.parentElement;
    const page = !box;
    const top = page ? 0 : (box as HTMLElement).getBoundingClientRect().top;
    const h = page ? window.innerHeight : (box as HTMLElement).clientHeight;
    const rel = cur.getBoundingClientRect().top - top;
    if (h > 0 && (rel < h * (followAt - 0.18) || rel > h * (followAt + 0.17))) {
      const by = rel - h * followAt;
      if (page) window.scrollBy({ top: by, behavior: "smooth" });
      else
        (box as HTMLElement).scrollTo({
          top: Math.max(0, (box as HTMLElement).scrollTop + by),
          behavior: "smooth",
        });
    }
  }, [at, followAt]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        {/* 마디 손잡이는 손잡이를 받은 화면에서만 둔다 — 연습실은 위
            설정줄(싱크 옆)에 두었으므로 여기에 또 두지 않는다 */}
        <ViewSteppers
          sync={sync}
          onSync={onSync}
          onShiftBar={onShiftBar}
          shift={barOffsetProp}
          bars={onPerLine ? perLine : undefined}
          onBars={onPerLine}
          barsMax={4}
          barsLabel="악보대로"
          pitch={pitch}
          onPitch={onPitch}
          pitchAuto={pitchAuto}
        />
        {/* 악보에 마디 수를 맞추는 손잡이.
            한 마디만 달라도 알려 준다 — 그 한 마디가 곡 전체에 걸쳐
            벌어지면 커서가 갈수록 앞서 나간다. 수가 같아도 눌러 둘 수
            있게 남긴다: 소리가 끝나는 자리까지 다시 재어 깔아 준다. */}
        {onFitBars && playedBars >= 8 && audioBars > 0 && (
          <button
            className={[
              "rounded bg-[var(--chip)] px-1.5 py-0.5 text-[11px] font-semibold",
              audioBars === playedBars
                ? "text-[color-mix(in_srgb,var(--foreground)_60%,transparent)]"
                : "text-red-600 dark:text-red-400",
            ].join(" ")}
            onClick={() => onFitBars(playedBars)}
            title={`음원은 ${audioBars}마디, 악보를 펼치면 ${playedBars}마디입니다. 누르면 악보 마디 수에 맞춰 소리가 끝나는 자리까지 박을 고르게 다시 깝니다`}
          >
            {audioBars === playedBars
              ? `악보 ${playedBars}마디에 맞추기`
              : `음원 ${audioBars}마디 ≠ 악보 ${playedBars}마디 · 맞추기`}
          </button>
        )}
      </SongInfoLine>
      {/* ♩ 값과 「악보 따르기」는 아랫줄에 세운다. 마디 맞추기까지가 한
          줄이고, 그 뒤로 더 붙이면 손잡이가 화면 밖으로 밀려난다 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-0.5 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
        {/* 빠르기를 손으로 정한다.
            마디 수로 나누는 길은 곡 끝이 페이드로 잦아들면 마디를 짧게
            잡아 커서가 갈수록 앞선다 — 그럴 때는 귀로 잰 ♩값이 낫다. */}
        <BeatBpm bpm={audioBpm} onSet={onSetBpm} />
        {/* 카포는 음높이 손잡이와 안내줄(연주설정 요약)이 알려 준다 —
            원음 높이를 옮기면 필요한 카포가 달라져, 악보 조만 보고 적던
            「카포 n프렛」은 틀린 말이 되었다 */}
      </div>
      {/* 타브만 보일 때 오선의 음표·기둥·이음줄을 가린다 */}
      {/* abcjs는 currentColor로 그린다 — 다크 모드의 연회색 글자색이
          상속되면 흰 종이 위 악보가 흐려진다. 종이는 늘 흰색·검정이다 */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded bg-white px-2 py-1 text-black">
        <div ref={hostRef} className={onSeek ? "cursor-pointer" : undefined} />
      </div>
    </div>
  );
}

/**
 * 마디마다 눌러서 고칠 판을 깐다.
 *
 * abcjs는 음표마다 abcjs-mm{번호} 딱지를 붙인다 — 악보에 적힌 마디
 * 번호(0부터)다. 같은 번호끼리 묶어 그 넓이를 재면 마디 하나가 차지한
 * 자리가 나온다. 그 위에 보이지 않는 판을 얹고, 3초 길게 누르거나
 * 오른쪽 클릭하면 그 마디를 연다.
 */
function markMeasures(host: HTMLElement, onEdit: (m: number) => void): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const boxes = new Map<number, { x: number; y: number; r: number; b: number }>();
  for (const g of svg.querySelectorAll<SVGGraphicsElement>("g.abcjs-note")) {
    let mm: number | null = null;
    for (const c of (g.getAttribute("class") ?? "").split(" "))
      if (c.startsWith("abcjs-mm")) {
        const n = Number(c.slice("abcjs-mm".length));
        if (Number.isInteger(n)) mm = n;
      }
    if (mm === null) continue;
    let box;
    try {
      box = g.getBBox();
    } catch {
      continue;
    }
    if (!box.width && !box.height) continue;
    const had = boxes.get(mm);
    boxes.set(
      mm,
      had
        ? {
            x: Math.min(had.x, box.x),
            y: Math.min(had.y, box.y),
            r: Math.max(had.r, box.x + box.width),
            b: Math.max(had.b, box.y + box.height),
          }
        : { x: box.x, y: box.y, r: box.x + box.width, b: box.y + box.height },
    );
  }
  let hold: number | null = null;
  for (const [mm, box] of boxes) {
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    hit.setAttribute("x", String(box.x - 4));
    hit.setAttribute("y", String(box.y - 6));
    hit.setAttribute("width", String(Math.max(box.r - box.x + 8, 8)));
    hit.setAttribute("height", String(Math.max(box.b - box.y + 12, 12)));
    hit.setAttribute("fill", "transparent");
    /* 테두리를 못 박아 지운다. abcjs가 svg에 stroke를 걸어 두어, 그냥
       두면 마디마다 검은 네모가 그려진다 — 보이지 않아야 할 판이다 */
    hit.setAttribute("stroke", "none");
    hit.setAttribute("pointer-events", "all");
    hit.style.cursor = "context-menu";
    const stop = () => {
      if (hold) window.clearTimeout(hold);
      hold = null;
    };
    hit.addEventListener("pointerdown", () => {
      stop();
      hold = window.setTimeout(() => onEdit(mm), EDIT_HOLD_MS);
    });
    hit.addEventListener("pointerup", stop);
    hit.addEventListener("pointerleave", stop);
    hit.addEventListener("pointercancel", stop);
    hit.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      stop();
      onEdit(mm);
    });
    svg.appendChild(hit);
  }
}

/** 음표를 누른 자리의 시각을 셈할 때 쓰는 값 */
interface SeekContext {
  timings: Timing[];
  bars: Bar[];
  barOffset: number;
  audioToPlay: number[];
  now: number;
}

/**
 * 누른 자리에서 가장 가까운 음표를 찾아, 그 음표가 소리 나는 시각을 준다.
 *
 * 누른 것이 음표 요소인지는 보지 않고 **자리**로 찾는다 — 마디 고치기
 * 판이 음표 위에 얹혀 있어 누름이 판으로 간다. 시각은 커서와 같은
 * 셈을 거꾸로 한다: 음원 마디의 시작·끝 사이를, 그 마디 첫 음표에서
 * 다음 마디 첫 음표까지의 자리 비율로 나눈다. 그러면 누른 뒤 커서가
 * 정확히 그 음표에 선다. 도돌이로 여러 번 치는 음표는 지금 자리에서
 * 가장 가까운 바퀴를 고른다.
 */
function noteTimeAt(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  ctx: SeekContext,
): number | null {
  const { timings, bars, barOffset, audioToPlay, now } = ctx;
  const svg = host.querySelector("svg");
  const m = svg?.getScreenCTM();
  if (!svg || !m || !timings.length) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const { x, y } = pt.matrixTransform(m.inverse());

  // 세로로 가장 가까운 줄 — 가사 줄을 눌러도 그 위 줄로 친다
  const gap = (e: Timing) =>
    y < e.top ? e.top - y : y > e.top + e.height ? y - e.top - e.height : 0;
  let best: Timing | null = null;
  for (const e of timings) {
    if (!best || gap(e) < gap(best) - 0.5) best = e;
    else if (Math.abs(gap(e) - gap(best)) <= 0.5) {
      const cx = (t: Timing) => t.left + (t.width ?? 0) / 2;
      if (Math.abs(cx(e) - x) < Math.abs(cx(best) - x)) best = e;
    }
  }
  if (!best || gap(best) > 60) return null;
  const sameLine = (a: Timing, b: Timing) =>
    a.line !== undefined ? a.line === b.line : a.top === b.top;
  const line = best;
  const onLine = timings.filter((e) => sameLine(e, line));

  // 같은 자리의 음표가 바퀴마다 하나씩 있다
  const picks = onLine.filter((e) => Math.abs(e.left - line.left) < 0.5);
  if (!bars.length) {
    const times = picks.map((e) => e.milliseconds / 1000);
    return times.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
  }

  const seen = new Set(onLine.map((e) => e.playMeasure));
  const n = audioToPlay.length;
  const times: number[] = [];
  for (const e of picks) {
    const inThis = onLine.filter((o) => o.playMeasure === e.playMeasure);
    const left = Math.min(...inThis.map((o) => o.left));
    audioToPlay.forEach((pm, k) => {
      if (pm !== e.playMeasure) return;
      const bar = bars[k + barOffset];
      if (!bar) return;
      const nextPm = k + 1 < n && seen.has(audioToPlay[k + 1]) ? audioToPlay[k + 1] : null;
      const inNext = nextPm === null ? [] : onLine.filter((o) => o.playMeasure === nextPm);
      const right = inNext.length
        ? Math.min(...inNext.map((o) => o.left))
        : Math.max(...inThis.map((o) => o.endX ?? o.left + (o.width ?? 0)));
      const frac =
        right > left ? Math.min(Math.max((e.left - left) / (right - left), 0), 1) : 0;
      // 커서가 이 음표를 「지나온 음표」로 칠하도록 아주 조금 뒤로
      times.push(bar.start + frac * (bar.end - bar.start) + 0.01);
    });
  }
  if (!times.length) return null;
  return times.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
}

/**
 * abcjs가 그린 코드 이름에서 **숫자만** 작게 줄인다.
 *
 * 그리드·타브·파형은 E7의 7을 작게 적는데, 오선 악보만 abcjs가 한 크기로
 * 그려 화면마다 모양이 달랐다. abcjs의 글자 자리(x·y)는 건드리지 않고,
 * 맨 안쪽 글자 조각 안에서만 숫자를 작은 tspan으로 감싼다.
 */
function shrinkChordDigits(host: HTMLElement): void {
  const NS = "http://www.w3.org/2000/svg";
  host.querySelectorAll(".abcjs-chord").forEach((group) => {
    const leaves: Element[] = [];
    const collect = (el: Element) => {
      if (el.children.length === 0) leaves.push(el);
      else [...el.children].forEach(collect);
    };
    collect(group);
    for (const leaf of leaves) {
      if (leaf.getAttribute("data-small")) continue;
      const text = leaf.textContent ?? "";
      if (!/\d/.test(text)) continue;
      leaf.textContent = "";
      for (const part of text.split(/(\d+)/).filter(Boolean)) {
        if (/^\d+$/.test(part)) {
          const t = document.createElementNS(NS, "tspan");
          t.setAttribute("font-size", "75%");
          t.textContent = part;
          leaf.appendChild(t);
        } else {
          leaf.appendChild(document.createTextNode(part));
        }
      }
      leaf.setAttribute("data-small", "1");
    }
  });
}

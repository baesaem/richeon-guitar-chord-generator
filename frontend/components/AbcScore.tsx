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

import { SongInfoLine } from "@/components/SongInfoLine";
import { ViewSteppers } from "@/components/ViewSteppers";
import { abcOrders } from "@/lib/abcOrder";
import type { SongChordResult } from "@/lib/abcChords";
import type { Bar } from "@/lib/bars";
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
  /** 악보를 음원 위에서 미는 보정(초) */
  sync?: number;
  onSync?: (sec: number) => void;
  /** 악보 첫 마디가 음원의 몇 번째 마디인지. 곡에 저장된 값을 준다 */
  barOffset?: number;
  /** 악보를 한 마디씩 미는 손잡이(강사님) */
  onShiftBar?: (delta: number) => void;
  headerRight?: React.ReactNode;
  musicKey: string;
  timeSignature: string;
  playNotes?: string[];
  /** 안내줄에 함께 적을 스트로크. 모든 플레이 화면이 같은 것을 보인다 */
  strum?: StrumChoice | null;
  onPickStrum?: () => void;
  /** 이 곡을 치는 방식 — 「스트로크」 또는 「아르페지오 3」 */
  playStyle?: string;
  /** 악보·파형·타브의 코드를 한 벌로 모은 결과. 표시줄에 알려 준다 */
  chordNote?: SongChordResult | null;
}

export function AbcScore({
  abc,
  bars,
  time,
  getTime,
  transpose = 0,
  sync = 0,
  onSync,
  barOffset: barOffsetProp,
  onShiftBar,
  headerRight,
  musicKey,
  timeSignature,
  playNotes,
  strum,
  onPickStrum,
  playStyle,
  chordNote,
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

  // ---- 악보 그리기 ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !abc.trim()) return;
    let cancelled = false;

    (async () => {
      const ABCJS = (await import("abcjs")).default;
      if (cancelled || !hostRef.current) return;
      // barNumbers는 abcjs가 받는 값인데 타입 정의에 빠져 있다
      const params = {
        responsive: "resize",
        add_classes: true,
        visualTranspose: transpose,
        staffwidth: 740,
        // 줄마다 마디 번호를 작게 적는다 — 어디를 치는지 서로 짚어
        // 말할 때 「몇 마디」가 있어야 한다
        barNumbers: 1,
        format: {
          gchordfont: "sans-serif 12 bold",
          measurefont: "sans-serif 9",
        },
      } as Parameters<typeof ABCJS.renderAbc>[2] & { barNumbers?: number };
      /* 마디 번호는 %%barnumbers 지시로 켠다.
         악보 원문은 건드리지 않고 그릴 때만 앞에 붙인다 — 저장되는
         악보에 우리 취향을 섞지 않기 위해서다. */
      const drawn = /^%%barnumbers/m.test(abc)
        ? abc
        : `%%barnumbers 1
${abc}`;
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
      setTimings(list);
      // 다시 그렸으니 커서와 음표 표시도 새로 잡는다 (옛 노드는 사라졌다)
      cursorRef.current = null;
      markedRef.current = [];
      playedRef.current = null;
    })();

    return () => {
      cancelled = true;
    };
  }, [abc, transpose]);

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

    // 커서가 창 아래로 흘러내리지 않게 위쪽에 붙여 둔다
    const box = host.parentElement;
    if (box) {
      const rel =
        cur.getBoundingClientRect().top - box.getBoundingClientRect().top;
      const h = box.clientHeight;
      if (h > 0 && (rel < h * 0.1 || rel > h * 0.45))
        box.scrollTo({
          top: Math.max(0, box.scrollTop + rel - h * 0.28),
          behavior: "smooth",
        });
    }
  }, [at]);

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
        {/* 마디 손잡이는 손잡이를 받은 화면에서만 둔다 — 연습실은 위
            설정줄(싱크 옆)에 두었으므로 여기에 또 두지 않는다 */}
        <ViewSteppers sync={sync} onSync={onSync} onShiftBar={onShiftBar} />
        {/* 악보와 원곡이 다른 것은 조용히 넘기지 않는다 — 무엇이 왜
            달라 보이는지 알아야 강사님이 판단할 수 있다 */}
        {chordNote && chordNote.source !== "none" && chordNote.changed > 0 && (
          <span
            className="text-[11px] text-red-600 dark:text-red-400"
            title={
              chordNote.source === "audio"
                ? "카포로 옮겨 적은 악보라, 코드는 음원에서 들리는 대로 적었습니다"
                : "악보가 원곡 그대로라, 파형·타브의 코드를 악보에 맞췄습니다"
            }
          >
            {chordNote.source === "audio" ? "음원 코드" : "악보 코드"}로 모음{" "}
            {chordNote.changed}곳
          </span>
        )}
        {!!chordNote?.shift && chordNote.matched > 0 && (
          <span
            className="text-[11px] text-gray-500"
            title="악보가 카포를 쓰도록 옮겨 적혀 있습니다"
          >
            악보가 음원보다 {Math.abs(chordNote.shift)}반음{" "}
            {chordNote.shift > 0 ? "높음" : "낮음"}
          </span>
        )}
      </SongInfoLine>
      {/* abcjs는 currentColor로 그린다 — 다크 모드의 연회색 글자색이
          상속되면 흰 종이 위 악보가 흐려진다. 종이는 늘 흰색·검정이다 */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded bg-white px-2 py-1 text-black">
        <div ref={hostRef} />
      </div>
    </div>
  );
}

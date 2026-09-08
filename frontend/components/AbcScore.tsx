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
import { abcMeasures, abcOrders } from "@/lib/abcOrder";
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
  /** 음원 분석과 얼마나 다르든 악보 코드를 따르는가 */
  follow?: boolean;
  /** 그것을 켜고 끄는 손잡이(강사님). 없으면 단추를 두지 않는다 */
  onFollow?: (on: boolean) => void;
  /**
   * 음원의 박을 악보의 펼친 마디 수에 맞춰 고르게 다시 깐다(강사님).
   * 박 찾기가 정수로 돌아오지 않는 배율로 어긋났을 때의 마지막 길이다.
   */
  onFitBars?: (bars: number) => void;
  /**
   * 오선 아래에 **기타 타브**를 함께 그린다.
   *
   * 붙여 둔 악보가 있으면 타브 화면도 그 악보를 보여야 한다 — 코드에서
   * 만들어 낸 운지가 아니라 편곡자가 적은 음을 짚게 된다.
   */
  tab?: boolean;
  /** 빠르기를 손으로 정한다(강사님). 마디 수로 나누는 길이 안 맞을 때 쓴다 */
  onSetBpm?: (bpm: number) => void;
  /** 지금 음원의 빠르기. 손으로 고칠 때 시작값이 된다 */
  audioBpm?: number;
  /** 악보를 펼쳤을 때의 마디 수. onFitBars가 쓴다 */
  playedBars?: number;
  /** 음원의 마디 수. 악보와 얼마나 다른지 보인다 */
  audioBars?: number;
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
  follow = false,
  onFollow,
  tab = false,
  onFitBars,
  onSetBpm,
  audioBpm = 0,
  playedBars = 0,
  audioBars = 0,
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
        // 기타 타브. 오선 아래에 여섯 줄과 프렛 숫자가 함께 그려진다
        ...(tab ? { tablature: [{ instrument: "guitar" }] } : {}),
        format: {
          gchordfont: "sans-serif 12 bold",
          measurefont: "sans-serif 9",
        },
      } as Parameters<typeof ABCJS.renderAbc>[2] & { barNumbers?: number };
      /* 마디 번호는 %%barnumbers 지시로 켠다.
         악보 원문은 건드리지 않고 그릴 때만 앞에 붙인다 — 저장되는
         악보에 우리 취향을 섞지 않기 위해서다. */
      let drawn = /^%%barnumbers/m.test(abc) ? abc : `%%barnumbers 1
${abc}`;
      /* 타브 화면에서는 오선을 지운다.
         abcjs는 타브를 오선 **아래에** 덧그릴 뿐 오선을 뺄 길을 주지
         않는다. 줄은 %%stafflines 0으로 지우고, 음표·기둥은 아래 CSS가
         가린다 — 남는 것은 여섯 줄 타브와 코드·가사·마디 번호다. */
      if (tab)
        /* 오선을 지우고, 줄과 줄 사이를 벌린다.
           오선이 없어지면 그 자리가 빈 띠로 남는데, 다음 줄의 코드 이름이
           그 띠에 들어앉아 **앞 줄 타브에 붙어** 보인다 — 어느 줄의 코드인지
           알 수 없다. staffsep으로 줄 사이를 벌려 떼어 놓는다. */
        drawn = `%%stafflines 0
%%staffsep 84
${drawn}`;
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
      if (tab) {
        // 마디와 숫자 사이를 고르게 편다(아래 설명). 커서가 보는 x도 함께
        const moved = evenTabSpacing(hostRef.current);
        for (const t of list) {
          for (const group of t.elements ?? []) {
            const at = group.map((el) => moved.get(el)).find((v) => v !== undefined);
            if (at !== undefined) {
              t.left = at;
              break;
            }
          }
        }
      }
      setTimings(list);
      // 타브만 보일 때는 세뇨·코다·달세뇨를 우리가 적는다(아래 설명)
      if (tab) drawJumpMarks(hostRef.current, abc);
      // 다시 그렸으니 커서와 음표 표시도 새로 잡는다 (옛 노드는 사라졌다)
      cursorRef.current = null;
      markedRef.current = [];
      playedRef.current = null;
    })();

    return () => {
      cancelled = true;
    };
  }, [abc, transpose, tab]);

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
        {/* 빠르기를 손으로 정한다.
            마디 수로 나누는 길은 곡 끝이 페이드로 잦아들면 마디를 짧게
            잡아 커서가 갈수록 앞선다 — 그럴 때는 귀로 잰 ♩값이 낫다. */}
        {onSetBpm && (
          <span className="flex items-center gap-1 text-[11px]">
            <span>♩</span>
            <input
              type="number"
              className="w-12 rounded border border-[var(--panel-line)] bg-[var(--background)] px-1 py-0.5 text-right"
              defaultValue={audioBpm ? Math.round(audioBpm) : 70}
              min={20}
              max={400}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSetBpm(+(e.target as HTMLInputElement).value);
              }}
              title="이 빠르기로 박을 다시 깝니다. 커서가 갈수록 앞서면 조금 낮추고, 처지면 높이세요"
            />
            <button
              className="rounded bg-[var(--chip)] px-1.5 py-0.5 font-semibold"
              onClick={(e) => {
                const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                onSetBpm(+input.value);
              }}
            >
              맞추기
            </button>
          </span>
        )}
        {/* 음원 분석이 통째로 빗나간 곡에서 쓴다 — 얼마나 다르든 악보를 따른다 */}
        {onFollow && (
          <button
            className={[
              "rounded px-1.5 py-0.5 text-[11px]",
              follow
                ? "bg-[var(--chip-on)] font-semibold text-[var(--foreground)]"
                : "bg-[var(--chip)] text-[color-mix(in_srgb,var(--foreground)_60%,transparent)]",
            ].join(" ")}
            onClick={() => onFollow(!follow)}
            title="켜면 음원 분석과 얼마나 다르든 악보에 적힌 코드를 그대로 씁니다. 마디가 어긋난 악보라면 오히려 헝클어지니, 「악보 밀기」로 자리를 맞춘 뒤 켜세요"
          >
            악보 따르기 {follow ? "켬" : "끔"}
          </button>
        )}
        {!!chordNote?.shift && chordNote.matched > 0 && (
          <span
            className="text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]"
            title="악보가 카포를 쓰도록 옮겨 적혀 있습니다"
          >
            악보가 음원보다 {Math.abs(chordNote.shift)}반음{" "}
            {chordNote.shift > 0 ? "높음" : "낮음"}
          </span>
        )}
      </SongInfoLine>
      {/* 타브만 보일 때 오선의 음표·기둥·이음줄을 가린다 */}
      {tab && (
        <style>{`
          /* 음표 묶음 안에서 머리·기둥·빔만 걷는다. 프렛 숫자와 코드·가사도
             같은 묶음에 들어 있어, 통째로 가리면 함께 사라진다. */
          .abc-tab-only .abcjs-note > *:not(.abcjs-tab-number):not(.abcjs-chord):not(.abcjs-lyric) {
            display: none;
          }
          .abc-tab-only .abcjs-ledger,
          .abc-tab-only .abcjs-rest,
          .abc-tab-only .abcjs-slur,
          .abc-tab-only .abcjs-tie,
          .abc-tab-only .abcjs-triplet,
          .abc-tab-only .abcjs-staff-extra.abcjs-clef,
          .abc-tab-only .abcjs-staff-extra.abcjs-key-signature { display: none; }
          /* 프렛 숫자는 이 화면의 본문이다. 가늘고 작으면 여섯 줄에 묻힌다 */
          .abc-tab-only .abcjs-tab-number {
            font-weight: 700;
            font-size: 17px;
          }
        `}</style>
      )}
      {/* abcjs는 currentColor로 그린다 — 다크 모드의 연회색 글자색이
          상속되면 흰 종이 위 악보가 흐려진다. 종이는 늘 흰색·검정이다 */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded bg-white px-2 py-1 text-black">
        <div ref={hostRef} className={tab ? "abc-tab-only" : undefined} />
      </div>
    </div>
  );
}

/**
 * 세뇨·코다·달세뇨를 악보 위에 글자로 세운다.
 *
 * 타브만 보이게 오선 음표를 가리면 이 기호들도 함께 사라진다 — abcjs가
 * 음표 묶음 안에 **이름 없는 그림**으로 그리기 때문이다. 부르는 차례를
 * 정하는 표라 없으면 어디로 되돌아가는지 알 수 없다. 마디마다 붙는
 * 딱지(abcjs-mm숫자)로 그 마디를 찾아 다시 적는다.
 */
function drawJumpMarks(host: HTMLElement, abc: string): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  let measures: { text: string }[];
  try {
    measures = abcMeasures(abc);
  } catch {
    return;
  }
  const SEGNO = String.fromCodePoint(0x1d10b);
  const CODA = String.fromCodePoint(0x1d10c);
  measures.forEach((m, i) => {
    const marks: string[] = [];
    if (/!segno!/.test(m.text)) marks.push(SEGNO);
    if (/!coda!/.test(m.text)) marks.push(CODA);
    if (/!fine!/.test(m.text)) marks.push("Fine");
    const jump = m.text.match(/!D\.([SC])\.al(coda|fine)!/i);
    if (jump)
      marks.push(
        `D.${jump[1].toUpperCase()}. al ${jump[2].toLowerCase() === "coda" ? "Coda" : "Fine"}`,
      );
    if (!marks.length) return;
    /* **마디 번호 옆에** 적는다.
       타브 줄 위에 얹으면 프렛 숫자와 겹쳐 읽을 수가 없다. 마디 번호는
       악보 맨 위, 아무것도 없는 자리에 있으니 그 옆이 가장 한갓지다. */
    const num = svg.querySelector(
      `.abcjs-bar-number.abcjs-mm${i}`,
    ) as SVGGraphicsElement | null;
    let x = Infinity;
    let y = Infinity;
    if (num) {
      try {
        const b = num.getBBox();
        x = b.x + b.width + 6;
        y = b.y + b.height;
      } catch {
        // 못 재면 아래에서 다시 잡는다
      }
    }
    if (!Number.isFinite(x)) {
      // 마디 번호가 없는 마디도 있다 — 그 마디에 붙은 것 중 가장 위를 쓴다
      for (const node of [...svg.querySelectorAll(`.abcjs-mm${i}`)] as SVGGraphicsElement[]) {
        try {
          const b = node.getBBox();
          if (!b.width && !b.height) continue;
          x = Math.min(x, b.x);
          y = Math.min(y, b.y - 4);
        } catch {
          // 그려지지 않은 것은 건너뛴다
        }
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
    el.setAttribute("x", String(x));
    el.setAttribute("y", String(Math.max(y, 14)));
    el.setAttribute("font-size", "15");
    el.setAttribute("font-weight", "700");
    el.setAttribute("fill", "currentColor");
    el.textContent = marks.join(" ");
    svg.appendChild(el);
  });
}

/**
 * 타브의 마디와 숫자를 고르게 편다.
 *
 * abcjs는 음표가 많은 마디를 넓게, 적은 마디를 좁게 잡고 코드 이름의
 * 너비만큼 또 벌린다 — 오선 악보에서는 읽기 좋은 습관이지만, 음표
 * 머리가 없는 타브에서는 숫자가 뭉쳤다 벌어졌다 하여 어느 박에 짚는
 * 것인지 눈으로 셀 수 없다. 줄마다 마디를 같은 너비로 나누고, 마디
 * 안의 자리를 같은 간격으로 세운다.
 *
 * 옮긴 자리를 돌려준다 — 커서는 abcjs가 알려 준 옛 x를 쓰기 때문에,
 * 그대로 두면 커서만 옛 자리에 남는다.
 */
function evenTabSpacing(host: HTMLElement): Map<Element, number> {
  const moved = new Map<Element, number>();
  const svg = host.querySelector("svg");
  if (!svg) return moved;
  /* 한 번 편 그림을 또 펴면 안 된다 — 옮김이 겹쳐 쌓여 숫자가 악보
     밖으로 날아간다. 리액트는 개발 중에 같은 일을 두 번 시킨다 */
  if (svg.getAttribute("data-evened")) return moved;
  svg.setAttribute("data-evened", "1");

  /** class="abcjs-l3"처럼 붙는 번호를 뽑는다. 없으면 null */
  const tagOf = (el: Element, name: string): number | null => {
    const pre = "abcjs-" + name;
    for (const c of (el.getAttribute("class") ?? "").split(" ")) {
      if (!c.startsWith(pre)) continue;
      const rest = c.slice(pre.length);
      // "abcjs-mm0"은 name이 "m"일 때 걸리지만 남는 글자가 숫자가 아니다
      if (rest !== "" && Number.isInteger(Number(rest))) return Number(rest);
    }
    return null;
  };
  /** 지금 서 있는 x. 타브 숫자가 있으면 그 자리, 없으면(쉼표) 제 넓이 */
  const xOf = (g: SVGGraphicsElement): number => {
    const t = g.querySelector(".abcjs-tab-number");
    const at = t?.getAttribute("x");
    if (at !== null && at !== undefined) return +at;
    try {
      return g.getBBox().x;
    } catch {
      return 0;
    }
  };
  const move = (el: SVGGraphicsElement, dx: number): void => {
    if (Math.abs(dx) < 0.01) return;
    const had = el.getAttribute("transform");
    el.setAttribute("transform", `translate(${dx.toFixed(2)},0)${had ? " " + had : ""}`);
  };

  interface Line {
    /** 마디 → 자리 번호 → 그 자리에 선 무리(오선 쪽과 타브 쪽 둘) */
    evs: Map<number, Map<number, SVGGraphicsElement[]>>;
    /** 마디 → 그 마디를 닫는 세로줄 */
    bars: Map<number, SVGGraphicsElement[]>;
    /** 마디 → 마디 번호·괄호처럼 마디 앞머리에 붙는 것 */
    heads: Map<number, SVGGraphicsElement[]>;
    /** 음표가 설 수 있는 왼쪽 끝 — 자리표·박자표 뒤 */
    left: number;
  }
  const lines = new Map<number, Line>();
  const lineOf = (l: number): Line => {
    let v = lines.get(l);
    if (!v) {
      v = { evs: new Map(), bars: new Map(), heads: new Map(), left: 0 };
      lines.set(l, v);
    }
    return v;
  };
  const push = <K,>(m: Map<K, SVGGraphicsElement[]>, k: K, el: SVGGraphicsElement) => {
    const a = m.get(k);
    if (a) a.push(el);
    else m.set(k, [el]);
  };

  for (const g of svg.querySelectorAll<SVGGraphicsElement>("g.abcjs-note")) {
    const l = tagOf(g, "l");
    const mm = tagOf(g, "mm");
    const n = tagOf(g, "n");
    if (l === null || mm === null || n === null) continue;
    const line = lineOf(l);
    let bar = line.evs.get(mm);
    if (!bar) line.evs.set(mm, (bar = new Map()));
    push(bar, n, g);
  }
  for (const b of svg.querySelectorAll<SVGGraphicsElement>("g.abcjs-bar")) {
    const l = tagOf(b, "l");
    const mm = tagOf(b, "mm");
    if (l === null || mm === null) continue;
    push(lineOf(l).bars, mm, b);
  }
  for (const e of svg.querySelectorAll<SVGGraphicsElement>(
    ".abcjs-bar-number, .abcjs-ending",
  )) {
    const l = tagOf(e, "l");
    const mm = tagOf(e, "mm");
    if (l === null || mm === null) continue;
    // 세로줄 무리 안에 든 마디 번호는 세로줄을 따라 움직인다 — 여기서 또
    // 밀면 두 번 움직여 엉뚱한 자리에 선다
    if (e.closest("g.abcjs-bar")) continue;
    push(lineOf(l).heads, mm, e);
  }
  for (const e of svg.querySelectorAll<SVGGraphicsElement>(".abcjs-staff-extra")) {
    const l = tagOf(e, "l");
    if (l === null) continue;
    const line = lineOf(l);
    try {
      const box = e.getBBox();
      line.left = Math.max(line.left, box.x + box.width);
    } catch {
      /* 못 재면 그냥 둔다 */
    }
  }

  /*
   * 줄마다 따로 나누면 줄이 바뀔 때마다 세로줄이 조금씩 어긋난다 —
   * 위아래로 훑으면 마디선이 비뚤배뚤 흐른다. 모든 줄이 **같은 격자**를
   * 쓰도록, 시작 자리와 한 마디 너비를 곡 전체에서 하나로 정한다.
   */
  interface Plan {
    line: Line;
    mms: number[];
    barX: Map<number, number>;
    from: number;
    right: number;
  }
  const plans: Plan[] = [];
  for (const line of lines.values()) {
    const mms = [...line.bars.keys()].sort((a, b) => a - b);
    if (!mms.length) continue;
    const barX = new Map<number, number>();
    for (const mm of mms) {
      /* 무리 전체를 재면 안 된다 — 그 안에는 마디 번호 글자도 들어
         있어서, 번호가 있는 마디만 왼쪽으로 넓게 잡힌다. 무리에서 **가장
         키가 큰 그림**, 곧 세로줄 자신을 찾아 그 자리를 쓴다 */
      const xs: number[] = [];
      for (const b of line.bars.get(mm) ?? []) {
        let tall = 0;
        let at = Number.NaN;
        for (const kid of b.querySelectorAll("path")) {
          try {
            const box = kid.getBBox();
            if (box.height > tall) {
              tall = box.height;
              at = box.x;
            }
          } catch {
            /* 못 재는 것은 건너뛴다 */
          }
        }
        if (!Number.isNaN(at)) xs.push(at);
      }
      if (xs.length) barX.set(mm, Math.min(...xs));
    }
    const right = barX.get(mms[mms.length - 1]);
    if (right === undefined) continue;
    /* 자리표·박자표를 덮지 않게, 그리고 원래 첫 음표보다 왼쪽으로는
       가지 않게 시작 자리를 잡는다 */
    const first = line.evs.get(mms[0]);
    const firstX = first
      ? Math.min(...[...first.values()].map((g) => xOf(g[0])))
      : line.left + 12;
    plans.push({
      line,
      mms,
      barX,
      from: Math.max(line.left + 10, firstX - 6),
      right,
    });
  }
  if (!plans.length) return moved;

  const from = Math.max(...plans.map((p) => p.from));
  const per = Math.max(...plans.map((p) => p.mms.length));
  /* 오른쪽 끝은 **꽉 찬 줄들 가운데 가장 좁은 것**을 따른다.
     마지막 줄은 마디가 한둘뿐이라 짧게 끝나므로 빼고 센다. 가장 넓은
     줄에 맞추면 좁은 줄의 마지막 마디가 육선 밖으로 삐져나간다 */
  const full = plans.filter((p) => p.mms.length === per);
  const right = Math.min(...(full.length ? full : plans).map((p) => p.right));
  const width = (right - from) / per;
  if (!(width > 4)) return moved;

  for (const plan of plans) {
    plan.mms.forEach((mm, j) => {
      const at = from + j * width;
      const to = at + width;
      // 세로줄을 격자 위로
      const was = plan.barX.get(mm);
      if (was !== undefined)
        for (const b of plan.line.bars.get(mm) ?? []) move(b, to - was);
      // 마디 앞머리(마디 번호·1·2번 괄호)는 마디가 시작하는 만큼 민다
      const wasHead = j === 0 ? plan.from : (plan.barX.get(plan.mms[j - 1]) ?? plan.from);
      for (const e of plan.line.heads.get(mm) ?? []) move(e, at - wasHead);
      // 마디 안의 자리를 고르게
      const evs = plan.line.evs.get(mm);
      if (!evs) return;
      const ns = [...evs.keys()].sort((a, b) => a - b);
      const gap = width / ns.length;
      ns.forEach((n, i) => {
        const put = at + (i + 0.5) * gap;
        const group = evs.get(n) ?? [];
        // 자리를 잴 때는 타브 숫자를 지닌 쪽을 본다 — 오선 쪽 무리는
        // 음표를 가려 두어 넓이를 못 잰다
        const ruler =
          group.find((g) => g.querySelector(".abcjs-tab-number")) ?? group[0];
        const had = xOf(ruler);
        for (const g of group) {
          move(g, put - had);
          moved.set(g, put);
        }
      });
    });
  }
  return moved;
}

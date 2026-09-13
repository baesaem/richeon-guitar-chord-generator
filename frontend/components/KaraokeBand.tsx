"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { LyricLine } from "@/lib/types";

export interface KaraokeChord {
  start: number;
  end: number;
  /** 화면에 적을 이름(음높이·표기까지 맞춘 것) */
  label: string;
}

/**
 * 노래방 가사 띠(강사님).
 *
 * 영상 아래 검은 띠에 지금 부를 줄(부르는 만큼 색이 차오른다)과 다음 줄을
 * 크게 적고, 글자 위에는 그 자리의 코드를 얹는다. 왼쪽에는 지금 코드를 크게,
 * 다음 코드를 작게 — 기타를 치며 부른다. 영상 위는 가리지 않는다(유튜브 규정).
 *
 * 시각은 두 갈래다 — 가사는 가사 싱크, 코드는 코드 싱크를 따른다(다른 화면과
 * 같은 셈). 코드를 가사 줄 위에 놓을 때는 둘의 차이만큼 옮겨 맞춘다. 가사에는
 * 줄 단위 시각만 있어, 줄 안에서는 시간에 비례해 색이 차오른다.
 */
export function KaraokeBand({
  lines,
  chords,
  getTime,
  lyricSync,
  sync,
}: {
  lines: LyricLine[];
  chords: KaraokeChord[];
  /** 지금 재생 위치(초) — 기기 지연까지 뺀 값 */
  getTime: () => number;
  lyricSync: number;
  sync: number;
}) {
  // 시각은 매 화면(프레임)마다 읽는다. 읽는 함수는 ref로 들어 고리가 다시 서지 않게
  const getRef = useRef(getTime);
  useEffect(() => {
    getRef.current = getTime;
  });
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT(getRef.current());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sorted = useMemo(
    () => lines.filter((l) => l.text.trim()).sort((a, b) => a.t - b.t),
    [lines],
  );
  const lt = t + lyricSync; // 가사 시각
  const ct = t + sync; // 코드 시각
  const shift = lyricSync - sync; // 코드 시각 + shift = 가사 시각

  // 지금 줄 — 시작이 지난 마지막 줄
  let i = -1;
  for (let k = 0; k < sorted.length; k++) {
    if (sorted[k].t <= lt) i = k;
    else break;
  }
  const cur = i >= 0 ? sorted[i] : null;
  const next = sorted[i + 1] ?? null;
  /* 줄이 끝나고 다음 줄까지 틈이 있으면(전주·간주) 다음 줄을 기다리게 보인다 */
  const waiting = !cur || (lt > cur.end + 0.3 && !!next);
  const top = waiting ? next : cur;
  const below = waiting ? (next ? (sorted[i + 2] ?? null) : null) : next;
  const progress =
    top && !waiting ? Math.min(Math.max((lt - top.t) / Math.max(top.end - top.t, 0.1), 0), 1) : 0;
  const remain = waiting && top ? top.t - lt : 0;

  // 지금 코드와 다음 코드
  const curChord = chords.find((c) => c.start <= ct && ct < c.end)?.label ?? null;
  const nextChord = chords.find((c) => c.start > ct && c.label !== curChord)?.label ?? null;

  /** 가사 줄 위에 얹을 코드 — 줄 안에서의 자리(0~1)는 시간 비율로 */
  const chordsFor = (line: LyricLine) => {
    const a = line.t - shift;
    const b = line.end - shift;
    const out: { label: string; at: number }[] = [];
    for (const c of chords) {
      if (c.end <= a || c.start >= b) continue;
      if (out.length && out[out.length - 1].label === c.label) continue;
      out.push({ label: c.label, at: Math.min(Math.max((c.start - a) / Math.max(b - a, 0.1), 0), 0.92) });
    }
    return out;
  };

  return (
    <div className="flex h-full w-full items-stretch gap-3 px-3 py-2">
      {/* 지금 코드 — 크게. 치는 손이 먼저 보는 자리 */}
      <div className="flex w-[18%] min-w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-white/5">
        <div className="text-[clamp(26px,min(8vw,11vh),64px)] font-black leading-none text-amber-300">
          {curChord ?? "—"}
        </div>
        {nextChord && (
          <div className="mt-1 text-[clamp(11px,min(3vw,4vh),18px)] text-white/60">다음 {nextChord}</div>
        )}
      </div>

      {/* 가사 — 지금 줄(색이 차오른다)과 다음 줄 */}
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[1.5vh] overflow-hidden text-center">
        {!sorted.length ? (
          <p className="text-[clamp(13px,min(3.6vw,5vh),22px)] text-white/60">
            가사가 없는 곡입니다 — 왼쪽 코드를 보며 부르세요
          </p>
        ) : top ? (
          <Line line={top} chords={chordsFor(top)} progress={progress} big />
        ) : (
          <p className="text-[clamp(13px,min(3.6vw,5vh),22px)] text-white/50">♪ 끝</p>
        )}
        {/* 첫 줄이 들어오기 전 네 칸 — 전주·간주에서 들어갈 때를 센다 */}
        {waiting && remain > 0 && remain <= 4 && (
          <div className="text-[clamp(12px,min(3vw,4.5vh),20px)] tracking-[0.4em] text-amber-300">
            {"●".repeat(Math.max(4 - Math.ceil(remain), 0))}
            {"○".repeat(Math.min(Math.ceil(remain), 4))}
          </div>
        )}
        {below && <Line line={below} chords={chordsFor(below)} progress={0} />}
      </div>
    </div>
  );
}

/** 가사 한 줄 — 위에 코드, 아래 글자. 부른 만큼 글자 위에 색을 덮는다 */
function Line({
  line,
  chords,
  progress,
  big = false,
}: {
  line: LyricLine;
  chords: { label: string; at: number }[];
  progress: number;
  big?: boolean;
}) {
  return (
    <div className={big ? "max-w-full" : "max-w-full opacity-55"}>
      <div className="relative inline-block max-w-full">
        {/* 코드 줄 — 글자 폭 위에 시간 비율로 놓는다 */}
        <div className="relative h-[1.3em] text-[clamp(11px,min(3.2vw,4.8vh),24px)] font-bold text-amber-300">
          {chords.map((c, k) => (
            <span key={k} className="absolute whitespace-nowrap" style={{ left: `${c.at * 100}%` }}>
              {c.label}
            </span>
          ))}
        </div>
        <div
          className={[
            "relative whitespace-nowrap font-bold leading-tight",
            big
              ? "text-[clamp(18px,min(5.5vw,8vh),44px)]"
              : "text-[clamp(14px,min(4vw,6vh),32px)]",
          ].join(" ")}
        >
          <span className="text-white">{line.text}</span>
          {progress > 0 && (
            <span
              className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-sky-300"
              style={{ width: `${progress * 100}%` }}
            >
              {line.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

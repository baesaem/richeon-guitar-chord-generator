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
 * 가사가 물 흐르듯 오른쪽에서 왼쪽으로 흘러간다 — 파형에 가사가 붙은 것처럼,
 * 시간 줄 위에 글자를 제 시각 자리에 놓고 줄째 민다. 가운데보다 조금 왼쪽에
 * 선 진행 막대를 지나간 글자는 색이 바뀐다. 코드는 따로 두지 않고 가사 위,
 * 그 코드가 시작하는 자리에 적는다. 영상 위는 가리지 않는다(유튜브 규정).
 *
 * 가사에는 줄 단위 시각만 있어, 줄 안의 글자는 그 줄의 시간에 고르게 편다.
 * 가사는 가사 싱크, 코드는 코드 싱크를 따른다(다른 화면과 같은 셈).
 *
 * 매 화면(프레임)마다 다시 그리지 않는다 — 글자는 한 번 깔아 두고 띠만
 * 옮긴다(transform). 곡 하나에 글자가 수백 개라 다시 그리면 버벅인다.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 띠 높이에 맞춘 글자 크기와 흐르는 빠르기(초당 픽셀). 띠에는 코드 줄과 가사
  // 줄 둘뿐이다. 너무 크면 좁은 세로 화면에 글자가 두세 개밖에 안 보여 앞을
  // 읽을 수 없다 — 40px로 묶고, 앞쪽이 세로 약 3초·가로 약 7초 보이게
  const font = Math.round(Math.min(Math.max(size.h * 0.3, 18), 40));
  const chordFont = Math.round(font * 0.62);
  const pps = font * 3.0;
  const playX = Math.round(size.w * 0.28);
  const chordRow = Math.round(chordFont * 1.5);
  const blockH = chordRow + Math.round(font * 1.3);
  const top = Math.max(Math.round((size.h - blockH) / 2), 0);
  const shift = lyricSync - sync; // 코드 시각 + shift = 가사 시각

  const sorted = useMemo(
    () => lines.filter((l) => l.text.trim()).sort((a, b) => a.t - b.t),
    [lines],
  );

  /** 띠에 깔 글자와 코드 — 시각(가사 시각) × pps 자리에. 한 번만 만든다 */
  const items = useMemo(() => {
    if (!pps) return { text: [] as React.ReactNode[], marks: [] as React.ReactNode[] };
    const text: React.ReactNode[] = [];
    sorted.forEach((line, li) => {
      const chars = [...line.text];
      const n = Math.max(chars.length, 1);
      // 글자가 겹치지 않을 만큼은 벌린다(빽빽한 줄은 제 시간보다 조금 길어진다)
      const step = Math.max((line.end - line.t) / n, (font * 1.04) / pps);
      chars.forEach((ch, k) => {
        if (ch === " ") return;
        text.push(
          <span
            key={`${li}.${k}`}
            className="absolute whitespace-pre"
            style={{ left: (line.t + k * step) * pps, top: chordRow }}
          >
            {ch}
          </span>,
        );
      });
    });
    const marks: React.ReactNode[] = [];
    let last = "";
    chords.forEach((c, i) => {
      if (c.label === last) return;
      last = c.label;
      marks.push(
        <span
          key={`c${i}`}
          className="absolute whitespace-nowrap font-bold"
          style={{ left: (c.start + shift) * pps, top: 0, fontSize: chordFont }}
        >
          {c.label}
        </span>,
      );
    });
    return { text, marks };
  }, [sorted, chords, pps, font, chordFont, chordRow, shift]);

  // 띠 옮기기 — 상태를 바꾸지 않고 두 겹(그대로·지나간 색)을 함께 민다
  const getRef = useRef(getTime);
  const lsRef = useRef(lyricSync);
  useEffect(() => {
    getRef.current = getTime;
    lsRef.current = lyricSync;
  });
  const plainRef = useRef<HTMLDivElement>(null);
  const sungRef = useRef<HTMLDivElement>(null);
  // 전주·간주처럼 다음 가사가 아직 화면 밖이면 「가사까지 n초」를 띄운다
  const waitRef = useRef<HTMLSpanElement>(null);
  const spansRef = useRef<{ t: number; end: number }[]>([]);
  useEffect(() => {
    spansRef.current = sorted.map((l) => ({ t: l.t, end: l.end }));
  }, [sorted]);
  useEffect(() => {
    let raf = 0;
    const ahead = pps ? (size.w - playX) / pps : 0; // 화면에 보이는 앞쪽 초
    const tick = () => {
      const lt = getRef.current() + lsRef.current;
      const tr = `translate3d(${playX - lt * pps}px,0,0)`;
      if (plainRef.current) plainRef.current.style.transform = tr;
      if (sungRef.current) sungRef.current.style.transform = tr;
      const w = waitRef.current;
      if (w) {
        const spans = spansRef.current;
        // 지금 부르는 줄이 있으면(시작했고 아직 안 끝남) 띄우지 않는다
        const singing = spans.some((s) => s.t <= lt && lt < s.end + 0.3);
        const next = spans.find((s) => s.t > lt);
        const gap = next === undefined ? 0 : next.t - lt;
        // 틈(전주·간주)이고, 다음 줄이 아직 화면 오른쪽 밖일 때만
        const text = !singing && gap > ahead && gap > 2 ? `♪ 가사까지 ${Math.ceil(gap)}초` : "";
        if (w.textContent !== text) w.textContent = text;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playX, pps, size.w]);

  const layer = (ref: React.RefObject<HTMLDivElement | null>, sung: boolean) => (
    <div ref={ref} className="absolute left-0 will-change-transform" style={{ top, height: blockH }}>
      <div className={sung ? "text-amber-300/40" : "text-amber-300"}>{items.marks}</div>
      <div
        className={["font-bold leading-none", sung ? "text-sky-300" : "text-white"].join(" ")}
        style={{ fontSize: font }}
      >
        {items.text}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden">
      {/* 흘러가는 가사·코드(아직 부르지 않은 색) */}
      {layer(plainRef, false)}
      {/* 진행 막대를 지난 쪽만 잘라 보이는 같은 띠 — 부른 글자는 하늘색 */}
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: playX }}>
        {layer(sungRef, true)}
      </div>
      {/* 진행 막대 — 지금 부르는 자리 */}
      <div
        className="pointer-events-none absolute inset-y-[8%] w-[3px] rounded-full bg-amber-400"
        style={{ left: playX - 1 }}
      />
      {/* 다음 가사까지 남은 초 — 전주·간주에서 언제 들어갈지 */}
      <span
        ref={waitRef}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[clamp(12px,3.5vh,20px)] font-semibold text-amber-300/80"
      />
      {!sorted.length && (
        <p className="absolute inset-x-0 bottom-2 text-center text-[12px] text-white/50">
          가사가 없는 곡입니다 — 코드만 흘러갑니다
        </p>
      )}
    </div>
  );
}

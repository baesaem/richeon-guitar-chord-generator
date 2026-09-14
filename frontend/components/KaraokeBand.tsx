"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { KaraokeSyl } from "@/lib/karaokeSyllables";
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
 * 화면을 가득 채운 영상 아래쪽에 겹쳐, 가사가 물 흐르듯 오른쪽에서 왼쪽으로
 * 흘러간다 — 위에서부터 코드·가사·파형 세 줄이 한 시간 줄 위에 함께 흐른다.
 * 진행 막대는 가운데. 막대를 지난 쪽(글자·코드·파형)은 색이 바뀐다. 글자는
 * 영상 위에서도 읽히게 그림자를 두르고, 띠 뒤에는 짙어지는 그늘을 깐다.
 *
 * 가사에는 줄 단위 시각만 있어, 줄 안의 글자는 그 줄의 시간에 고르게 편다.
 * 가사는 가사 싱크, 코드는 코드 싱크, 파형은 소리 그대로를 따른다(다른 화면과
 * 같은 셈) — 셋 다 가사 시각 줄 위에 옮겨 놓는다.
 *
 * 매 화면(프레임)마다 다시 그리지 않는다 — 글자·파형은 한 번 깔아 두고 띠만
 * 옮긴다(transform). 곡 하나에 글자가 수백 개라 다시 그리면 버벅인다.
 */
export function KaraokeBand({
  lines,
  chords,
  peaks,
  peaksPerSecond,
  syllables,
  getTime,
  lyricSync,
  sync,
}: {
  lines: LyricLine[];
  chords: KaraokeChord[];
  /**
   * 음원에 맞춘 음절(멜로디 악보가 붙은 곡). 있으면 글자를 부르는 순간의 자리에
   * 놓는다 — 없으면 줄 시각 안에 고르게 편다. 시각은 코드 싱크 쪽이다
   */
  syllables?: KaraokeSyl[] | null;
  /** 파형 포락선(0~1) — 파형 화면과 같은 것 */
  peaks?: number[];
  peaksPerSecond?: number;
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

  /* 글자 크기와 흐르는 빠르기(초당 픽셀). 코드·가사·파형 세 줄이 띠에 들어가야
     하고(높이의 25%), 좁은 세로 화면에서도 가운데 막대 앞쪽이 2초쯤은 보이게
     폭으로도 묶는다 */
  // 21%·7.5%·40px에서 한 단계 줄였다(강사님: 「조금 작게」)
  const font = Math.round(Math.min(Math.max(Math.min(size.h * 0.18, size.w * 0.065), 16), 35));
  // 가사는 코드보다 조금만 크게(강사님) — 코드가 가사의 0.62배라 너무 작았다
  const chordFont = Math.round(font * 0.83);
  /* 흐르는 빠르기(초당 픽셀). 기본은 글자 3개 폭. 음절 시각이 있으면 곡의 촘촘한
     간격(8분음표 따위)이 글자 한 개 폭은 되도록 올린다(강사님: 「글자 간격을 음
     길이에 맞출 수 있나」) — 느리면 짧은 음표들이 겹치지 않게 밀려 균등해지고,
     긴 음표 뒤에만 틈이 벌어졌다. 한도를 두어 앞쪽이 2초는 보이게 한다 */
  const pps = useMemo(() => {
    const base = font * 3.0;
    if (!syllables?.length) return base;
    const gaps = syllables
      .map((s, k) => (k > 0 ? s.t - syllables[k - 1].t : 0))
      .filter((g) => g > 0.05)
      .sort((a, b) => a - b);
    if (gaps.length < 8) return base;
    const tight = gaps[Math.floor(gaps.length * 0.15)]; // 촘촘한 쪽 15%
    const want = (font * 1.1) / tight;
    return Math.min(Math.max(want, base), font * 5.5);
  }, [font, syllables]);
  const playX = Math.round(size.w * 0.5); // 진행 막대는 가운데
  const chordRow = Math.round(chordFont * 1.35);
  const lyricRow = Math.round(font * 1.3);
  // 파형은 글자의 1.8배 높이로(강사님: 조금 크게) — 셋이 띠에 들도록 글자는 18%로
  const waveH = Math.max(Math.round(font * 1.8), 28);
  const blockH = chordRow + lyricRow + 6 + waveH;
  const top = Math.max(size.h - blockH - 8, 0); // 띠 아래쪽에 붙인다
  const shift = lyricSync - sync; // 코드 시각 + shift = 가사 시각

  const sorted = useMemo(
    () => lines.filter((l) => l.text.trim()).sort((a, b) => a.t - b.t),
    [lines],
  );

  /** 띠에 깔 글자와 코드 — 가사 시각 × pps 자리에. 한 번만 만든다 */
  const items = useMemo(() => {
    if (!pps) return { text: [] as React.ReactNode[], marks: [] as React.ReactNode[] };
    const text: React.ReactNode[] = [];
    if (syllables?.length) {
      /* 음원에 맞춘 음절 — 부르는 순간의 자리에(코드 시각이라 싱크 차이만큼
         옮긴다). 앞 음절과 겹칠 때만 뒤로 민다. 단어가 끝나면 조금 띄운다 */
      let edge = -Infinity;
      syllables.forEach((s, k) => {
        let x = (s.t + shift) * pps;
        if (x < edge) x = edge;
        text.push(
          <span key={`s${k}`} className="absolute whitespace-nowrap" style={{ left: x }}>
            {s.text}
          </span>,
        );
        edge = x + font * 1.04 * [...s.text].length + (s.space ? font * 0.3 : 0);
      });
    } else {
      sorted.forEach((line, li) => {
        const chars = [...line.text];
        const n = Math.max(chars.length, 1);
        /* 한 글자에 1초까지만 준다 — 줄의 끝 시각이 다음 줄 앞까지 늘어나 간주를
           덮는 곡이 있다(「할아버지와 수박」 한 줄이 108~132초). 그대로 펴면
           서버 없는 기기(수강생)에서 글자가 간주 중에 흘렀다 */
        const letters = Math.max(chars.filter((c) => c !== " ").length, 1);
        const span = Math.min(line.end - line.t, letters * 1.0);
        // 글자가 겹치지 않을 만큼은 벌린다(빽빽한 줄은 제 시간보다 조금 길어진다)
        const step = Math.max(span / n, (font * 1.04) / pps);
        chars.forEach((ch, k) => {
          if (ch === " ") return;
          text.push(
            <span key={`${li}.${k}`} className="absolute" style={{ left: (line.t + k * step) * pps }}>
              {ch}
            </span>,
          );
        });
      });
    }
    const marks: React.ReactNode[] = [];
    let last = "";
    chords.forEach((c, i) => {
      if (c.label === last) return;
      last = c.label;
      marks.push(
        <span
          key={`c${i}`}
          className="absolute whitespace-nowrap"
          style={{ left: (c.start + shift) * pps }}
        >
          {c.label}
        </span>,
      );
    });
    return { text, marks };
  }, [sorted, syllables, chords, pps, font, shift]);

  /* 파형 — 파형 화면과 같은 셈(막대 하나가 덮는 구간의 최대값, 0.7제곱으로 조용한
     대목도 결이 보이게). 얇은 막대를 3px마다. 소리 시각이라 가사 싱크만큼 옮겨 둔다 */
  const wave = useMemo(() => {
    if (!peaks?.length || !pps) return { d: "", width: 0 };
    const rate = peaksPerSecond || 25;
    const seconds = peaks.length / rate;
    const STEP = 3;
    const n = Math.floor((seconds * pps) / STEP);
    let d = "";
    for (let k = 0; k < n; k++) {
      const from = Math.floor(((k * STEP) / pps) * rate);
      const to = Math.min(Math.ceil((((k + 1) * STEP) / pps) * rate), peaks.length);
      let v = 0;
      for (let i = from; i < to; i++) v = Math.max(v, peaks[i]);
      const h = Math.max(Math.pow(v, 0.7) * waveH, 1);
      d += `M${k * STEP + 1} ${((waveH - h) / 2).toFixed(1)}v${h.toFixed(1)}`;
    }
    return { d, width: Math.ceil(seconds * pps) + 4 };
  }, [peaks, peaksPerSecond, pps, waveH]);

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
    /* 음절이 있으면 음절 시각으로(가사 시각에 옮겨), 없으면 줄 시각으로. 음절
       사이가 2.5초 넘게 비면 그 사이는 틈으로 친다 */
    spansRef.current = syllables?.length
      ? syllables.map((s, k) => {
          const t = s.t + shift;
          const nextT = (syllables[k + 1]?.t ?? s.t + 1) + shift;
          return { t, end: Math.min(nextT, t + 2.5) };
        })
      : sorted.map((l) => ({ t: l.t, end: l.end }));
  }, [sorted, syllables, shift]);
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

  const shadow = "0 2px 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)";
  const layer = (ref: React.RefObject<HTMLDivElement | null>, sung: boolean) => (
    <div ref={ref} className="absolute left-0 will-change-transform" style={{ top, height: blockH }}>
      {/* 코드 — 가사 위, 그 코드가 시작하는 자리 */}
      <div
        className={["relative font-bold", sung ? "text-amber-300/45" : "text-amber-300"].join(" ")}
        style={{ height: chordRow, fontSize: chordFont, textShadow: shadow }}
      >
        {items.marks}
      </div>
      {/* 가사 */}
      <div
        className={["relative font-bold leading-none", sung ? "text-sky-300" : "text-white"].join(" ")}
        style={{ height: lyricRow, fontSize: font, textShadow: shadow }}
      >
        {items.text}
      </div>
      {/* 파형 — 가사 아래에서 함께 흐른다 */}
      {wave.d && (
        <svg
          className={["absolute", sung ? "text-sky-300/80" : "text-white/45"].join(" ")}
          style={{ left: lyricSync * pps, top: chordRow + lyricRow + 6 }}
          width={wave.width}
          height={waveH}
          aria-hidden="true"
        >
          <path d={wave.d} stroke="currentColor" strokeWidth={2} />
        </svg>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden">
      {/* 흘러가는 코드·가사·파형(아직 지나지 않은 색) */}
      {layer(plainRef, false)}
      {/* 진행 막대를 지난 쪽만 잘라 보이는 같은 띠 — 지나간 색 */}
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: playX }}>
        {layer(sungRef, true)}
      </div>
      {/* 진행 막대 — 가운데, 지금 부르는 자리 */}
      <div
        className="absolute w-[3px] rounded-full bg-amber-400 shadow-[0_0_6px_rgba(0,0,0,0.8)]"
        style={{ left: playX - 1, top: Math.max(top - 4, 0), height: blockH + 8 }}
      />
      {/* 다음 가사까지 남은 초 — 전주·간주에서 언제 들어갈지 */}
      <span
        ref={waitRef}
        className="absolute right-3 text-[clamp(12px,3.5vh,20px)] font-semibold text-amber-300"
        style={{ top: top + chordRow, textShadow: shadow }}
      />
      {!sorted.length && (
        <p
          className="absolute inset-x-0 text-center text-[12px] text-white/70"
          style={{ top: Math.max(top - 20, 0), textShadow: shadow }}
        >
          가사가 없는 곡입니다 — 코드와 파형만 흘러갑니다
        </p>
      )}
    </div>
  );
}

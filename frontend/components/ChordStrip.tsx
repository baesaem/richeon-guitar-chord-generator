"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { labelFor, transposeRoot } from "@/lib/notation";
import type { AnalysisResult } from "@/lib/types";

export interface ChordStripHandle {
  draw(time: number): void;
}

interface Props {
  result: AnalysisResult;
  flats: boolean;
  transpose: number;
  /** 초당 픽셀. 클수록 확대된다 */
  pixelsPerSecond?: number;
  onSeek?: (t: number) => void;
  /**
   * 전체 높이(px). 위쪽 33px은 눈금과 코드 칩이 쓰고 나머지가 파형이다.
   * 폰 세로 화면에서는 아래 코드 테이블에 자리를 더 주는 편이 낫다.
   */
  height?: number;
}

const PLAYHEAD_RATIO = 0.35;

/** 파형 막대 굵기와 간격(CSS 픽셀). 간격이 굵기보다 커야 막대가 하나씩 구분된다 */
const BAR_WIDTH = 1;
const BAR_STEP = 3;

/**
 * 파형 타임라인.
 *
 * 재생헤드는 화면에 고정되고 파형이 흘러간다. 코드는 실제 시작 지점에 얹혀 있어
 * "언제 바뀌는지"가 눈에 보인다. 리액트 재렌더 없이 캔버스에 직접 그린다.
 */
export const ChordStrip = forwardRef<ChordStripHandle, Props>(function ChordStrip(
  { result, flats, transpose, pixelsPerSecond = 90, onSeek, height = 92 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTime = useRef(0);

  const paint = (time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    /* 화면 확대(app-scale의 zoom)까지 셈해 그린다.
       dpr만 쓰면 확대된 화면에서 캔버스가 늘려 그려져 선이 흐릿하고
       옅어진다 — 밝은 테마에서 파형이 흐리다는 말이 이것이었다.
       zoom은 계산식에 안 잡히므로 실제 그려진 폭과 레이아웃 폭의
       비로 알아낸다. */
    const zoom = w > 0 ? canvas.getBoundingClientRect().width / w : 1;
    const dpr = (window.devicePixelRatio || 1) * (zoom || 1);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* 어두운 화면인지는 html의 .dark 하나로 판단한다.
       기기 설정(prefers-color-scheme)까지 보면, 기기는 다크인데 앱은
       세피아 같은 밝은 테마일 때 흰 파형을 밝은 바탕에 그려 안 보인다 —
       실제로 그랬다. 앱 테마는 .dark 클래스가 유일한 진실이다. */
    const dark = document.documentElement.classList.contains("dark");
    // 파형선은 눈금·칩보다 진해야 한다 — 무엇을 보는 화면인지가 그것이다
    // 파형선은 이 화면의 주인공이다 — 검정에 가깝게, 어두운 화면에선 희게
    const wave = dark ? "#f4f4f6" : "#1c1c22";
    const grid = dark ? "#3f3f46" : "#d4d4d8";
    const chipBg = dark ? "#fafafa" : "#18181b";
    const chipFg = dark ? "#18181b" : "#fafafa";

    const playheadX = w * PLAYHEAD_RATIO;
    const originX = playheadX - time * pixelsPerSecond;
    // 위쪽 여백은 눈금과 코드 칩이 쓴다. 폰에서는 최소한으로 줄인다.
    const rulerH = 11;
    const laneH = 22;               // 코드 칩이 놓이는 띠
    const waveTop = rulerH + laneH;
    const waveH = h - waveTop;
    const mid = waveTop + waveH / 2;

    // --- 초 눈금 ---
    ctx.strokeStyle = grid;
    ctx.fillStyle = grid;
    ctx.lineWidth = 1;
    ctx.font = "9px system-ui, sans-serif";
    const firstSec = Math.max(0, Math.floor((0 - originX) / pixelsPerSecond));
    const lastSec = Math.ceil((w - originX) / pixelsPerSecond);
    for (let s = firstSec; s <= lastSec; s++) {
      const x = originX + s * pixelsPerSecond;
      if (x < -40 || x > w + 40) continue;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, rulerH);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, "0");
      ctx.fillText(`${mm}:${ss}`, x + 3, 8);
    }

    // --- 마디 첫 박 ---
    ctx.strokeStyle = grid;
    ctx.globalAlpha = 0.9;
    for (const beat of result.beats) {
      if (beat.beat !== 1) continue;
      const x = originX + beat.t * pixelsPerSecond;
      if (x < -10 || x > w + 10) continue;
      ctx.beginPath();
      ctx.moveTo(x, waveTop);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- 파형 ---
    // 픽셀마다 채우면 덩어리로 뭉쳐 보인다. 간격을 두고 얇은 막대로 그린다.
    const pps = result.peaks_per_second || 25;
    if (result.peaks.length > 0) {
      ctx.strokeStyle = wave;
      ctx.lineWidth = BAR_WIDTH;
      ctx.beginPath();
      for (let x = 0; x < w; x += BAR_STEP) {
        const t0 = (x - originX) / pixelsPerSecond;
        const t1 = (x + BAR_STEP - originX) / pixelsPerSecond;
        if (t1 < 0 || t0 > result.duration) continue;

        // 막대 하나가 덮는 구간의 최대값을 쓴다. 건너뛴 픽셀의 피크가 사라지지 않는다.
        const from = Math.max(Math.floor(t0 * pps), 0);
        const to = Math.min(Math.ceil(t1 * pps), result.peaks.length);
        let v = 0;
        for (let i = from; i < to; i++) v = Math.max(v, result.peaks[i]);

        /* 조용한 대목도 결이 보이게 키를 완만하게 올린다(0.7제곱).
           소리 크기를 그대로 쓰면 반주 잔잔한 자리가 실낱이 되어
           파형 전체가 옅어 보인다. */
        const half = Math.max((Math.pow(v, 0.7) * waveH) / 2, BAR_WIDTH / 2);
        // 짝수 굵기 선은 정수 x에 — 반 픽셀에 놓으면 양쪽이 번져 옅어진다
        const cx = Math.floor(x) + (BAR_WIDTH % 2 ? 0.5 : 0);
        ctx.moveTo(cx, mid - half);
        ctx.lineTo(cx, mid + half);
      }
      ctx.stroke();
    }

    // --- 코드 칩 ---
    // ♭·♯ 임시표는 작은 폰트로 위에 올려 실제 악보 표기처럼 그린다
    const CHIP_FONT = "700 14px system-ui, sans-serif";
    const ACC_FONT = "700 10px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    const measureLabel = (text: string): number => {
      let width = 0;
      for (const part of text.split(/([♭♯])/)) {
        if (!part) continue;
        ctx.font = part === "♭" || part === "♯" ? ACC_FONT : CHIP_FONT;
        width += ctx.measureText(part).width;
      }
      return width;
    };

    const drawLabel = (text: string, startX: number, midY: number): void => {
      let cx2 = startX;
      for (const part of text.split(/([♭♯])/)) {
        if (!part) continue;
        const accidental = part === "♭" || part === "♯";
        ctx.font = accidental ? ACC_FONT : CHIP_FONT;
        ctx.fillText(part, cx2, accidental ? midY - 4 : midY);
        cx2 += ctx.measureText(part).width;
      }
    };

    for (const chord of result.chords) {
      const x = originX + chord.start * pixelsPerSecond;
      if (x < -80 || x > w + 80) continue;

      const text = labelFor(transposeRoot(chord.root, transpose), chord.quality, flats);
      // 코드가 없는 자리는 비워 둔다 — 「N.C.」라 적으면 잡을 코드처럼 읽힌다
      if (text === "N.C.") continue;
      const tw = measureLabel(text);
      const boxW = tw + 12;
      const boxY = rulerH + 2;
      const boxH = laneH - 4;

      ctx.fillStyle = chipBg;
      ctx.beginPath();
      ctx.roundRect(x, boxY, boxW, boxH, 4);
      ctx.fill();

      ctx.fillStyle = chipFg;
      drawLabel(text, x + 6, boxY + boxH / 2);

      // 코드가 바뀌는 지점을 파형에도 표시
      ctx.strokeStyle = chipBg;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, waveTop);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- 재생헤드 ---
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();
  };

  useImperativeHandle(ref, () => ({
    draw(time: number) {
      lastTime.current = time;
      paint(time);
    },
  }));

  // 설정이 바뀌면 즉시 다시 그린다 (재생 중이 아니어도)
  useEffect(() => {
    paint(lastTime.current);
  });

  return (
    <canvas
      ref={canvasRef}
      className="w-full cursor-pointer touch-none select-none"
      style={{ height }}
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const dx = e.clientX - rect.left - rect.width * PLAYHEAD_RATIO;
        onSeek(Math.max(0, lastTime.current + dx / pixelsPerSecond));
      }}
    />
  );
});
